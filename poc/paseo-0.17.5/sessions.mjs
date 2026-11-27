import assert from "node:assert/strict";
import { isDeepStrictEqual } from "node:util";
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { connect, eventually, model, observations, print, provider } from "./client.mjs";
import { createRepo, installObserver } from "./retirement.mjs";
import { schedule } from "./schedule.mjs";

function diff(left, right, parent = "") {
  if (isDeepStrictEqual(left, right)) return [];
  if (left && right && typeof left === "object" && typeof right === "object") {
    return [...new Set([...Object.keys(left), ...Object.keys(right)])].sort()
      .flatMap(key => diff(left[key], right[key], parent ? `${parent}.${key}` : key));
  }
  return [{ field: parent, explicit: left ?? null, default: right ?? null }];
}

function state(agent) {
  return { id: agent.id, status: agent.status, archivedAt: agent.archivedAt, lastError: agent.lastError,
    workspaceId: agent.workspaceId, metadata: agent.metadata, labels: agent.labels, model: agent.model };
}

export async function exercise(probe, git) {
  const { clone: cwd } = createRepo(probe, git);
  installObserver(probe);
  probe.checked("plugin", "install", fileURLToPath(new URL("./rewriter", import.meta.url)));
  let { client, api } = await connect(probe);
  async function step(name, run) {
    try {
      await run();
    } catch (error) {
      print(name + "-error", String(error));
      process.exitCode = 1;
    }
  }
  try {
    await eventually(() => api.providers.snapshot(), result =>
      result.entries.some(entry => entry.provider === provider && entry.status === "ready"));
    const source = { kind: "directory", path: cwd };
    const a = (await client.createWorkspace({ source, title: "fixture-a" })).workspace;
    const b = (await client.createWorkspace({ source, title: "fixture-b" })).workspace;
    assert(a?.id && b?.id && a.id !== b.id);
    const config = { provider, cwd };
    const snapshot = async id => (await client.fetchAgent({ agentId: id }))?.agent;
    const launch = (workspaceId, extra = {}) => client.createAgent({ config, workspaceId, ...extra });
    const id = a.id;
    let restartAgent;
    await step("workspace-binding", async () => {
      const first = await launch(id, { metadata: { clientMarker: "a" } });
      const second = await launch(b.id, { metadata: { clientMarker: "b" } });
      const bogus = "workspace-does-not-exist";
      await assert.rejects(launch(bogus), /not found|invalid/i);
      await assert.rejects(launch(id, { metadata: { fixtureReplacement: b.id } }),
        /cannot change the workspace/);
      const rows = await observations(client);
      const attempts = rows.filter(row => row.hook === "agent.create.before" && row.value.metadata?.clientMarker);
      assert.equal(attempts.length, 2);
      assert.deepEqual(attempts.map(row => row.value.workspaceId), [id, b.id]);
      assert.equal(attempts[0].value.config.cwd, attempts[1].value.config.cwd);
      const projects = rows.filter(row => row.hook === "workspace.create.after").map(row => row.value.workspace.projectId);
      const host = (await api.hosts.list()).self.serverId;
      assert.equal(host, client.getLastServerInfoMessage().serverId);
      const tuples = await Promise.all(attempts.map(async row => {
        const workspace = await api.workspaces.ref(row.value.workspaceId).refresh();
        return [host, workspace.projectId, workspace.id];
      }));
      assert.equal(tuples[0][1], tuples[1][1]);
      assert.notDeepEqual(tuples[0], tuples[1]);
      print("workspace-binding", { ids: [first.workspaceId, second.workspaceId], hookIds: attempts.map(row => row.value.workspaceId),
        sameCwd: true, projects, tuples, unknownRejected: true, rewriteRejected: true });
    });
    await step("model-provenance", async () => {
      async function capture(run) {
        const offset = (await observations(client)).length;
        await run();
        const rows = (await observations(client)).slice(offset);
        const before = rows.find(row => row.hook === "agent.create.before")?.value;
        const open = rows.find(row => row.hook === "agent.open.before")?.value;
        assert(before && open);
        const { agentId, ...comparableOpen } = open;
        return { before, open: comparableOpen, effectiveModel: rows.find(row => row.hook === "provider.session.open")?.value.model };
      }
      const cli = (...extra) => probe.checked("agent", "run", "fixture ok", "--provider", provider,
        "--workspace", id, "--cwd", cwd, "--title", "model-probe", "--wait-timeout", "20s", ...extra);
      const cliExplicit = await capture(() => cli("--model", model));
      const cliDefault = await capture(() => cli());
      print("cli-model", { differences: diff(cliExplicit, cliDefault), effective: cliExplicit.effectiveModel,
        createFields: Object.keys(cliExplicit.before), openFields: Object.keys(cliExplicit.open) });
      const sdkExplicit = await capture(() => launch(id, { config: { ...config, model } }));
      const sdkDefault = await capture(() => launch(id));
      print("low-level-model", { differences: diff(sdkExplicit, sdkDefault), effective: sdkExplicit.effectiveModel });
      await assert.rejects(api.agents.create({ cwd, config: { provider } }), /provider\/model/);
      await api.agents.create({ cwd, config: { provider: `${provider}/${model}` } });
      print("high-level-model", { explicitAccepted: true, providerOnlyRejected: true });
    });
    await step("session-state", async () => {
      const managed = await launch(id, { metadata: { testManaged: true }, labels: { fixture: "supplied" } });
      restartAgent = managed.id;
      const before = state(await snapshot(managed.id));
      await client.sendAgentMessage(managed.id, "fixture ok");
      const running = state(await eventually(() => snapshot(managed.id), value => value?.status === "running"));
      const idle = state(await eventually(() => snapshot(managed.id), value => value?.status === "idle"));
      await client.sendAgentMessage(managed.id, "fixture error");
      const failure = state(await eventually(() => snapshot(managed.id), value => value?.status === "error"));
      const impostor = await launch(b.id, { metadata: { managed: "probe-set" }, labels: { fixture: "supplied" } });
      const impostorBefore = state(await snapshot(impostor.id));
      await client.setAgentMetadata(managed.id, { managed: "client-replaced" });
      await client.updateAgent(managed.id, { labels: { fixture: "client-replaced" } });
      const after = state(await snapshot(managed.id));
      const cliInspect = probe.checked("agent", "inspect", impostor.id);
      const cliArchive = probe.checked("agent", "archive", impostor.id);
      const archived = state(await snapshot(impostor.id));
      const cliClosed = probe.checked("agent", "inspect", impostor.id);
      assert.equal(cliInspect.Status, "idle");
      assert.equal(cliClosed.Status, "closed");
      assert.equal(cliClosed.Archived, true);
      const events = (await observations(client)).filter(row => row.value.agent?.id === impostor.id ||
        row.value.agent?.id === managed.id);
      print("session-state", { before, running, idle, failure, impostorBefore, after, archived,
        cliStatus: [cliInspect.Status, cliClosed.Status], cliArchive: cliArchive.archivedAt,
        events: events.map(row => ({ hook: row.hook, outcome: row.value.outcome, id: row.value.agent.id })) });
    });
    await step("schedule", () => schedule(probe, client, cwd, id, restartAgent));
    await step("resume", async () => {
      assert(restartAgent, "Need a persisted fixture agent");
      await client.close();
      probe.stop();
      print("restart", probe.start());
      ({ client, api } = await connect(probe));
      const marker = join(cwd, "deny-resume");
      writeFileSync(marker, "");
      const baseline = state(await snapshot(restartAgent));
      let denial;
      try {
        const result = probe.paseo("agent", "send", restartAgent, "fixture ok", "--no-wait");
        denial = { code: result.code, response: result.stdout || result.stderr };
        print("resume-denial", denial);
        await eventually(() => observations(client), rows => rows.some(row =>
          row.hook === "agent.open.before" && row.value.agentId === restartAgent && row.value.reason === "resume"));
      } finally {
        rmSync(marker);
      }
      const deniedRows = await observations(client);
      assert(!deniedRows.some(row => row.hook === "provider.session.open" && row.value.restored));
      assert((await snapshot(restartAgent)).persistence?.sessionId, "Expected a stored provider persistence handle");
      await client.sendAgentMessage(restartAgent, "fixture ok");
      const rows = await eventually(() => observations(client), value => value.some(row =>
        row.hook === "provider.session.open" && row.value.restored));
      const final = state(await eventually(() => snapshot(restartAgent), value => value?.status === "idle"));
      print("resume", { baseline, denial, openReasons: rows.filter(row => row.value.agentId === restartAgent)
        .map(row => ({ reason: row.value.reason, purpose: row.value.purpose })), providerRestored: true, final });
    });
  } finally {
    await client.close();
  }
}
