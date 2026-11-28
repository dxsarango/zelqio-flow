import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AttemptJournal } from "../server/attempt-journal";
import type { GitDelivery } from "../server/git-delivery";
import { RunManager, type AgentPort, type AgentSnapshot, type CreateAgentInput } from "../server/run-manager";
import { VersionedStore } from "../server/store";
import type { ProviderCatalogData } from "../shared/providers";
import { runsState, type RunGitPlan } from "../shared/runs";
import { defaultSettings, type ZelqioSettings } from "../shared/settings";

const WORK = "/work/repo";
const SHA = "a".repeat(40);
const catalog: ProviderCatalogData = {
  generatedAt: "2026-11-28T12:00:00.000Z",
  providers: [{ id: "alpha", label: "alpha", status: "ready", enabled: true, source: "builtin", modes: [], models: [{ id: "alpha-model", label: "alpha", isDefault: true, selectable: true, thinkingOptions: [] }] }],
};

class Port implements AgentPort {
  created: CreateAgentInput[] = [];
  worktrees = 0;
  status: AgentSnapshot["status"] = "running";
  failed: string[] = [];
  async create(input: CreateAgentInput) { this.created.push(input); return { id: `agent-${this.created.length}` }; }
  async snapshot(id: string): Promise<AgentSnapshot> {
    return { id, status: this.status, lastError: null, pendingPermissions: 0, archived: false, restorable: false, lastUserMessageAt: null };
  }
  async send() {}
  async stop() {}
  async lastReply() { return "finished"; }
  async recentActivity() { return ""; }
  async firstUserMessage() { return null; }
  async failedTools() { return this.failed; }
  async createWorktree() { this.worktrees++; return { cwd: "/wt/run", workspaceId: "ws-1" }; }
}

describe("findings from the first real tests", () => {
  let directory: string;
  let port: Port;
  let manager: RunManager;
  let planned: number;
  let baselines: number;
  const plan: RunGitPlan = { repository: "r", source: WORK, baseRef: "refs/heads/main", baseSha: SHA, branch: "zelqio/run" };
  const git = {
    plan: async () => { planned++; return plan; },
    baseline: async () => { baselines++; return { repository: "r", head: SHA, ref: "refs/heads/main", dirty: [] }; },
    attach: async (value: RunGitPlan, cwd: string, workspaceId: string) => ({ ...value, cwd, workspaceId }),
    deliver: async () => ({ state: "local" as const, sha: SHA }),
    retire: async () => false,
    adopt: async () => ({ plan: undefined, delivery: { state: "no_changes" as const, sha: SHA } }),
  } as unknown as GitDelivery;
  const settings: ZelqioSettings = { ...defaultSettings(), providers: { alpha: { use: "primary", funding: "subscription" } } };

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "zelqio-findings-"));
    port = new Port();
    planned = 0;
    baselines = 0;
    manager = new RunManager({
      port,
      store: new VersionedStore({ dir: directory, name: "runs", version: 1, schema: runsState, defaults: () => ({ runs: [] }) }),
      attempts: new AttemptJournal(directory),
      git,
      readCatalog: async () => catalog, readUsage: async () => null, readSettings: async () => settings,
    });
  });
  afterEach(() => rm(directory, { recursive: true, force: true }));

  it("does not create a worktree for a trivial request: it runs in place with a baseline", async () => {
    const run = await manager.submit({ prompt: "Reply with exactly the words: ok.", cwd: WORK });
    expect(planned).toBe(0);
    expect(port.worktrees).toBe(0);
    expect(baselines).toBe(1);
    expect(port.created[0].cwd).toBe(WORK);
    expect(run.adopted).toBeDefined();
    expect(run.gitPlan).toBeUndefined();
  });

  it("still isolates a substantial writing request in its own worktree", async () => {
    await manager.submit({ prompt: "Refactor the module and update the tests.\n".repeat(8), cwd: WORK, complexity: "high" });
    expect(planned).toBe(1);
    expect(port.worktrees).toBe(1);
    expect(port.created[0].cwd).toBe("/wt/run");
  });

  it("does not isolate a request that cannot write", async () => {
    await manager.submit({ prompt: "Review the diff.\n".repeat(30), cwd: WORK, role: "reviewer", capability: "review", complexity: "high" });
    expect(planned).toBe(0);
    expect(port.worktrees).toBe(0);
  });

  it("tells finishing a session apart from meeting its goal", async () => {
    const run = await manager.submit({ prompt: "Reply with exactly the words: ok.", cwd: WORK });
    port.status = "idle";
    await manager.tick();
    expect((await manager.list()).find(entry => entry.id === run.id)).toMatchObject({ status: "delivered", outcome: { state: "ok", notes: [] } });
  });

  it("flags a delivered run when one of its Zelqio tools failed in the last turn", async () => {
    const run = await manager.submit({ prompt: "Reply with exactly the words: ok.", cwd: WORK });
    port.failed = ["zelqio_delegate"];
    port.status = "idle";
    await manager.tick();
    const done = (await manager.list()).find(entry => entry.id === run.id)!;
    expect(done.status).toBe("delivered");
    expect(done.outcome?.state).toBe("needs_review");
    expect(done.outcome?.notes[0]).toMatch(/zelqio_delegate failed/);
  });

  it("flags a coordinator whose delegated task failed", async () => {
    const run = await manager.submit({ prompt: "Coordinate the work.\n".repeat(20), cwd: WORK, complexity: "high" });
    const child = await manager.delegate(run.current!.agentId, { title: "Write tests", prompt: "Write the tests", role: "reviewer", capability: "review" });
    await manager.cancelChild(run.current!.agentId, child.id);
    for (let pass = 0; pass < 6; pass++) {
      port.status = "idle";
      await manager.tick();
    }
    const root = (await manager.list()).find(entry => entry.id === run.id)!;
    expect(root.status).toBe("delivered");
    expect(root.outcome?.state).toBe("needs_review");
    expect(root.outcome?.notes.join(" ")).toMatch(/delegated task was stopped/);
  });
});
