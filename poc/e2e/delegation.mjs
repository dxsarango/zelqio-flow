import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { isolate } from "./isolation.mjs";

const [, , sandbox, runId, git, version = "0.17.6", ...selection] = process.argv;
assert(sandbox && runId && git, "Usage: node poc/e2e/delegation.mjs <sandbox> <run-id> <git.exe> [version] [D1 D2 …]");
assert(selection.every(id => /^D[1-7]$/.test(id)));
const probe = isolate(sandbox, runId, git, version, { delegation: true });
const a = "fixture-a";
const b = "fixture-b";
const terminal = new Set(["delivered", "failed", "cancelled"]);
const names = ["zelqio_cancel", "zelqio_delegate", "zelqio_status", "zelqio_wait"];
const reportText = "The delegated tasks finished.";
const resumeText = "The usage limit was restored.";
let client;
let api;

const output = fields => console.log(JSON.stringify({ version, ...fields }));
const call = (method, input = {}) => client.invokePluginRpc("zelqio-flow", method, input);
async function zelqio(method, input) {
  const result = await call(`zelqio.${method}`, input);
  assert.equal(result.ok, true, JSON.stringify(result));
  return result.data;
}
const list = async () => (await zelqio("runs.list")).runs;
const find = async id => (await list()).find(row => row.id === id);
const submit = scenario => zelqio("runs.submit", { prompt: `[[delegation:${scenario}]]`, cwd: probe.cwd });
const children = (rows, id) => rows.filter(row => row.parentRunId === id);

async function until(read, accept, timeout = 20_000) {
  const deadline = Date.now() + timeout;
  const offset = trace().length;
  do {
    const value = await read();
    if (accept(value)) return value;
    const failure = trace().slice(offset).findLast(row => row.kind === "fixture.error");
    if (failure) throw new Error(failure.message);
    if (Date.now() >= deadline) throw new Error(`Timed out: ${JSON.stringify(value)}`);
    await delay(100);
  } while (true);
}

function trace() {
  const path = join(probe.fixture, "trace.jsonl");
  return existsSync(path) ? readFileSync(path, "utf8").split("\n").slice(0, -1).filter(Boolean).map(JSON.parse) : [];
}

const release = name => writeFileSync(join(probe.fixture, `release-${name}`), "");
const result = (logs, label, sessionId) => logs.find(row => row.kind === "tool.result" && row.label === label
  && (!sessionId || row.sessionId === sessionId))?.result;
const labels = rows => Object.fromEntries(rows.map(row => [row.title, row]));
const prompts = (logs, id) => {
  const turns = new Set(logs.filter(row => row.kind === "agent.turn" && row.id === id).map(row => row.turnId));
  return logs.filter(row => row.kind === "prompt" && turns.has(row.turnId));
};
const session = (logs, id) => prompts(logs, id)[0]?.sessionId;
const toolNames = (logs, sessionId) => logs.find(row => row.kind === "tools.list" && row.sessionId === sessionId)?.tools.map(tool => tool.name).sort();

async function connect() {
  ({ client, api } = await probe.connect());
  const snapshot = await until(() => api.providers.snapshot(), payload =>
    [a, b].every(id => payload.entries.some(entry => entry.provider === id && entry.status === "ready")));
  assert.deepEqual(snapshot.entries.filter(entry => entry.status === "ready").map(entry => entry.provider).sort(), [a, b]);
}

async function settings(useB) {
  const current = await call("settings.general.read");
  assert.equal(current.status, "ready");
  const saved = await call("settings.general.write", {
    revision: current.revision,
    values: { ...current.values, onboardingCompleted: true, consumptionOptIn: false,
      providers: { [a]: { use: "primary", funding: "subscription" }, [b]: { use: useB ? "auxiliary" : "off", funding: "subscription" } } },
  });
  assert.equal(saved.status, "saved", JSON.stringify(saved));
}

async function quota(remainingPct) {
  assert.equal(await client.invokePluginRpc("zelqio-e2e-fixture", "fixture.quota", { provider: a, remainingPct, resetsAt: null }), true);
  const { reports } = await client.listUsageReports();
  const ids = reports.filter(report => [a, b].includes(report.sourceId)).map(report => report.id);
  assert.equal(ids.length, 2);
  const fresh = await client.listUsageReports({ reportIds: ids, forceRefresh: true });
  assert.equal(fresh.reports.find(report => report.sourceId === a)?.report.windows?.[0]?.remainingPct, remainingPct);
}

async function integrated(run) {
  const final = await until(() => find(run.id), row => terminal.has(row?.status), 45_000);
  assert.equal(final.status, "delivered", JSON.stringify(final));
  assert.equal(final.result, "delegation integrated");
  const logs = await until(trace, rows => prompts(rows, run.current.agentId).some(row => row.text.startsWith(reportText)));
  const sessionId = session(logs, run.current.agentId);
  const related = prompts(logs, run.current.agentId);
  const reports = related.filter(row => row.text.startsWith(reportText));
  assert.equal(reports.length, 1);
  assert(!related.some(row => row.text.startsWith(resumeText)));
  return { logs, sessionId, report: reports[0] };
}

