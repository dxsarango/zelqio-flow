import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { automaticRouting, type CreationRequest } from "../server/automatic-routing";
import { AttemptJournal } from "../server/attempt-journal";
import type { GitDelivery } from "../server/git-delivery";
import { RunManager, type AgentPort, type AgentSnapshot, type CreateAgentInput } from "../server/run-manager";
import { VersionedStore } from "../server/store";
import { orchestrationMetadataPatch } from "../shared/orchestration";
import type { ProviderCatalogData } from "../shared/providers";
import { runRecord, runsState, runSubmitInput, type RunGitPlan } from "../shared/runs";
import {
  normalizeProjectKey, recordedValues, resolveSettings, settingsForDirectory, settingsForRun,
} from "../shared/scoped-settings";
import { defaultSettings, migrateSettings, projectOverride, zelqioSettings, type ZelqioSettings } from "../shared/settings";

const settings = (change: Partial<ZelqioSettings> = {}): ZelqioSettings => ({ ...defaultSettings(), ...change });
const project = (value: Record<string, unknown>) => projectOverride.parse(value);
const WORK = "/work/repo";

describe("settings scopes: schema", () => {
  it("stored settings from before the scopes existed still parse, with defaults", () => {
    const old = {
      onboardingCompleted: true, providers: { a: { use: "primary", funding: "subscription" } }, consumptionOptIn: false,
      strategy: "economy", mode: "smart_review", git: { workflow: "pull_request" }, remoteAuthorization: "per_project",
      power: { preventSleep: true },
    };
    const parsed = zelqioSettings.parse(old);
    expect(parsed).toMatchObject({ ...old, projects: {}, retention: { finishedDays: 30, resultDays: 30, maxFinishedRuns: 200 } });
    expect(zelqioSettings.parse(migrateSettings(old, 1))).toEqual(parsed);
  });

  it("is strict: a project cannot carry the consumption opt-in or unknown fields", () => {
    expect(projectOverride.safeParse({ consumptionOptIn: true }).success).toBe(false);
    expect(projectOverride.safeParse({ providers: {} }).success).toBe(false);
    expect(projectOverride.safeParse({ mode: "yolo" }).success).toBe(false);
    expect(projectOverride.parse({})).toEqual({ elevatedConfirmed: false });
  });

  it("older run records parse and the new run fields are optional", () => {
    const record = {
      id: "run-1", prompt: "p", role: "developer", capability: "implement", complexity: null, cwd: WORK, status: "queued", current: null,
      attempts: 0, suspended: {}, resumeAt: null, pending: null, handledError: null, userBaseline: null, attention: false, result: null,
      error: null, history: [], createdAt: 1, updatedAt: 1,
    };
    expect(runRecord.parse(record)).not.toHaveProperty("effective");
    expect(runsState.safeParse({ runs: [record] }).success).toBe(true);
    expect(runRecord.safeParse({ ...record, overrides: { mode: "autopilot", extra: 1 } }).success).toBe(false);
  });

  it("accepts a session override on submit and rejects anything else", () => {
    expect(runSubmitInput.parse({ prompt: "x", cwd: WORK, strategy: "economy", mode: "review_first" })).toMatchObject({ strategy: "economy", mode: "review_first" });
    expect(runSubmitInput.safeParse({ prompt: "x", cwd: WORK, remoteAuthorization: "per_project" }).success).toBe(false);
    expect(runSubmitInput.safeParse({ prompt: "x", cwd: WORK, consumptionOptIn: true }).success).toBe(false);
  });
});

describe("project key", () => {
  it("is the workspace directory, normalized without touching the file system", () => {
    expect(normalizeProjectKey("/work/repo/")).toBe("/work/repo");
    expect(normalizeProjectKey("/work//repo")).toBe("/work/repo");
    expect(normalizeProjectKey("/")).toBe("/");
    expect(normalizeProjectKey("C:\\Work\\Repo\\")).toBe("c:/work/repo");
    expect(normalizeProjectKey("c:/work/repo")).toBe("c:/work/repo");
    expect(normalizeProjectKey("\\\\?\\C:\\Work")).toBe("c:/work");
    expect(normalizeProjectKey("C:\\")).toBe("c:/");
    expect(normalizeProjectKey("/Work/Repo")).toBe("/Work/Repo");
  });
});

