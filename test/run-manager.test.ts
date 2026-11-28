import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runsState } from "../shared/runs";
import type { ProviderCatalogData } from "../shared/providers";
import { defaultSettings, type ZelqioSettings } from "../shared/settings";
import type { UsageSnapshot } from "../shared/usage";
import { AttemptJournal } from "../server/attempt-journal";
import { RunManager, type AgentPort, type AgentSnapshot, type CreateAgentInput } from "../server/run-manager";
import { VersionedStore } from "../server/store";

const HOUR = 3_600_000;
const START = Date.parse("2026-11-27T12:00:00Z");

function provider(id: string): ProviderCatalogData["providers"][number] {
  return {
    id, label: id, status: "ready", enabled: true, source: "builtin",
    models: [{ id: `${id}-model`, label: id, isDefault: true, selectable: true, thinkingOptions: [{ id: "low", label: "Low", isDefault: false }, { id: "high", label: "High", isDefault: true }] }],
    modes: [],
  };
}

class FakePaseo implements AgentPort {
  agents = new Map<string, AgentSnapshot & { provider: string; model: string; prompt: string; sent: string[] }>();
  created: CreateAgentInput[] = [];
  byKey = new Map<string, string>();
  replies = new Map<string, string>();
  failCreate = false;

  async create(input: CreateAgentInput) {
    if (this.failCreate) throw new Error("create failed");
    const known = this.byKey.get(input.key);
    if (known) return { id: known };
    this.created.push(input);
    const id = `agent-${this.agents.size + 1}`;
    this.byKey.set(input.key, id);
    this.agents.set(id, { id, status: "running", lastError: null, pendingPermissions: 0, archived: false, restorable: false, lastUserMessageAt: null, provider: input.provider, model: input.model, prompt: input.prompt, sent: [] });
    return { id };
  }
  async snapshot(id: string) { return this.agents.get(id) ?? null; }
  async send(id: string, text: string, messageId: string) {
    const agent = this.agents.get(id)!;
    if (agent.sent.includes(messageId)) return;
    agent.sent.push(messageId);
    void text;
    agent.status = "running";
    agent.lastError = null;
  }
  async lastReply(id: string) { return this.replies.get(id) ?? null; }
  async stop(id: string) { this.agents.get(id)!.status = "idle"; }
  async recentActivity(id: string) { return `activity of ${id}`; }
  firstMessages = new Map<string, string>();
  async firstUserMessage(id: string) { return this.firstMessages.get(id) ?? null; }
  finish(id: string, reply: string) { const agent = this.agents.get(id)!; agent.status = "idle"; agent.lastError = null; this.replies.set(id, reply); }
  fail(id: string, message: string) { const agent = this.agents.get(id)!; agent.status = "error"; agent.lastError = message; }
}

