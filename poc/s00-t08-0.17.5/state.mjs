import assert from "node:assert/strict";
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { join } from "node:path";
import { setTimeout } from "node:timers/promises";
import { eventually, here, provider, report } from "./isolation.mjs";

const observer = "zelqio-t08-observer";
const racer = "zelqio-t08-racer";
const marker = "synthetic-private-message";
const notes = "synthetic-private-notes";
const credential = "synthetic-credential-sentinel";

// Use the actual TypeScript contracts. Node strips types and this hook resolves repo-local extensionless imports.
const repoUrl = new URL("../../", import.meta.url).href;
const resolver = registerHooks({
  resolve(specifier, context, next) {
    try { return next(specifier, context); }
    catch (error) {
      if (error.code !== "ERR_MODULE_NOT_FOUND" || !context.parentURL?.startsWith(repoUrl)
        || !specifier.startsWith(".")) throw error;
      return next(specifier + ".ts", context);
    }
  },
});
const { AttemptJournal } = await import("../../server/attempt-journal.ts");
const { GitOperationJournal } = await import("../../server/git-operation-journal.ts");
const { evaluateRetention, exportFixtures } = await import("../../server/export-retention.ts");
resolver.deregister();

function exportState(probe, before, after, sha) {
  assert.equal(before.agent.id, after.agent.id);
  const { agent } = after;
  const verdict = before.agent.pendingPermissions.length && !agent.pendingPermissions.length ? "FAIL" : "PASS";
  const source = { ...agent, verdict, sha, entries: before.entries, ...before.agent.pendingPermissions[0]?.metadata };
  assert.equal(source.credential, credential);
  const raw = JSON.stringify(source);
  for (const sensitive of [notes, marker, credential, JSON.stringify(agent.cwd).slice(1, -1)]) {
    assert(raw.includes(sensitive), "Expected populated synthetic private fields");
  }
  const data = exportFixtures([source, { ...source, id: "invalid/path" }, { ...source, verdict: "invalid" },
    { ...source, sha: "bad" }, source]);
  assert.deepEqual(data, { version: 1, records: [{ id: agent.id, verdict, sha }], rejected: 4 });
  const saved = exportFixtures([source]);
  writeFileSync(join(probe.home, "allowlisted-export.json"), JSON.stringify(saved, null, 2) + "\n");
  report("real-export", { verified: true, rejected: data.rejected, exportedFields: Object.keys(saved.records[0]) });
}

function checkRetention({ agent }, workspace) {
  assert(agent.activeTurn && agent.pendingPermissions.length === 1);
  const timestamp = Date.parse(agent.createdAt);
  const approval = agent.pendingPermissions[0].id;
  const kind = "fixture";
  const result = evaluateRetention({
    records: [
      { id: agent.id, kind, createdAt: timestamp, refs: [approval] },
      { id: approval, kind, createdAt: timestamp, refs: [workspace] },
      { id: workspace, kind, createdAt: timestamp },
      { id: "unreferenced-control", kind, createdAt: timestamp },
    ],
    activeRefs: [agent.id], maxAgeMs: { [kind]: 1 }, now: Date.now() + 1000,
  });
  assert.equal(result.status, "evaluated");
  assert.deepEqual(result.decisions.map(row => row.decision),
    ["keep_referenced", "keep_referenced", "keep_referenced", "eligible"]);
  report("active-retention", { liveReferencesKept: 3, expiredControlEligible: true });
}