async function scenario(id, exercise) {
  if (selection.length && !selection.includes(id)) return;
  const start = Date.now();
  try {
    const observed = await exercise();
    output({ scenario: id, verdict: "PASS", ms: Date.now() - start, ...observed });
  } catch (error) {
    output({ scenario: id, verdict: "FAIL", ms: Date.now() - start, error: error.stack ?? String(error) });
    throw error;
  }
}

try {
  probe.initialize();
  output({ daemon: probe.start() });
  probe.checked("plugin", "install", fileURLToPath(new URL("./fixture/", import.meta.url)));
  probe.checked("plugin", "install", fileURLToPath(new URL("../../", import.meta.url)));
  await connect();
  await settings(false);
  await quota(95);

  let main;
  if (!selection.length || selection.some(id => ["D1", "D2", "D3"].includes(id))) {
    const run = await submit("main");
    const initial = async () => children(await list(), run.id);
    try {
      await scenario("D1", async () => {
        const ordinary = await api.agents.create({ config: { provider: `${b}/${b}-model` }, cwd: probe.cwd, prompt: "Ordinary fixture agent" });
        const automatic = await api.agents.create({
          config: { provider: `${b}/${b}-model` }, cwd: probe.cwd, prompt: "[[delegation:inspect]]",
          clientMessageId: "d1-automatic", metadata: { "zelqio-flow.orchestration": { version: 1, mode: "automatic" } },
        });
        const child = (await until(initial, rows => rows.some(row => row.title === "reviewer"))).find(row => row.title === "reviewer");
        const logs = await until(trace, rows => [ordinary.id, automatic.id, child.current?.agentId].every(id => session(rows, id)));
        const rootSession = logs.find(row => row.kind === "prompt" && row.text === "[[delegation:main]]").sessionId;
        for (const [id, offered] of [[rootSession, names], [session(logs, automatic.id), names], [session(logs, ordinary.id), []], [session(logs, child.current.agentId), []]]) {
          assert.deepEqual(toolNames(logs, id), offered);
          assert.equal(logs.find(row => row.kind === "session.open" && row.sessionId === id)?.delegationGuidance, offered.length > 0);
        }
        return { coordinator: 4, automatic: 4, ordinary: 0, child: 0 };
      });
      await scenario("D2", async () => {
        const rows = labels(await until(initial, rows => rows.length === 4 && rows.some(row => row.title === "dependent")));
        assert.equal(rows["writer-one"].status, "running");
        assert.deepEqual([rows["writer-two"].status, rows.dependent.status], ["queued", "queued"]);
        assert(!rows["writer-two"].current && !rows.dependent.current);
        assert.deepEqual(rows.dependent.dependsOn, [rows["writer-one"].id]);
        assert(rows.reviewer.current);
        release("writer-one");
        const next = labels(await until(initial, rows => rows.filter(row => row.current).length === 4));
        assert.equal(next["writer-one"].status, "delivered");
        const deliveredAt = next["writer-one"].history.find(event => event.kind === "delivered").at;
        assert(next["writer-two"].current.startedAt >= deliveredAt);
        assert(next.dependent.current.startedAt >= deliveredAt);
        release("writer-two");
        for (const row of Object.values(next)) {
          const inspected = probe.checked("agent", "inspect", row.current.agentId);
          assert.equal(inspected.ParentAgentId, run.current.agentId);
          assert.equal(row.current.provider, a);
          assert.equal(row.current.model, `${a}-model`);
          assert.equal(inspected.Provider, a);
          assert.equal(inspected.Model, `${a}-model`);
        }
        return { nativeChildren: 4, writerQueued: true, dependencyDeliveredFirst: true, model: `${a}/${a}-model` };
      });
    } finally {
      release("writer-one");
      release("writer-two");
    }
    await scenario("D3", async () => {
      main = await integrated(run);
      const wait = result(main.logs, "zelqio_wait", main.sessionId);
      const settled = wait.structuredContent.children;
      assert.deepEqual(settled.map(child => child.status), Array(4).fill("delivered"));
      assert(settled.every(child => child.result === `done by ${a}` && main.report.text.includes(child.title)));
      const status = result(main.logs, "zelqio_status", main.sessionId);
      assert.deepEqual(status.structuredContent.children.map(child => child.id).sort(), settled.map(child => child.id).sort());
      const rootTurns = main.logs.filter(row => row.kind === "agent.turn" && row.id === run.current.agentId);
      assert.deepEqual(rootTurns.map(row => row.outcome.kind), ["completed", "completed"]);
      assert.equal(main.report.turnId, rootTurns[1].turnId);
      return { waitResults: 4, reports: 1, coordinatorTurns: 2 };
    });
    if (!main) await integrated(run);
  }

  await scenario("D4", async () => {
    await settings(true);
    const run = await submit("fallback");
    const reassigned = await until(async () => labels(children(await list(), run.id)), rows => rows.limited?.status === "delivered");
    release("survivor");
    const { logs } = await integrated(run);
    const { limited, survivor } = labels(children(await list(), run.id));
    assert.equal(reassigned.limited.current.provider, b);
    assert.equal(limited.history.filter(event => event.kind === "reassigned").length, 1);
    assert.equal(limited.history.filter(event => event.kind === "exhausted").length, 1);
    assert.equal(limited.attempts, 2);
    assert.equal(survivor.attempts, 1);
    assert.equal(survivor.status, "delivered");
    const created = id => logs.filter(row => row.kind === "agent.create" && row.metadata["zelqio.run"] === id);
    assert.deepEqual(created(limited.id).map(row => row.provider), [a, b]);
    assert.equal(created(survivor.id).length, 1);
    assert(created(limited.id).every(row => row.parentAgentId === run.current.agentId));
    assert.equal(logs.find(row => row.kind === "agent.turn" && row.id === created(limited.id)[0].id)?.outcome.error.code, "usage_limit_exceeded");
    return { limitedAttempts: 2, otherChildrenCreated: 1, replacement: b };
  });

  await scenario("D5", async () => {
    await quota(95);
    await settings(false);
    const run = await submit("bound");
    const { logs, sessionId } = await integrated(run);
    const tasks = children(await list(), run.id);
    assert.equal(tasks.length, 8);
    assert(tasks.every(row => row.status === "delivered" && row.attempts === 1 && toolNames(logs, session(logs, row.current.agentId))?.length === 0));
    assert.match(result(logs, "ninth", sessionId).content[0].text, /at most 8/);
    assert(result(logs, "provider argument", sessionId).isError);
    return { accepted: 8, ninthRejected: true, providerArgumentRejected: true, childTools: 0 };
  });

  await scenario("D6", async () => {
    await quota(95);
    await settings(false);
    const run = await submit("cancel");
    const rows = labels(await until(async () => children(await list(), run.id), rows => rows.length === 3));
    assert.equal(rows["cancel-tool"].status, "cancelled");
    assert.equal(rows["cancel-writer"].status, "running");
    assert.equal(rows["cancel-queued"].status, "queued");
    assert.equal((await zelqio("runs.cancel", { id: run.id })).status, "cancelled");
    const stopped = children(await list(), run.id);
    assert(stopped.every(row => row.status === "cancelled"));
    assert.equal(stopped.find(row => row.title === "cancel-queued").attempts, 0);
    const sessions = Object.values(rows).filter(row => row.current).map(row => trace().find(log =>
      log.kind === "prompt" && log.turnId === `${row.id}-a1`)?.sessionId);
    assert(sessions.every(Boolean));
    await until(trace, logs => sessions.every(id => logs.some(row => ["session.interrupt", "session.close"].includes(row.kind) && row.sessionId === id)), 5000);
    release("cancel-tool");
    release("cancel-writer");
    await delay(700);
    assert(!trace().some(row => row.kind === "agent.turn" && stopped.some(child => child.current?.agentId === row.id)
      && row.outcome.kind === "completed"));
    return { toolCancelled: 1, cascadeCancelled: 2, nativeStopped: 2, queuedNeverStarted: true };
  });

  await scenario("D7", async () => {
    await quota(95);
    await settings(false);
    const run = await submit("restart");
    const rootAgent = run.current.agentId;
    await until(trace, logs => logs.some(row => row.kind === "agent.turn" && row.id === rootAgent && row.outcome.kind === "completed"));
    release("restart-child");
    const wait = await until(async () => children(await list(), run.id)[0], row => row?.status === "waiting_quota");
    assert.equal((await find(run.id)).status, "running");
    await client.close();
    client = undefined;
    probe.stop();
    output({ restart: probe.start() });
    await connect();
    await quota(0);
    const persisted = children(await list(), run.id)[0];
    assert.equal(persisted.status, "waiting_quota");
    assert.deepEqual(persisted.current, wait.current);
    assert.equal(persisted.attempts, 1);
    assert.equal((await find(run.id)).status, "running");
    await quota(95);
    const { logs } = await integrated(run);
    const child = await find(wait.id);
    assert.equal(child.status, "delivered");
    assert.deepEqual(child.current, wait.current);
    const resumes = prompts(logs, child.current.agentId).filter(row => row.text.startsWith(resumeText));
    assert.equal(resumes.length, 1);
    assert(logs.some(row => row.kind === "session.open" && row.sessionId === resumes[0].sessionId && row.restored));
    return { firstTrigger: "zelqio.runs.list", restored: true, sameChild: true, resumePrompts: 1, reports: 1 };
  });
} finally {
  try {
    if (client) await client.close();
  } finally {
    try {
      probe.stop();
    } finally {
      probe.verifyCleanup();
    }
  }
}
