import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AgentToolContext, AgentToolDefinition } from "@getpaseo/plugin/server";
import { AttemptJournal } from "../server/attempt-journal";
import { delegationTools, type ChildSummary } from "../server/delegation-tools";
import { RunManager, type AgentPort, type AgentSnapshot, type CreateAgentInput } from "../server/run-manager";
import { VersionedStore } from "../server/store";
import { runsState, type RunRecord } from "../shared/runs";
import type { ProviderCatalogData } from "../shared/providers";
import { defaultSettings, type ZelqioSettings } from "../shared/settings";

const START = Date.parse("2026-11-27T12:00:00Z");

class FakePaseo implements AgentPort {
  agents = new Map<string, AgentSnapshot & { sent: string[]; parent?: string }>();
  created: CreateAgentInput[] = [];
  replies = new Map<string, string>();
  async create(input: CreateAgentInput) {
    const id = `agent-${this.agents.size + 1}`;
    this.created.push(input);
    this.agents.set(id, { id, status: "running", lastError: null, pendingPermissions: 0, archived: false, restorable: true, lastUserMessageAt: null, sent: [], parent: input.parentAgentId });
    return { id };
  }
  async snapshot(id: string) { return this.agents.get(id) ?? null; }
  async send(id: string, text: string) { const agent = this.agents.get(id)!; agent.sent.push(text); agent.status = "running"; }
  async lastReply(id: string) { return this.replies.get(id) ?? null; }
  async recentActivity() { return ""; }
  async firstUserMessage() { return null; }
  finish(id: string, reply: string) { const agent = this.agents.get(id)!; agent.status = "idle"; this.replies.set(id, reply); }
}

const catalog: ProviderCatalogData = {
  generatedAt: new Date(START).toISOString(),
  providers: [{ id: "alpha", label: "alpha", status: "ready", enabled: true, source: "builtin", modes: [], models: [{ id: "alpha-model", label: "alpha", isDefault: true, selectable: true, thinkingOptions: [] }] }],
};