export async function exerciseState(probe, regular) {
  const repo = probe.repo();
  const initial = probe.start();
  probe.checked("plugin", "install", join(here, "observer"));
  probe.checked("plugin", "install", join(here, "racer"));
  const clients = new Set();
  async function connect(id) {
    const client = await probe.connect(id);
    clients.add(client);
    return client;
  }
  let client;
  async function dispatch(label, run) {
    try { return await run(); }
    catch (error) { report(label + "-error", String(error)); process.exitCode = 1; }
  }
  try {
    client = await connect("t08-main");
    const workspace = (await client.createWorkspace({ source: { kind: "directory", path: repo.cwd },
      title: "synthetic-t08" })).workspace;
    assert(workspace?.id);
    const durable = () => readFileSync(join(probe.home, "provider.ndjson"), "utf8").trim().split("\n").map(JSON.parse);
    const pluginState = () => client.invokePluginRpc(observer, "fixture.state", {});
    const view = id => client.fetchAgentTimeline(id, { direction: "tail", limit: 30 });
    const snapshot = data => ({
      status: data.agent.status, active: Boolean(data.agent.activeTurn), pending: data.agent.pendingPermissions.length,
      persistence: Boolean(data.agent.persistence), archived: Boolean(data.agent.archivedAt),
      timelineCount: data.entries.length, message: JSON.stringify(data.entries).includes(marker),
    });
    async function active(title) {
      const agent = await client.createAgent({ config: { provider, cwd: repo.cwd, title }, workspaceId: workspace.id,
        metadata: { notes } });
      await client.sendAgentMessage(agent.id, "synthetic-user-message");
      return eventually(() => view(agent.id), row => {
        const value = snapshot(row);
        return value.active && value.pending === 1 && value.persistence && value.message;
      });
    }
    async function restart(kind, identity, before) {
      const stateBefore = await pluginState();
      const eventsBefore = durable().length;
      const agent = before.agent;
      if (kind === "crash") probe.crash(identity, regular);
      else probe.stop();
      await client.close();
      clients.delete(client);
      const fresh = probe.start();
      assert.equal(fresh.serverId, identity.serverId);
      assert.notEqual(fresh.pid, identity.pid);
      client = await connect(`t08-after-${kind}`);
      // Observe startup, then an exact-ID read, and only then request history.
      await setTimeout(3000);
      const startupEvents = durable().slice(eventsBefore);
      const read = (await client.fetchAgent(agent.id)).agent;
      const readEvents = durable().slice(eventsBefore + startupEvents.length);
      const after = await view(agent.id);
      const stateAfter = await pluginState();
      const historyEvents = durable().slice(eventsBefore + startupEvents.length + readEvents.length);
      const activity = events => events.filter(row => row.event !== "close").map(row => row.event);
      assert.equal(read.id, agent.id);
      assert.equal(read.workspaceId, agent.workspaceId);
      assert.equal(after.agent.id, agent.id);
      assert.equal(after.agent.workspaceId, agent.workspaceId);
      assert.equal(after.agent.metadata?.notes, notes);
      assert.equal(stateAfter.memory, stateBefore.memory);
      report(kind, { before: snapshot(before), after: snapshot(after), memory: "preserved",
        beforeHistory: { status: read.status, active: Boolean(read.activeTurn), pending: read.pendingPermissions.length,
          persistence: Boolean(read.persistence) }, volatile: [stateBefore.volatile, stateAfter.volatile],
        startup: activity(startupEvents), exactRead: activity(readEvents), historyRead: activity(historyEvents),
        additionalLifecycle: startupEvents.filter(row => row.event === "close").length,
        verdict: read.pendingPermissions.length === 1 && activity(startupEvents).length === 0 ? "PASS" : "FAIL" });
      return { identity: fresh, after };
    }

    const graceful = await dispatch("graceful", async () => restart("graceful", initial, await active("graceful")));
    if (!graceful) return;
    const beforeCrash = await active("crash");
    await dispatch("retention", () => checkRetention(beforeCrash, workspace.id));
    const journalDir = join(probe.home, "zelqio-journals");
    const attempt = new AttemptJournal(journalDir);
    const gitJournal = new GitOperationJournal(journalDir);
    const id = beforeCrash.agent.id;
    const targetRef = "refs/heads/main";
    const repository = repo.g("rev-parse", "--path-format=absolute", "--git-common-dir");
    assert.equal((await attempt.reserve({ key: id, task: "crash-effect", attempt: 1, maxConcurrent: 1 })).status, "reserved");
    assert.equal((await attempt.confirmLaunch({ key: id, agentRef: id })).status, "recorded");
    assert.equal(await gitJournal.recordIntent({ id, repository, targetRef, previousSha: repo.previousSha,
      expectedSha: repo.expectedSha }), "recorded");
    let effectReply = "pending";
    const effect = client.invokePluginRpc(observer, "fixture.effect", { before: repo.previousSha, after: repo.expectedSha })
      .then(() => { effectReply = "acknowledged"; }, () => { effectReply = "disconnected"; });
    await eventually(() => existsSync(join(repo.cwd, "effect.txt")) && repo.g("rev-parse", targetRef), sha => sha === repo.expectedSha);
    assert.equal(effectReply, "pending");
    const crashed = await restart("crash", graceful.identity, beforeCrash);
    await effect;
    await dispatch("effects", async () => {
      const reopened = new AttemptJournal(journalDir);
      assert.equal(await reopened.recoverAfterRestart(), 1);
      const [entry] = (await reopened.read()).entries;
      assert.equal(entry.status, "ambiguous");
      assert.equal((await reopened.reserve({ key: "other", task: "other", attempt: 1, maxConcurrent: 1 })).status, "blocked");
      assert.equal(readFileSync(join(repo.cwd, "effect.txt"), "utf8"), "synthetic file effect\n");
      const refSha = repo.g("rev-parse", targetRef);
      repo.g("cat-file", "-e", `${refSha}^{commit}`);
      const result = await new GitOperationJournal(journalDir).reconcile(id, {
        repository: repo.g("rev-parse", "--path-format=absolute", "--git-common-dir"), ref: targetRef,
        observation: { status: "present", sha: refSha, object: "verified" },
      });
      assert.equal(result.status, "applied");
      assert.equal(effectReply, "disconnected");
      assert.equal(JSON.stringify(crashed.after.entries).includes("effect.txt"), false);
      assert.equal(JSON.stringify(crashed.after).includes(refSha), false);
      report("effects", { reply: effectReply, fileObserved: true, git: result.status, attempt: entry.status,
        slotHeld: true, effectPresentInNativeTimeline: false });
    });
    await dispatch("export", () => exportState(probe, beforeCrash, crashed.after, repo.expectedSha));

    await dispatch("permission-race", async () => {
      const peer = await connect("t08-peer");
      for (const [behavior, pluginBehavior] of [["allow", "allow"], ["deny", "allow"]]) {
        const { agent } = await active(`race-${behavior}`);
        const requestId = agent.pendingPermissions[0].id;
        const decisions = event => durable().filter(row => row.event === event && row.requestId === requestId);
        const startedAt = Date.now();
        const results = await Promise.allSettled([
          client.respondToPermission(agent.id, requestId, { behavior }),
          peer.respondToPermission(agent.id, requestId, { behavior }),
          peer.invokePluginRpc(racer, "fixture.decide", { agentId: agent.id, requestId, behavior: pluginBehavior }),
        ]);
        await eventually(() => view(agent.id), value => !value.agent.activeTurn && value.agent.pendingPermissions.length === 0);
        await setTimeout(1200);
        const records = decisions("provider.decision");
        const concurrent = records.map(row => row.behavior);
        const hostEvents = decisions("host.resolved").map(row => row.behavior);
        const contender = readFileSync(join(probe.home, "racer.ndjson"), "utf8").trim().split("\n").map(JSON.parse)
          .find(row => row.requestId === requestId);
        assert(contender?.at >= startedAt && contender.at < records[0].at + 600);
        await peer.respondToPermission(agent.id, requestId, { behavior: behavior === "allow" ? "deny" : "allow" });
        await setTimeout(1200);
        const afterReplay = decisions("provider.decision").map(row => row.behavior);
        report("permission-race", { behavior, pluginBehavior, pluginDuringRace: true,
          submitted: results.map(row => row.status), concurrent,
          hostEvents, afterReplay, verdict: concurrent.length === 1 && hostEvents.length === 1 && afterReplay.length === 1
            ? "PASS" : "FAIL" });
      }
    });
    await dispatch("retirement", () => retire(probe, repo, workspace.id, client, pluginState));
  } finally {
    await Promise.allSettled([...clients].map(socket => socket.close()));
  }
}