describe("resolveSettings: session > project > global", () => {
  it("with no overrides every value is the global one", () => {
    const resolved = resolveSettings(settings({ strategy: "economy", mode: "smart_review", remoteAuthorization: "per_project" }), { project: WORK });
    expect(resolved.values).toEqual({ strategy: "economy", mode: "smart_review", workflow: "local_only", remoteAuthorization: "per_project", consumptionOptIn: false });
    expect(Object.values(resolved.sources)).toEqual(["global", "global", "global", "global"]);
    expect(resolved.notes).toEqual([]);
  });

  it("a project overrides the global values and a session overrides the project", () => {
    const global = settings({ projects: { [WORK]: project({ strategy: "economy", mode: "smart_review", git: { workflow: "pull_request" } }) } });
    const projectOnly = resolveSettings(global, { project: WORK });
    expect(projectOnly.values).toMatchObject({ strategy: "economy", mode: "smart_review", workflow: "pull_request" });
    expect(projectOnly.sources).toMatchObject({ strategy: "project", mode: "project", workflow: "project", remoteAuthorization: "global" });
    const session = resolveSettings(global, { project: WORK, session: { strategy: "quality_first", mode: "review_first" } });
    expect(session.values).toMatchObject({ strategy: "quality_first", mode: "review_first", workflow: "pull_request" });
    expect(session.sources).toMatchObject({ strategy: "session", mode: "session", workflow: "project" });
  });

  it("another project, or none, keeps the global values", () => {
    const global = settings({ projects: { [WORK]: project({ strategy: "economy" }) } });
    expect(resolveSettings(global, { project: "/other" }).values.strategy).toBe("balanced");
    expect(resolveSettings(global).values.strategy).toBe("balanced");
  });

  it("finds the project by its normalized key and by a parent directory, longest key first", () => {
    const global = settings({ projects: {
      "C:\\Work\\Repo\\": project({ strategy: "economy" }),
      "c:/work/repo/packages/app": project({ strategy: "quality_first" }),
    } });
    expect(resolveSettings(global, { project: "c:/WORK/repo" }).values.strategy).toBe("economy");
    expect(resolveSettings(global, { project: "C:\\work\\repo\\src" }).values.strategy).toBe("economy");
    expect(resolveSettings(global, { project: "c:/work/repo/packages/app/src" }).values.strategy).toBe("quality_first");
    expect(resolveSettings(global, { project: "c:/work/repository" }).values.strategy).toBe("balanced");
  });

  it("a denied remote authorization wins at any scope: a lower scope never grants what a higher one denies", () => {
    const deniedGlobally = settings({ remoteAuthorization: "denied", projects: { [WORK]: project({ remoteAuthorization: "per_project" }) } });
    const globalWins = resolveSettings(deniedGlobally, { project: WORK });
    expect(globalWins.values.remoteAuthorization).toBe("denied");
    expect(globalWins.sources.remoteAuthorization).toBe("global");
    expect(globalWins.notes).toEqual([{ field: "remoteAuthorization", code: "remote_denied_above" }]);

    const deniedByProject = settings({ remoteAuthorization: "per_project", projects: { [WORK]: project({ remoteAuthorization: "denied" }) } });
    const projectWins = resolveSettings(deniedByProject, { project: WORK });
    expect(projectWins.values.remoteAuthorization).toBe("denied");
    expect(projectWins.sources.remoteAuthorization).toBe("project");
    expect(resolveSettings(deniedByProject, { project: "/other" }).values.remoteAuthorization).toBe("per_project");
  });

  it("a session has no way to grant remote publication or the consumption opt-in", () => {
    const global = settings({ remoteAuthorization: "denied", consumptionOptIn: false });
    const hostile = resolveSettings(global, { project: WORK, session: { remoteAuthorization: "per_project", consumptionOptIn: true } as never });
    expect(hostile.values.remoteAuthorization).toBe("denied");
    expect(hostile.values.consumptionOptIn).toBe(false);
  });

  it("the consumption opt-in is the global one whatever the overrides say", () => {
    const global = settings({ projects: { [WORK]: { ...project({}), consumptionOptIn: true } as never } });
    expect(resolveSettings(global, { project: WORK }).values.consumptionOptIn).toBe(false);
    expect(resolveSettings(settings({ consumptionOptIn: true }), { project: WORK }).values.consumptionOptIn).toBe(true);
  });

  it("an elevated mode needs the explicit confirmation of the project", () => {
    const unconfirmed = settings({ projects: { [WORK]: project({ mode: "autopilot" }) } });
    const ignored = resolveSettings(unconfirmed, { project: WORK });
    expect(ignored.values.mode).toBe("review_first");
    expect(ignored.sources.mode).toBe("global");
    expect(ignored.notes).toEqual([{ field: "mode", code: "elevated_unconfirmed" }]);

    const confirmed = settings({ projects: { [WORK]: project({ mode: "autopilot", elevatedConfirmed: true }) } });
    expect(resolveSettings(confirmed, { project: WORK }).values.mode).toBe("autopilot");
    expect(resolveSettings(confirmed, { project: WORK }).notes).toEqual([]);
    // A mode that is not elevated needs no confirmation.
    expect(resolveSettings(settings({ projects: { [WORK]: project({ mode: "smart_review" }) } }), { project: WORK }).values.mode).toBe("smart_review");
  });

  it("a session may not elevate above its project, but may lower or keep the mode", () => {
    const base = settings({ projects: { [WORK]: project({ mode: "auto_merge", elevatedConfirmed: true }) } });
    const up = resolveSettings(base, { project: WORK, session: { mode: "autopilot" } });
    expect(up.values.mode).toBe("auto_merge");
    expect(up.notes).toEqual([{ field: "mode", code: "session_elevation_blocked" }]);
    expect(resolveSettings(base, { project: WORK, session: { mode: "auto_merge" } }).values.mode).toBe("auto_merge");
    expect(resolveSettings(base, { project: WORK, session: { mode: "review_first" } }).values.mode).toBe("review_first");

    // Without a project mode the global mode is the ceiling.
    expect(resolveSettings(settings(), { session: { mode: "auto_merge" } }).values.mode).toBe("review_first");
    expect(resolveSettings(settings({ mode: "autopilot" }), { session: { mode: "auto_merge" } }).values.mode).toBe("auto_merge");
    // A mode that is not elevated is always allowed.
    expect(resolveSettings(settings(), { session: { mode: "smart_review" } }).values.mode).toBe("smart_review");
  });

  it("an unconfirmed project elevation does not become a ceiling for a session either", () => {
    const base = settings({ projects: { [WORK]: project({ mode: "autopilot" }) } });
    expect(resolveSettings(base, { project: WORK, session: { mode: "autopilot" } }).values.mode).toBe("review_first");
  });

  it("is pure: the input is untouched and the same input gives the same output", () => {
    const global = settings({ projects: { [WORK]: project({ strategy: "economy" }) } });
    const before = JSON.stringify(global);
    const first = resolveSettings(global, { project: WORK, session: { mode: "smart_review" } });
    expect(JSON.stringify(global)).toBe(before);
    expect(resolveSettings(global, { project: WORK, session: { mode: "smart_review" } })).toEqual(first);
  });

  it("builds the settings a run uses and the values it records", () => {
    const global = settings({ remoteAuthorization: "per_project", projects: { [WORK]: project({ git: { workflow: "pull_request" }, strategy: "economy" }) } });
    const run = { cwd: WORK, overrides: { mode: "smart_review" as const } };
    const used = settingsForRun(global, run);
    expect(used).toMatchObject({ strategy: "economy", mode: "smart_review", git: { workflow: "pull_request" }, remoteAuthorization: "per_project", providers: global.providers });
    expect(recordedValues(resolveSettings(global, { project: WORK, session: run.overrides }))).toEqual({
      strategy: "economy", mode: "smart_review", workflow: "pull_request", remoteAuthorization: "per_project",
    });
    expect(settingsForDirectory(global, WORK).strategy).toBe("economy");
  });
});