describe("run manager: real orchestration loop over native agents", () => {
  let directory: string;
  let now: number;
  let paseo: FakePaseo;
  let usage: UsageSnapshot | null;
  let settings: ZelqioSettings;
  let catalog: ProviderCatalogData;

  const build = (extra: { maxConcurrent?: number; maxAttempts?: number; stallMs?: number; roles?: import("../shared/roles").RolesConfig } = {}) => new RunManager({
    port: paseo,
    store: new VersionedStore({ dir: directory, name: "runs", version: 1, schema: runsState, defaults: () => ({ runs: [] }) }),
    attempts: new AttemptJournal(directory, () => now),
    readCatalog: async () => catalog,
    readUsage: async () => usage,
    readSettings: async () => settings,
    readRoles: async () => extra.roles ?? {},
    clock: () => now,
    recheckMs: 5 * 60_000,
    maxConcurrent: extra.maxConcurrent,
    maxAttempts: extra.maxAttempts,
    stallMs: extra.stallMs,
  });
  const use = (id: string, use: "primary" | "auxiliary", funding: "subscription" | "free" | "consumption" = "subscription") => {
    settings = { ...settings, providers: { ...settings.providers, [id]: { use, funding } } };
  };
  const submit = (manager: RunManager) => manager.submit({ prompt: "Add a health endpoint", cwd: "/work/repo" });
  const report = (sourceId: string, remainingPct: number | null, status: "fresh" | "exhausted", resetsAt: number | null, fetchedAt = now): UsageSnapshot["reports"][number] => ({
    sourceId, status: "available", fetchedAt: new Date(fetchedAt).toISOString(),
    windows: [{ id: "five_hour", status, remainingPct, resetsAt: resetsAt === null ? null : new Date(resetsAt).toISOString(), durationSeconds: 18000 }],
  });

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "zelqio-runs-"));
    now = START;
    paseo = new FakePaseo();
    usage = null;
    catalog = { providers: [provider("alpha"), provider("beta")], generatedAt: new Date(START).toISOString() };
    settings = { ...defaultSettings(), providers: {} };
  });
  afterEach(() => rm(directory, { recursive: true, force: true }));

  it("selects an authorized model, lets Paseo run the agent and delivers its answer", async () => {
    use("alpha", "primary");
    const manager = build();
    const run = await submit(manager);
    expect(run.status).toBe("running");
    expect(paseo.created).toHaveLength(1);
    expect(paseo.created[0]).toMatchObject({ provider: "alpha", model: "alpha-model", cwd: "/work/repo", prompt: "Add a health endpoint" });
    expect(paseo.created[0].metadata["zelqio.run"]).toBe(run.id);

    await manager.tick();
    expect((await manager.list())[0].status).toBe("running");
    paseo.finish("agent-1", "Done: /health returns 200.");
    await manager.tick();
    expect((await manager.list())[0]).toMatchObject({ status: "delivered", result: "Done: /health returns 200." });
  });

  it("never uses a provider the user switched off", async () => {
    use("alpha", "primary");
    use("beta", "primary");
    settings.providers.alpha = { use: "off", funding: "subscription" };
    const manager = build();
    await submit(manager);
    expect(paseo.created.map(item => item.provider)).toEqual(["beta"]);
  });

  it("fails clearly when no authorized model exists, without creating anything", async () => {
    const manager = build();
    const run = await submit(manager);
    expect(run.status).toBe("failed");
    expect(run.error).toMatch(/No authorized model/);
    expect(paseo.created).toHaveLength(0);
  });

  it("keeps the work and hands it to another authorized provider when the limit is reached", async () => {
    use("alpha", "primary");
    use("beta", "auxiliary");
    const manager = build();
    await submit(manager);
    expect(paseo.created[0].provider).toBe("alpha");
    paseo.fail("agent-1", "You've hit your usage limit. Try again in 2 hours.");
    await manager.tick();

    const [run] = await manager.list();
    expect(run.status).toBe("running");
    expect(run.current).toMatchObject({ provider: "beta", agentId: "agent-2" });
    expect(run.suspended).toHaveProperty("alpha");
    expect(paseo.created).toHaveLength(2);
    expect(paseo.created[1].prompt).toContain("Add a health endpoint");
    expect(paseo.created[1].prompt).toContain("activity of agent-1");
    expect(paseo.agents.get("agent-1")?.archived).toBe(false);
    expect(run.history.map(entry => entry.kind)).toEqual(["queued", "started", "exhausted", "reassigned"]);

    paseo.finish("agent-2", "Done by beta.");
    await manager.tick();
    expect((await manager.list())[0]).toMatchObject({ status: "delivered", result: "Done by beta." });
  });

  it("waits for the reset and resumes the same agent exactly once", async () => {
    use("alpha", "primary");
    const manager = build();
    await submit(manager);
    paseo.fail("agent-1", "Usage limit reached. Try again in 2 hours.");
    await manager.tick();
    let [run] = await manager.list();
    expect(run).toMatchObject({ status: "waiting_quota", resumeAt: START + 2 * HOUR + 30_000 });
    expect(paseo.created).toHaveLength(1);

    now = START + HOUR;
    await manager.tick();
    expect(paseo.agents.get("agent-1")!.sent).toHaveLength(0);

    now = START + 2 * HOUR + 31_000;
    await manager.tick();
    await manager.tick();
    [run] = await manager.list();
    expect(run.status).toBe("running");
    expect(paseo.agents.get("agent-1")!.sent).toHaveLength(1);
    expect(run.history.map(entry => entry.kind)).toContain("resumed");
    expect(paseo.created).toHaveLength(1);

    paseo.finish("agent-1", "Finished after the reset.");
    await manager.tick();
    expect((await manager.list())[0]).toMatchObject({ status: "delivered", result: "Finished after the reset." });
  });

  it("does not resume while Paseo still reports the quota as exhausted, and does once fresh quota appears", async () => {
    use("alpha", "primary");
    const manager = build();
    await submit(manager);
    usage = { status: "available", reports: [report("alpha", 0, "exhausted", START + 2 * HOUR)] };
    paseo.fail("agent-1", "Usage limit reached.");
    await manager.tick();
    expect((await manager.list())[0]).toMatchObject({ status: "waiting_quota", resumeAt: START + 2 * HOUR + 30_000 });

    now = START + 2 * HOUR + 31_000;
    usage = { status: "available", reports: [report("alpha", 0, "exhausted", START + 3 * HOUR, now)] };
    await manager.tick();
    let [run] = await manager.list();
    expect(run.status).toBe("waiting_quota");
    expect(paseo.agents.get("agent-1")!.sent).toHaveLength(0);
    expect(run.resumeAt).toBeGreaterThan(now);

    now = START + 3 * HOUR + 31_000;
    usage = { status: "available", reports: [report("alpha", 80, "fresh", null, now)] };
    await manager.tick();
    [run] = await manager.list();
    expect(run.status).toBe("running");
    expect(paseo.agents.get("agent-1")!.sent).toHaveLength(1);
  });

  it("delivers a resumed turn that finishes before a tick sees the agent running", async () => {
    use("alpha", "primary");
    const manager = build();
    await submit(manager);
    paseo.fail("agent-1", "Usage limit reached. Try again in 1 hour.");
    await manager.tick();
    const [waiting] = await manager.list();
    now = waiting.resumeAt! + 1;
    const send = vi.spyOn(paseo, "send").mockImplementation(async id => {
      paseo.finish(id, "Finished immediately after the reset");
    });

    await manager.tick();
    await Promise.all([manager.onAgentUpdate("agent-1"), manager.tick()]);
    const [run] = await manager.list();
    expect(run).toMatchObject({ status: "delivered", result: "Finished immediately after the reset", pending: null });
    expect(run.history.filter(event => event.kind === "resumed")).toHaveLength(1);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("treats an ordinary failure as a failure, never as a quota problem", async () => {
    use("alpha", "primary");
    use("beta", "auxiliary");
    const manager = build();
    await submit(manager);
    paseo.fail("agent-1", "TypeError: cannot read properties of undefined");
    await manager.tick();
    expect((await manager.list())[0]).toMatchObject({ status: "failed" });
    expect(paseo.created).toHaveLength(1);
  });

  it("never reassigns work to a pay-per-use provider", async () => {
    use("alpha", "primary");
    use("beta", "auxiliary", "consumption");
    settings.consumptionOptIn = true;
    const manager = build();
    await submit(manager);
    paseo.fail("agent-1", "You've hit your usage limit. Try again in 1 hour.");
    await manager.tick();
    const [run] = await manager.list();
    expect(run.status).toBe("waiting_quota");
    expect(paseo.created).toHaveLength(1);
  });

  it("queues work beyond the concurrency limit and starts it when a slot frees", async () => {
    use("alpha", "primary");
    const manager = build({ maxConcurrent: 1 });
    const first = await submit(manager);
    const second = await submit(manager);
    expect(first.status).toBe("running");
    expect(second.status).toBe("queued");
    paseo.finish("agent-1", "first done");
    await manager.tick();
    const runs = await manager.list();
    expect(runs.find(run => run.id === first.id)?.status).toBe("delivered");
    expect(runs.find(run => run.id === second.id)?.status).toBe("running");
    expect(paseo.created).toHaveLength(2);
  });

  it("stops reassigning after the attempt limit and waits instead", async () => {
    use("alpha", "primary");
    use("beta", "auxiliary");
    const manager = build({ maxAttempts: 1 });
    await submit(manager);
    paseo.fail("agent-1", "Usage limit reached. Try again in 1 hour.");
    await manager.tick();
    expect((await manager.list())[0].status).toBe("waiting_quota");
    expect(paseo.created).toHaveLength(1);
  });

  it("survives a restart without creating a second agent for the same attempt", async () => {
    use("alpha", "primary");
    const first = build();
    const run = await submit(first);
    // Simulate a crash after the create request was sent but before the agent id was recorded.
    const store = new VersionedStore({ dir: directory, name: "runs", version: 1, schema: runsState, defaults: () => ({ runs: [] }) });
    await store.update(state => ({ result: undefined, next: { runs: state.runs.map(entry => ({ ...entry, current: null, pending: { kind: "create" as const, key: `${run.id}-a1` } })) } }));

    const restarted = build();
    await restarted.recoverAfterRestart();
    const [recovered] = await restarted.list();
    expect(paseo.created).toHaveLength(1);
    expect(recovered.current?.agentId).toBe("agent-1");
    expect(recovered.pending).toBeNull();
  });

  it("resumes a persisted agent that Paseo projects as closed after a daemon restart", async () => {
    use("alpha", "primary");
    const first = build();
    const run = await submit(first);
    paseo.fail("agent-1", "Usage limit reached. Try again in 1 hour.");
    await first.tick();
    const waiting = (await first.list())[0];
    expect(waiting.status).toBe("waiting_quota");
    const agent = paseo.agents.get("agent-1")!;
    Object.assign(agent, { status: "closed", restorable: true });

    const restarted = build();
    await restarted.recoverAfterRestart();
    expect((await restarted.list())[0]).toEqual(waiting);
    now = waiting.resumeAt! + 1;
    usage = { status: "available", reports: [report("alpha", 95, "fresh", null)] };
    await restarted.tick();
    await restarted.tick();
    paseo.finish("agent-1", "Delivered after restart");
    await restarted.onAgentUpdate(agent.id);
    expect((await restarted.list())[0]).toMatchObject({
      id: run.id, status: "delivered", result: "Delivered after restart", current: { agentId: agent.id }, attempts: 1,
    });
    expect(agent.sent).toHaveLength(1);
    expect(paseo.created).toHaveLength(1);
  });

  it("can be cancelled and then ignores the agent", async () => {
    use("alpha", "primary");
    const manager = build();
    const run = await submit(manager);
    await manager.cancel(run.id);
    paseo.finish("agent-1", "late");
    await manager.tick();
    expect((await manager.list())[0].status).toBe("cancelled");
  });

  it("adopts an agent created natively and then handles its limit like any other run", async () => {
    use("alpha", "primary");
    use("beta", "auxiliary");
    const manager = build();
    const native = await paseo.create({ key: "native-1", provider: "alpha", model: "alpha-model", cwd: "/work/repo", prompt: "Refactor the parser", title: "t", metadata: {} });
    paseo.firstMessages.set(native.id, "Refactor the parser");
    const adopted = await manager.adopt({ agentId: native.id, provider: "alpha", model: "alpha-model", cwd: "/work/repo" });
    expect(adopted).toMatchObject({ status: "running", prompt: "Refactor the parser" });
    expect((await manager.adopt({ agentId: native.id, provider: "alpha", model: "alpha-model", cwd: "/work/repo" })).id).toBe(adopted.id);
    expect(await manager.list()).toHaveLength(1);

    paseo.fail(native.id, "Usage limit reached. Try again in 3 hours.");
    await manager.tick();
    const [run] = await manager.list();
    expect(run.current?.provider).toBe("beta");
    expect(paseo.created.at(-1)?.prompt).toContain("Refactor the parser");
  });

  it("reads a limit that arrives as the last reply of a finished turn, not as an error", async () => {
    use("alpha", "primary");
    use("beta", "auxiliary");
    const manager = build();
    await submit(manager);
    paseo.finish("agent-1", "You've hit your limit \u00b7 resets in 3 hours");
    await manager.tick();
    const [run] = await manager.list();
    expect(run.status).toBe("running");
    expect(run.current?.provider).toBe("beta");
    expect(run.history.map(entry => entry.kind)).toContain("exhausted");
  });

  it("does not mistake a long normal answer that mentions limits for a limit", async () => {
    use("alpha", "primary");
    const manager = build();
    await submit(manager);
    paseo.finish("agent-1", `Implemented the endpoint. ${"The rate limit and usage limit settings are documented. ".repeat(12)}`);
    await manager.tick();
    expect((await manager.list())[0].status).toBe("delivered");
  });

  it("uses the structured error from the turn that failed, including its code", async () => {
    use("alpha", "primary");
    const manager = build();
    await submit(manager);
    paseo.agents.get("agent-1")!.status = "error";
    await manager.onAgentUpdate("agent-1", { error: { message: "Request failed", code: "usage_limit_exceeded" } });
    expect((await manager.list())[0].status).toBe("waiting_quota");
  });

  it("stops acting when the user wrote to the agent after the limit", async () => {
    use("alpha", "primary");
    const manager = build();
    await submit(manager);
    paseo.agents.get("agent-1")!.lastUserMessageAt = START - 1000;
    paseo.fail("agent-1", "Usage limit reached. Try again in 1 hour.");
    await manager.tick();
    expect((await manager.list())[0].status).toBe("waiting_quota");
    paseo.agents.get("agent-1")!.lastUserMessageAt = START + 10 * 60_000;
    now = START + HOUR + 60_000;
    await manager.tick();
    const [run] = await manager.list();
    expect(run.status).toBe("cancelled");
    expect(run.history.at(-1)?.note).toMatch(/took over/);
    expect(paseo.agents.get("agent-1")!.sent).toHaveLength(0);
  });

  it("notices a user turn while waiting even when the initial prompt had no native user timestamp", async () => {
    use("alpha", "primary");
    const manager = build();
    const run = await submit(manager);
    paseo.fail("agent-1", "Usage limit reached. Try again in 1 hour.");
    await manager.onAgentUpdate("agent-1");
    expect((await manager.list())[0]).toMatchObject({ status: "waiting_quota", userBaseline: null });

    // An older user entry can appear after the agent timeline is restored.
    paseo.agents.get("agent-1")!.lastUserMessageAt = START - 1000;
    await manager.onAgentUpdate("agent-1");
    expect((await manager.list())[0].status).toBe("waiting_quota");

    now += 1000;
    paseo.agents.get("agent-1")!.lastUserMessageAt = now;
    paseo.finish("agent-1", "Finished by the user");
    await manager.onAgentUpdate("agent-1");
    expect((await manager.list())[0]).toMatchObject({ id: run.id, status: "cancelled" });
    now += 2 * HOUR;
    await manager.tick();
    expect(paseo.agents.get("agent-1")!.sent).toHaveLength(0);
  });

  it("removes credentials before passing conversation text to another provider", async () => {
    use("alpha", "primary");
    use("beta", "auxiliary");
    const manager = build();
    await manager.submit({ prompt: "Use token=abcd1234efgh5678ijkl to call the API", cwd: "/work/repo" });
    paseo.fail("agent-1", "Usage limit reached. Try again in 1 hour.");
    await manager.tick();
    expect(paseo.created[1].prompt).not.toContain("abcd1234efgh5678ijkl");
    expect(paseo.created[1].prompt).toContain("[redacted]");
  });

  it("chooses a reasoning level for the model from the request and the strategy", async () => {
    use("alpha", "primary");
    const manager = build();
    await manager.submit({ prompt: "Fix a typo", cwd: "/work/repo" });
    expect(paseo.created[0].thinkingOptionId).toBe("low");
    await manager.submit({ prompt: "Redesign the module", cwd: "/work/repo", complexity: "high" });
    expect(paseo.created[1].thinkingOptionId).toBe("high");
  });

  it("honours a role's preferred provider and a custom role the user defined", async () => {
    use("alpha", "primary");
    use("beta", "auxiliary");
    const manager = build({ roles: {
      overrides: { developer: { candidates: [{ provider: "beta" }] } },
      custom: [{ id: "doc_writer", kind: "custom", label: "Doc writer", capabilities: ["docs"], candidates: [{ provider: "alpha" }] }],
    } });
    await manager.submit({ prompt: "Implement it", cwd: "/work/repo" });
    await manager.submit({ prompt: "Write the docs", cwd: "/work/repo", role: "doc_writer", capability: "docs" });
    expect(paseo.created.map(item => item.provider)).toEqual(["beta", "alpha"]);
    await expect(manager.submit({ prompt: "x", cwd: "/work/repo", role: "nobody" })).rejects.toThrow(/Unknown role/);
  });
  describe("stall detection", () => {
    const MINUTE = 60_000;
    const quiet = (id: string, since: number) => { paseo.agents.get(id)!.updatedAt = since; };

    it("flags a running agent that made no progress for a long time, once, without touching it", async () => {
      use("alpha", "primary");
      const manager = build();
      await submit(manager);
      quiet("agent-1", now);
      now += 44 * MINUTE;
      await manager.tick();
      expect((await manager.list())[0]).toMatchObject({ status: "running", attention: false });
      now += 2 * MINUTE;
      await manager.tick();
      await manager.tick();
      const [run] = await manager.list();
      expect(run).toMatchObject({ status: "running", attention: true, stall: { lastProgressAt: START } });
      expect(run.history.filter(event => event.kind === "stalled")).toEqual([
        expect.objectContaining({ agentId: "agent-1", note: "no progress for 46 minutes" }),
      ]);
      expect(paseo.created).toHaveLength(1);
      expect(paseo.agents.get("agent-1")).toMatchObject({ status: "running", sent: [] });
    });

    it("clears the flag when the agent makes progress again", async () => {
      use("alpha", "primary");
      const manager = build();
      await submit(manager);
      quiet("agent-1", now);
      now += 60 * MINUTE;
      await manager.tick();
      expect((await manager.list())[0].stall).toBeDefined();
      quiet("agent-1", now - MINUTE);
      await manager.tick();
      const [run] = await manager.list();
      expect(run).toMatchObject({ attention: false });
      expect(run).not.toHaveProperty("stall");
      expect(run.history.map(event => event.kind).slice(-2)).toEqual(["stalled", "progress"]);
    });

    it("uses the turn start when the agent has no later update, and a configured threshold", async () => {
      use("alpha", "primary");
      const manager = build({ stallMs: 10 * MINUTE });
      await submit(manager);
      paseo.agents.get("agent-1")!.turnStartedAt = now;
      now += 11 * MINUTE;
      await manager.tick();
      expect((await manager.list())[0]).toMatchObject({ attention: true, stall: { lastProgressAt: START } });
    });

    it("never flags an agent that waits for a permission the user must answer", async () => {
      use("alpha", "primary");
      const manager = build();
      await submit(manager);
      quiet("agent-1", now);
      paseo.agents.get("agent-1")!.pendingPermissions = 1;
      now += 3 * HOUR;
      await manager.tick();
      const [run] = await manager.list();
      expect(run).toMatchObject({ attention: true });
      expect(run).not.toHaveProperty("stall");
      expect(run.history.some(event => event.kind === "stalled")).toBe(false);
    });

    it("replaces the stall flag with the permission request when one appears", async () => {
      use("alpha", "primary");
      const manager = build();
      await submit(manager);
      quiet("agent-1", now);
      now += HOUR;
      await manager.tick();
      expect((await manager.list())[0].stall).toBeDefined();
      paseo.agents.get("agent-1")!.pendingPermissions = 1;
      await manager.tick();
      const [run] = await manager.list();
      expect(run).toMatchObject({ attention: true });
      expect(run).not.toHaveProperty("stall");
    });

    it("does not confuse a stall with waiting for quota", async () => {
      use("alpha", "primary");
      const manager = build();
      await submit(manager);
      quiet("agent-1", now);
      now += HOUR;
      await manager.tick();
      expect((await manager.list())[0].stall).toBeDefined();
      paseo.fail("agent-1", "Usage limit reached. Try again in 1 hour.");
      await manager.tick();
      const waiting = (await manager.list())[0];
      expect(waiting).toMatchObject({ status: "waiting_quota", attention: false });
      expect(waiting).not.toHaveProperty("stall");
      now += 5 * HOUR;
      await manager.tick();
      expect((await manager.list())[0].history.filter(event => event.kind === "stalled")).toHaveLength(1);
    });

    it("does not flag an agent without a known update time or when the check is off", async () => {
      use("alpha", "primary");
      const manager = build();
      await submit(manager);
      now += 5 * HOUR;
      await manager.tick();
      expect((await manager.list())[0]).toMatchObject({ attention: false });
      expect((await manager.list())[0]).not.toHaveProperty("stall");
      const off = build({ stallMs: 0 });
      quiet("agent-1", START);
      await off.tick();
      expect((await off.list())[0]).not.toHaveProperty("stall");
    });

    it("clears the flag when the run delivers its answer", async () => {
      use("alpha", "primary");
      const manager = build();
      await submit(manager);
      quiet("agent-1", now);
      now += HOUR;
      await manager.tick();
      paseo.finish("agent-1", "Done.");
      await manager.tick();
      expect((await manager.list())[0]).toMatchObject({ status: "delivered", attention: false });
      expect((await manager.list())[0]).not.toHaveProperty("stall");
    });
  });

  it("keeps the first message of an adopted agent once it exists, so a handoff can carry the task", async () => {
    use("alpha", "primary");
    use("beta", "auxiliary");
    const manager = build();
    const native = await paseo.create({ key: "native-2", provider: "alpha", model: "alpha-model", cwd: "/work/repo", prompt: "x", title: "t", metadata: {} });
    const adopted = await manager.adopt({ agentId: native.id, provider: "alpha", model: "alpha-model", cwd: "/work/repo" });
    expect(adopted.prompt).toMatch(/previous agent's conversation/);
    paseo.firstMessages.set(native.id, "Document the parser");
    await manager.tick();
    expect((await manager.list())[0].prompt).toBe("Document the parser");
  });
});
