import assert from "node:assert/strict";
import { setTimeout } from "node:timers/promises";
import { createRepo } from "../paseo-0.17.5/retirement.mjs";
import { connect, eventually, model, observations, pluginId, print, provider } from "./client.mjs";

export async function exercise(probe, git, scope = "all") {
  assert(["all", "recovery"].includes(scope));
  const { clone: cwd } = createRepo(probe, git);
  let { client, api } = await connect(probe);
  const rpc = (method, input = {}) => client.invokePluginRpc(pluginId, `probe.${method}`, input);
  const rows = () => observations(client);
  const state = id => rpc("read", { id });
  const finishes = (id, count = 1) => eventually(rows, logs => logs.filter(row =>
    row.hook === "agent.turn.after" && row.value.agent.id === id).length >= count);
  const after = (logs, id) => logs.filter(row => row.hook === "agent.turn.after" && row.value.agent.id === id)
    .map(row => ({ turnId: row.value.turnId, outcome: row.value.outcome, parent: row.value.agent.parentAgentId }));
  const prompts = (logs, text) => logs.filter(row => row.hook === "provider.session.prompt" && row.value.text === text)
    .map(row => row.value);
  const view = ({ agent, entries }) => ({
    id: agent.id, workspaceId: agent.workspaceId, parentAgentId: agent.parentAgentId, provider: agent.provider,
    model: agent.model, thinking: agent.thinkingOptionId,
    options: agent.options, metadata: agent.metadata, status: agent.status, lastError: agent.lastError,
    archivedAt: agent.archivedAt, persistence: agent.persistence,
    entries: entries.map(row => ({ turnId: row.turnId, item: row.item })),
  });
  async function step(id, run) {
    try {
      return await run();
    } catch (error) {
      print(`${id}-error`, error.stack ?? String(error));
      process.exitCode = 1;
    }
  }
  async function restart() {
    const serverId = client.getLastServerInfoMessage().serverId;
    await client.close();
    probe.stop();
    const start = probe.start();
    assert.equal(start.serverId, serverId);
    ({ client, api } = await connect(probe));
    await eventually(() => api.providers.snapshot(), result =>
      result.entries.some(entry => entry.provider === provider && entry.status === "ready"));
    print("restart", start);
  }
  try {
    const source = { kind: "directory", path: cwd };
    const first = (await client.createWorkspace({ source, title: "fixture-a" })).workspace;
    const second = (await client.createWorkspace({ source, title: "fixture-b" })).workspace;
    assert(first?.id && second?.id && first.id !== second.id);
    await eventually(() => api.providers.snapshot(), result =>
      result.entries.some(entry => entry.provider === provider && entry.status === "ready"));
    await step("P2", async () => {
      const config = { provider, cwd };
      const explicit = await client.createAgent({ config: { ...config, model }, workspaceId: first.id,
        metadata: { fixtureCase: "explicit" } });
      const omitted = await client.createAgent({ config, workspaceId: second.id,
        metadata: { fixtureCase: "omitted" } });
      await assert.rejects(client.createAgent({ config, workspaceId: "fixture-missing" }), /not found|invalid/i);
      await assert.rejects(client.createAgent({ config, workspaceId: first.id,
        metadata: { fixtureReplacement: second.id } }), /cannot change the workspace/i);
      const hooks = (await rows()).filter(row => row.hook === "agent.create.before" && row.value.metadata?.fixtureCase);
      assert.deepEqual(hooks.map(row => row.value.workspaceId), [first.id, second.id]);
      assert.deepEqual(hooks.map(row => row.value.config.model ?? null), [model, null]);
      print("P2", { actual: [explicit.workspaceId, omitted.workspaceId], sameProject: first.projectId === second.projectId,
        sameCwd: first.cwd === second.cwd, unknownRejected: true, rewriteRejected: true, hooks });
    });

    const root = await step("E1", async () => {
      const { id } = await rpc("create", { workspaceId: first.id, prompt: "fixture quota" });
      const logs = await finishes(id);
      const trace = logs.find(row => row.hook === "agent.create.before" && row.value.metadata?.["zelqio-probe.fixture"]);
      const open = logs.find(row => row.hook === "provider.session.open" && row.value.thinking === "fixture-think");
      const snapshot = view(await state(id));
      print("E1-server", { trace, open, snapshot, prompts: prompts(logs, "fixture quota") });
      assert.equal(snapshot.workspaceId, first.id);
      assert.equal(snapshot.metadata["zelqio-probe.fixture"], true);
      assert.equal(trace.value.config.modeId, "fixture-mode");
      assert.deepEqual(trace.value.config.providerOptions, { fixtureLevel: 3 });
      assert.equal(open.value.model, "fixture-other");
      return { id, persistence: open.value.handle };
    });
    await step("E2", async () => {
      await rpc("usage-watch", { active: true });
      try {
        const before = await rpc("usage");
        const accountUpdates = [];
        const accountRead = await client.listUsageReports({ forceRefresh: true },
          report => accountUpdates.push(report));
        const scopedRead = root && await client.listUsageReports({ forceRefresh: true, agentId: root.id });
        await rpc("usage-reset");
        const cachedRead = await rpc("usage");
        const changedUpdates = [];
        const changedRead = await client.listUsageReports({ forceRefresh: true },
          report => changedUpdates.push(report));
        const afterPoll = await rpc("usage");
        const samples = (await rows()).filter(row => row.hook.startsWith("usage.") || row.hook === "providers.subscribe");
        const fixture = reports => reports.filter(report => JSON.stringify(report).includes("fixture-window"));
        print("E2", { before, cachedRead, afterPoll, supportsAccountReports: client.getLastServerInfoMessage().features.usageSources,
          accountReports: fixture(accountRead.reports), scopedReports: fixture(scopedRead?.reports ?? []),
          changedReports: fixture(changedRead.reports), accountUpdates: fixture(accountUpdates),
          changedUpdates: fixture(changedUpdates), samples });
      } finally {
        await rpc("usage-watch", { active: false });
      }
    });
    await step("E3", async () => {
      assert(root);
      const { id: ordinary } = await rpc("create", { workspaceId: first.id, prompt: "fixture error" });
      const logs = await finishes(ordinary);
      const quota = view(await state(root.id));
      const control = view(await state(ordinary));
      assert.equal(quota.status, "error");
      assert.equal(control.status, "error");
      assert.equal(after(logs, root.id)[0].outcome.error.code, "quota_exhausted");
      assert.equal(after(logs, ordinary)[0].outcome.error.code, "fixture_fault");
      print("E3", { quota: { outcomes: after(logs, root.id), ...quota },
        ordinary: { outcomes: after(logs, ordinary), ...control } });
    });
    await step("E5", async () => {
      assert(root);
      const { id } = await rpc("create", { workspaceId: first.id, predecessor: root.id });
      const logs = await finishes(id);
      const result = view(await state(id));
      const handoff = logs.find(row => row.hook === "provider.session.prompt" && row.value.text.includes("fixture handoff"));
      assert.notEqual(id, root.id);
      assert.equal(result.workspaceId, first.id);
      assert.equal(result.provider, "zelqio-fixture-alt");
      assert.equal(result.model, "fixture-default");
      assert.equal(result.metadata.predecessor, root.id);
      assert(handoff?.value.text.includes("fixture quota") && handoff?.value.text.includes("quota_exhausted"));
      print("E5", { result, handoff, predecessor: root.id, predecessorKept: !(await state(root.id)).agent.archivedAt });
    });
    await step("E4", async () => {
      assert(root);
      await restart();
      const { agent } = await client.fetchAgent({ agentId: root.id });
      const baseline = view({ agent, entries: [] });
      assert(!(await rows()).some(row => row.hook === "provider.session.open" && row.value.restored));
      const messageId = "fixture-resume-stable-id";
      await rpc("resume", { id: root.id, messageId });
      await finishes(root.id);
      const duplicate = await Promise.allSettled([
        rpc("resume", { id: root.id, messageId }),
        rpc("resume", { id: root.id, messageId }),
      ]);
      await eventually(() => state(root.id), value => value.agent.status === "idle");
      await setTimeout(1700);
      const logs = await rows();
      const recovery = logs.find(row => row.hook === "provider.session.open" && row.value.restored);
      const open = logs.find(row => row.hook === "agent.open.before" && row.value.agentId === root.id);
      const result = view(await state(root.id));
      assert.deepEqual(recovery.value.handle, root.persistence);
      assert.equal(result.id, root.id);
      assert.equal(open.value.reason, "resume");
      assert.equal(open.value.purpose, "interactive");
      assert.equal(prompts(logs, "fixture resume").length, 1);
      print("E4", { baseline, recovery, open, duplicate: duplicate.map(entry =>
        entry.status === "fulfilled" ? entry : { status: entry.status, reason: String(entry.reason) }),
        executions: prompts(logs, "fixture resume"), outcomes: after(logs, root.id), result });
    });
    if (scope === "recovery") return;
    const child = await step("E7", async () => {
      assert(root);
      const { id } = await rpc("create", { workspaceId: first.id, parent: root.id, prompt: "fixture child" });
      const logs = await finishes(id);
      const result = view(await state(id));
      const outcomes = after(logs, id);
      assert.equal(outcomes[0].parent, root.id);
      assert.equal(outcomes[0].outcome.kind, "completed");
      assert.equal(probe.checked("agent", "inspect", id).ParentAgentId, root.id);
      print("E7", { result, outcomes, nativeParent: root.id });
      return id;
    });
    await step("E6", async () => {
      assert(root);
      const target = child ?? root.id;
      const scheduleId = await schedule(target, root.id);
      assert(scheduleId);
    });
    await step("E5-archive", async () => {
      assert(root);
      const archive = await rpc("archive", { id: root.id });
      print("E5-archive", { archive, predecessor: view(await state(root.id)) });
    });
  } finally {
    await client.close();
  }

  async function schedule(agentId, resumedId) {
    const apiSurface = await rpc("usage");
    const reset = new Date(Math.ceil((Date.now() + 25_000) / 60_000) * 60_000);
    const cadence = { type: "cron", expression: `${reset.getUTCMinutes()} ${reset.getUTCHours()} * * *`, timezone: "UTC" };
    const input = { name: "Fixture reset", prompt: "fixture scheduled reset", cadence,
      target: { type: "agent", agentId }, maxRuns: 1, expiresAt: new Date(+reset + 90_000).toISOString() };
    const created = await client.scheduleCreate(input);
    assert.equal(created.error, null);
    const id = created.schedule.id;
    let expiredId;
    try {
      const expiring = await client.scheduleCreate({ ...input, name: "Fixture expires before reset",
        prompt: "fixture must not run", expiresAt: new Date(+reset - 10_000).toISOString() });
      if (expiring.schedule) expiredId = expiring.schedule.id;
      await restart();
      const retry = await rpc("resume", { id: resumedId, messageId: "fixture-resume-stable-id" });
      await setTimeout(2000);
      print("E4-after-second-restart", { retry, executions: prompts(await rows(), "fixture resume") });
      const inspect = async () => {
        const report = await client.scheduleInspect({ id });
        assert.equal(report.error, null);
        return report.schedule;
      };
      const restored = await inspect();
      const fired = await eventually(inspect, row => row.runs.some(run => run.status !== "running"), 110_000);
      assert.equal(fired.runs.length, 1);
      assert.equal(fired.runs[0].status, "succeeded");
      assert.equal(fired.runs[0].agentId, agentId);
      const logs = await finishes(agentId);
      const expiry = expiredId ? (await client.scheduleInspect({ id: expiredId })).schedule : expiring;
      assert.equal(expiry?.runs?.length ?? 0, 0);
      print("E6", { pluginApi: apiSurface.apiKeys, input, restored, fired, expiry, outcomes: after(logs, agentId),
        executions: logs.filter(row => row.hook === "provider.session.prompt").map(row => row.value) });
      return id;
    } finally {
      await client.scheduleDelete({ id });
      if (expiredId) await client.scheduleDelete({ id: expiredId });
    }
  }
}