describe("the effective values drive runs, delivery and routing", () => {
  const catalog: ProviderCatalogData = {
    generatedAt: "2026-11-27T12:00:00.000Z",
    providers: [{
      id: "alpha", label: "alpha", status: "ready", enabled: true, source: "builtin", modes: [],
      models: [{ id: "alpha-model", label: "alpha", isDefault: true, selectable: true, thinkingOptions: [{ id: "low", label: "Low", isDefault: false }, { id: "high", label: "High", isDefault: true }] }],
    }],
  };
  const providers = { alpha: { use: "primary" as const, funding: "subscription" as const } };
  const SHA = "a".repeat(40);

  class Port implements AgentPort {
    created: CreateAgentInput[] = [];
    status: AgentSnapshot["status"] = "running";
    async create(input: CreateAgentInput) { this.created.push(input); return { id: `agent-${this.created.length}` }; }
    async snapshot(id: string): Promise<AgentSnapshot> {
      return { id, status: this.status, lastError: null, pendingPermissions: 0, archived: false, restorable: false, lastUserMessageAt: null };
    }
    async send() {}
    async stop() {}
    async lastReply() { return "done"; }
    async recentActivity() { return ""; }
    async firstUserMessage() { return null; }
    async createWorktree() { return { cwd: "/wt/run", workspaceId: "ws-1" }; }
  }

  let directory: string;
  let saved: ZelqioSettings;
  let port: Port;
  let delivered: ZelqioSettings[];
  let manager: RunManager;
  const plan: RunGitPlan = { repository: "r", source: WORK, baseRef: "refs/heads/main", baseSha: SHA, branch: "zelqio/run" };
  const git = {
    plan: async () => plan,
    attach: async (value: RunGitPlan, cwd: string, workspaceId: string) => ({ ...value, cwd, workspaceId }),
    deliver: async (_run: unknown, value: ZelqioSettings) => { delivered.push(value); return { state: "local" as const, sha: SHA }; },
    retire: async () => false,
  } as unknown as GitDelivery;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "zelqio-scoped-"));
    saved = settings({ providers });
    port = new Port();
    delivered = [];
    manager = new RunManager({
      port,
      store: new VersionedStore({ dir: directory, name: "runs", version: 1, schema: runsState, defaults: () => ({ runs: [] }) }),
      attempts: new AttemptJournal(directory),
      git,
      readCatalog: async () => catalog,
      readUsage: async () => null,
      readSettings: async () => saved,
    });
  });
  afterEach(() => rm(directory, { recursive: true, force: true }));

  const finish = async () => {
    port.status = "idle";
    await manager.tick();
  };

  it("records the effective values a run started with, with the project and the session overrides", async () => {
    saved = settings({
      providers, remoteAuthorization: "per_project",
      projects: { [WORK]: project({ strategy: "economy", mode: "smart_review", git: { workflow: "pull_request" } }) },
    });
    const run = await manager.submit({ complexity: "medium", prompt: "Do it", cwd: `${WORK}/`, mode: "review_first" });
    expect(run).toMatchObject({
      projectKey: WORK, overrides: { mode: "review_first" },
      effective: { strategy: "economy", mode: "review_first", workflow: "pull_request", remoteAuthorization: "per_project" },
    });
    // Later changes to the settings do not rewrite what the run started with.
    saved = { ...saved, strategy: "quality_first", projects: {} };
    await finish();
    expect((await manager.list())[0].effective).toEqual(run.effective);
  });

  it("a run without overrides records no session overrides and the global values", async () => {
    const run = await manager.submit({ complexity: "medium", prompt: "Do it", cwd: WORK });
    expect(run.overrides).toBeUndefined();
    expect(run.effective).toEqual({ strategy: "balanced", mode: "review_first", workflow: "local_only", remoteAuthorization: "denied" });
  });

  it("the strategy of the project reaches the reasoning level chosen for the agent", async () => {
    saved = settings({ providers, strategy: "quality_first", projects: { [WORK]: project({ strategy: "economy" }) } });
    await manager.submit({ prompt: "Do it", cwd: WORK, complexity: "medium" });
    await manager.submit({ prompt: "Do it", cwd: "/work/other", complexity: "medium" });
    await manager.submit({ prompt: "Do it", cwd: WORK, complexity: "medium", strategy: "quality_first" });
    expect(port.created.map(item => item.thinkingOptionId)).toEqual(["low", "high", "high"]);
  });

  it("delivery uses the resolved mode, workflow and remote authorization, not only the global ones", async () => {
    saved = settings({
      providers, remoteAuthorization: "per_project",
      projects: { [WORK]: project({ mode: "smart_review", git: { workflow: "pull_request" } }) },
    });
    await manager.submit({ complexity: "medium", prompt: "Do it", cwd: WORK });
    await finish();
    expect(delivered).toHaveLength(1);
    expect(delivered[0]).toMatchObject({ mode: "smart_review", git: { workflow: "pull_request" }, remoteAuthorization: "per_project" });
  });

  it("delivery stays denied when the global authorization is denied, even if the project grants it", async () => {
    saved = settings({
      providers, remoteAuthorization: "denied",
      projects: { [WORK]: project({ git: { workflow: "pull_request" }, remoteAuthorization: "per_project" }) },
    });
    await manager.submit({ complexity: "medium", prompt: "Do it", cwd: WORK });
    await finish();
    expect(delivered[0]).toMatchObject({ remoteAuthorization: "denied", git: { workflow: "pull_request" } });
  });

  it("a delegated task inherits the project and the session overrides of its coordinator", async () => {
    saved = settings({ providers, projects: { [WORK]: project({ strategy: "economy" }) } });
    const parent = await manager.submit({ complexity: "medium", prompt: "Coordinate", cwd: WORK, mode: "smart_review" });
    const child = await manager.delegate(parent.current!.agentId, { title: "Part", prompt: "Do a part", capability: "review" });
    expect(child).toMatchObject({ projectKey: WORK, overrides: { mode: "smart_review" } });
  });

  it("automatic routing of a native creation follows the project of its directory", async () => {
    saved = settings({ providers, strategy: "quality_first", projects: { [WORK]: project({ strategy: "economy" }) } });
    const rewrite = automaticRouting({ readCatalog: async () => catalog, readUsage: async () => null, readSettings: async () => saved, clock: () => 1 });
    const request = (cwd: string): CreationRequest => ({
      config: { provider: "alpha", model: "alpha-model", cwd },
      metadata: { ...orchestrationMetadataPatch("automatic") },
    });
    expect((await rewrite(request(WORK))).config.thinkingOptionId).toBe("low");
    expect((await rewrite(request("/work/other"))).config.thinkingOptionId).toBe("high");
  });
});