async function retire(probe, repo, workspace, client, pluginState) {
  // Native services are independently started/stopped on the same fixture workspace.
  writeFileSync(join(repo.cwd, "service.cjs"), "setInterval(() => {}, 1000);\n");
  const script = { type: "service", command: "node service.cjs" };
  writeFileSync(join(repo.cwd, "paseo.json"), JSON.stringify({ scripts: { control: script, retired: script } }));
  const profiles = ["control", "retired"].map(name => ({ id: `fixture-${name}`, name, provider }));
  const config = await client.patchDaemonConfig({ agentProfiles: profiles });
  assert.deepEqual(config.config.agentProfiles, profiles);
  writeFileSync(join(repo.cwd, "tracked.txt"), "synthetic dirty tracked file\n");
  writeFileSync(join(repo.cwd, "sentinel.txt"), "synthetic dirty untracked file\n");
  const control = await pluginState();
  const gitStatus = () => repo.g("status", "--porcelain=v1", "--untracked-files=all");
  const dirty = gitStatus();
  for (const name of ["control", "retired"]) {
    assert.equal((await client.startWorkspaceScriptWithStatus(workspace, name)).error, null);
  }
  const services = async () => Object.fromEntries((await client.listWorkspaceScripts(workspace)).scripts
    .map(({ scriptName, lifecycle }) => [scriptName, lifecycle]));
  try {
    await eventually(services, row => row.control === "running" && row.retired === "running");
    assert.equal((await client.stopWorkspaceScript(workspace, "retired")).error, null);
    assert.deepEqual((await client.patchDaemonConfig({ agentProfiles: profiles.slice(0, 1) })).config.agentProfiles,
      profiles.slice(0, 1));
    writeFileSync(join(probe.home, "retired-memory.txt"), "synthetic retired memory\n");
    const retiredMemory = join(probe.home, "retired-memory.txt");
    unlinkSync(retiredMemory);
    const decision = { agentId: "missing-agent", requestId: "missing-request", behavior: "deny" };
    probe.checked("plugin", "disable", racer);
    await assert.rejects(() => client.invokePluginRpc(racer, "fixture.decide", decision));
    probe.checked("plugin", "remove", racer);
    await assert.rejects(() => client.invokePluginRpc(racer, "fixture.decide", decision));
    assert.deepEqual(await pluginState(), control);
    assert.deepEqual(await services(), { control: "running", retired: "stopped" });
    assert.deepEqual((await client.getDaemonConfig()).config.agentProfiles, profiles.slice(0, 1));
    assert.equal(existsSync(retiredMemory), false);
    assert.equal(gitStatus(), dirty);
    assert.equal(repo.g("rev-parse", "HEAD"), repo.expectedSha);
    assert.equal(readFileSync(join(repo.cwd, "tracked.txt"), "utf8"), "synthetic dirty tracked file\n");
    assert.equal(readFileSync(join(repo.cwd, "sentinel.txt"), "utf8"), "synthetic dirty untracked file\n");
    report("retirement", { preserved: ["control plugin and state", "control service", "control profile",
      "control memory fixture", "Git HEAD", "tracked and untracked files"], retired: ["plugin", "service", "profile", "memory fixture"] });
  } finally {
    await client.stopWorkspaceScript(workspace, "control");
    await client.stopWorkspaceScript(workspace, "retired");
  }
}