describe("delegation to native agents", () => {
  let directory: string;
  let paseo: FakePaseo;
  let manager: RunManager;
  let settings: ZelqioSettings;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "zelqio-delegation-"));
    paseo = new FakePaseo();
    settings = { ...defaultSettings(), providers: { alpha: { use: "primary", funding: "subscription" } } };
    manager = new RunManager({
      port: paseo,
      store: new VersionedStore({ dir: directory, name: "runs", version: 1, schema: runsState, defaults: () => ({ runs: [] }) }),
      attempts: new AttemptJournal(directory, () => START),
      readCatalog: async () => catalog, readUsage: async () => null, readSettings: async () => settings,
      clock: () => START, maxConcurrent: 6,
    });
  });
  afterEach(() => rm(directory, { recursive: true, force: true }));

  const root = async () => {
    const run = await manager.submit({ prompt: "Build the feature", cwd: "/work/repo" });
    return { run, agentId: run.current!.agentId };
  };
  const status = async (id: string) => (await manager.list()).find(run => run.id === id)!.status;

  it("creates a delegated task as a native child of the coordinator, on an authorized model", async () => {
    const { run, agentId } = await root();
    const child = await manager.delegate(agentId, { title: "Write tests", prompt: "Write the tests", role: "qa", capability: "test" });
    expect(child).toMatchObject({ status: "running", parentRunId: run.id, title: "Write tests" });
    expect(paseo.created[1]).toMatchObject({ provider: "alpha", model: "alpha-model", parentAgentId: agentId });
    expect(paseo.created[1].metadata["zelqio.parent"]).toBe(run.id);
    expect(paseo.created[1].prompt).toContain("Write the tests");
  });

  it("refuses delegation from anything that is not a coordinator, so it cannot recurse", async () => {
    const { agentId } = await root();
    const child = await manager.delegate(agentId, { title: "Review", prompt: "Review it", role: "reviewer", capability: "review" });
    await expect(manager.delegate(child.current!.agentId, { title: "More", prompt: "More work" })).rejects.toThrow(/coordinator/);
    await expect(manager.delegate("agent-unknown", { title: "x", prompt: "y" })).rejects.toThrow(/coordinator/);
  });

  it("bounds the number of delegated tasks and rejects unknown dependencies and roles", async () => {
    const { agentId } = await root();
    await expect(manager.delegate(agentId, { title: "a", prompt: "a", dependsOn: ["run-missing"] })).rejects.toThrow(/Unknown task/);
    await expect(manager.delegate(agentId, { title: "a", prompt: "a", role: "nobody" })).rejects.toThrow(/Unknown role/);
    for (let index = 0; index < 8; index++) await manager.delegate(agentId, { title: `t${index}`, prompt: `p${index}`, role: "reviewer", capability: "review" });
    await expect(manager.delegate(agentId, { title: "one more", prompt: "x", role: "reviewer", capability: "review" })).rejects.toThrow(/at most 8/);
  });

  it("starts a dependent task only after its dependency is delivered, and fails it if the dependency fails", async () => {
    const { agentId } = await root();
    const first = await manager.delegate(agentId, { title: "Design", prompt: "Design it", role: "reviewer", capability: "review" });
    const second = await manager.delegate(agentId, { title: "Build", prompt: "Build it", role: "reviewer", capability: "review", dependsOn: [first.id] });
    expect(second.status).toBe("queued");
    expect(paseo.created).toHaveLength(2);

    paseo.finish(first.current!.agentId, "design done");
    await manager.tick();
    expect(await status(second.id)).toBe("running");
    expect(paseo.created).toHaveLength(3);

    const third = await manager.delegate(agentId, { title: "Ship", prompt: "Ship it", role: "reviewer", capability: "review", dependsOn: [second.id] });
    await manager.cancelChild(agentId, second.id);
    await manager.tick();
    expect(await status(third.id)).toBe("failed");
  });

  it("runs readers in parallel but never two writers in the same directory at once", async () => {
    const { agentId } = await root();
    const a = await manager.delegate(agentId, { title: "Edit A", prompt: "Edit A", capability: "implement" });
    const b = await manager.delegate(agentId, { title: "Edit B", prompt: "Edit B", capability: "implement" });
    const r1 = await manager.delegate(agentId, { title: "Review 1", prompt: "Review", role: "reviewer", capability: "review" });
    const r2 = await manager.delegate(agentId, { title: "Review 2", prompt: "Review", role: "reviewer", capability: "review" });
    expect([a.status, b.status, r1.status, r2.status]).toEqual(["running", "queued", "running", "running"]);
    paseo.finish(a.current!.agentId, "A done");
    await manager.tick();
    expect(await status(b.id)).toBe("running");
  });

  it("keeps the coordinator open while tasks run, reports the results once, then delivers", async () => {
    const { run, agentId } = await root();
    const child = await manager.delegate(agentId, { title: "Review", prompt: "Review it", role: "reviewer", capability: "review" });
    paseo.finish(agentId, "I delegated the review.");
    await manager.tick();
    expect(await status(run.id)).toBe("running");
    expect(paseo.agents.get(agentId)!.sent).toHaveLength(0);

    paseo.finish(child.current!.agentId, "Looks good");
    await manager.tick();
    await manager.tick();
    expect(paseo.agents.get(agentId)!.sent).toHaveLength(1);
    expect(paseo.agents.get(agentId)!.sent[0]).toContain("Looks good");

    paseo.finish(agentId, "All integrated.");
    await manager.tick();
    expect((await manager.list()).find(entry => entry.id === run.id)).toMatchObject({ status: "delivered", result: "All integrated." });
  });

  it("does not let a waiting coordinator hold the only slot", async () => {
    const tight = new RunManager({
      port: paseo,
      store: new VersionedStore({ dir: directory, name: "tight", version: 1, schema: runsState, defaults: () => ({ runs: [] }) }),
      attempts: new AttemptJournal(directory, () => START),
      readCatalog: async () => catalog, readUsage: async () => null, readSettings: async () => settings,
      clock: () => START, maxConcurrent: 1,
    });
    const run = await tight.submit({ prompt: "Coordinate", cwd: "/work/repo" });
    const child = await tight.delegate(run.current!.agentId, { title: "Work", prompt: "Do it", role: "reviewer", capability: "review" });
    expect(child.status).toBe("running");
  });

  it("stops the delegated tasks when the coordinator run is stopped", async () => {
    const { run, agentId } = await root();
    const child = await manager.delegate(agentId, { title: "Review", prompt: "Review it", role: "reviewer", capability: "review" });
    await manager.cancel(run.id);
    expect(await status(child.id)).toBe("cancelled");
  });

  describe("coordinator tools", () => {
    const summary = (run: RunRecord): ChildSummary => ({ id: run.id, title: run.title ?? "", status: run.status, provider: run.current?.provider, result: run.result, error: run.error });
    const context = (agentId: string): AgentToolContext => ({ agent: { id: agentId } as never, paseo: {} as never, signal: new AbortController().signal });
    const tool = (tools: AgentToolDefinition[], name: string) => tools.find(entry => entry.name === name)!;

    it("delegates, lists and stops through the same limits and never accepts a provider", async () => {
      const { agentId } = await root();
      const tools = delegationTools({
        delegate: async (id, input) => summary(await manager.delegate(id, input)),
        children: async id => (await manager.children(id)).map(summary),
        cancel: async (id, child) => summary(await manager.cancelChild(id, child)),
      });
      expect(tools.map(entry => entry.name)).toEqual(["zelqio_delegate", "zelqio_status", "zelqio_wait", "zelqio_cancel"]);

      const delegate = tool(tools, "zelqio_delegate");
      expect(delegate.input.safeParse({ title: "x", prompt: "y", provider: "other" }).success).toBe(false);
      const parsed = delegate.input.parse({ title: "Review", prompt: "Review it", role: "reviewer", capability: "review" });
      const result = await delegate.execute(parsed, context(agentId));
      expect(result.isError).toBeUndefined();
      const listing = await tool(tools, "zelqio_status").execute({}, context(agentId));
      expect(listing.text).toContain("Review");

      const refused = await delegate.execute(parsed, context("agent-someone-else"));
      expect(refused.isError).toBe(true);
    });
  });
});
