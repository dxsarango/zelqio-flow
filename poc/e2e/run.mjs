import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { isolate } from "./isolation.mjs";

const [, , sandbox, runId, git, version = "0.17.6", ...options] = process.argv;
const delegation = options.includes("--delegation-isolation");
const selection = options.filter(option => option !== "--delegation-isolation");
assert(sandbox && runId && git, "Usage: node poc/e2e/run.mjs <sandbox> <run-id> <git.exe> [version] [--delegation-isolation] [S1 S2 …]");
assert(selection.every(id => /^S[1-8]$/.test(id)), "Select scenarios S1–S8");
const probe = isolate(sandbox, runId, git, version, { delegation, fixtureTools: false });
const fixturePlugin = "zelqio-e2e-fixture";
const repository = fileURLToPath(new URL("../../", import.meta.url));
const fixture = fileURLToPath(new URL("./fixture/", import.meta.url));
const a = "fixture-a";
const b = "fixture-b";
const resumeText = "The usage limit was restored. Continue the task from where you stopped.";
const terminal = new Set(["delivered", "failed", "cancelled"]);
let client;
let api;

const report = fields => console.log(JSON.stringify({ version, ...fields }));
const call = (method, input = {}) => client.invokePluginRpc("zelqio-flow", method, input);
async function zelqio(method, input) {
  const result = await call(`zelqio.${method}`, input);
  assert.equal(result.ok, true, JSON.stringify(result));
  return result.data;
}
const list = async () => (await zelqio("runs.list")).runs;
const find = async id => (await list()).find(run => run.id === id);
const submit = prompt => zelqio("runs.submit", { prompt, cwd: probe.cwd });

async function eventually(read, accept, timeout = 20_000) {
  const deadline = Date.now() + timeout;
  do {
    const result = await read();
    if (accept(result)) return result;
    if (Date.now() >= deadline) {
      const state = result?.history ? { ...result, history: result.history.slice(-5) } : result;
      throw new Error(`Timed out waiting for state: ${JSON.stringify(state)}`);
    }
    await delay(180);
  } while (true);
}

async function connect() {
  ({ client, api } = await probe.connect());
  const catalog = await eventually(() => api.providers.snapshot(), snapshot =>
    [a, b].every(id => snapshot.entries.some(entry => entry.provider === id && entry.status === "ready")));
  assert.deepEqual(catalog.entries.filter(entry => entry.status === "ready").map(entry => entry.provider).sort(), [a, b],
    "Only the two synthetic providers may be ready in the isolated daemon");
}

async function settings(useB) {
  const current = await call("settings.general.read");
  assert.equal(current.status, "ready", JSON.stringify(current));
  const result = await call("settings.general.write", {
    revision: current.revision,
    values: {
      ...current.values, onboardingCompleted: true, consumptionOptIn: false,
      providers: { [a]: { use: "primary", funding: "subscription" }, [b]: { use: useB ? "auxiliary" : "off", funding: "subscription" } },
    },
  });
  assert.equal(result.status, "saved", JSON.stringify(result));
}

async function setQuota(remainingPct) {
  assert.equal(await client.invokePluginRpc(fixturePlugin, "fixture.quota", {
    provider: a, remainingPct, resetsAt: null,
  }), true);
  await refreshQuota(remainingPct);
}

async function refreshQuota(remainingPct) {
  // Discover the two fixture accounts then refresh only those reports. The legacy
  // SDK projection uses the oldest report timestamp for the whole snapshot.
  const { reports } = await client.listUsageReports();
  const ids = reports.filter(report => [a, b].includes(report.sourceId)).map(report => report.id);
  assert.equal(ids.length, 2, JSON.stringify(reports));
  const usage = await client.listUsageReports({ reportIds: ids, forceRefresh: true });
  const window = usage.reports.find(report => report.sourceId === a)?.report.windows?.[0];
  assert.equal(window?.remainingPct, remainingPct, JSON.stringify(usage));
  if (remainingPct === 0) assert(Date.parse(window.resetsAt) > Date.now());
}

function trace() {
  const file = join(probe.fixture, "trace.jsonl");
  return existsSync(file) ? readFileSync(file, "utf8").trim().split("\n").filter(Boolean).map(line => JSON.parse(line)) : [];
}

async function native(id) {
  const { agent } = await api.agents.ref(id).refresh();
  assert.equal(agent.id, id);
  return agent;
}

async function finished(id, provider, timeout) {
  const actual = await eventually(() => find(id), run => terminal.has(run?.status), timeout);
  assert.equal(actual.status, "delivered", JSON.stringify(actual));
  assert.equal(actual.result, `done by ${provider}`);
  assert.equal(actual.current.provider, provider);
  const agent = await native(actual.current.agentId);
  assert.equal(agent.provider, provider);
  assert.equal(agent.model, `${provider}-model`);
  return actual;
}

async function waiting(prompt) {
  const run = await submit(prompt);
  const actual = await eventually(() => find(run.id), row => row?.status === "waiting_quota" || terminal.has(row?.status));
  assert.equal(actual.status, "waiting_quota", JSON.stringify(actual));
  assert.equal(actual.current.provider, a);
  await refreshQuota(0);
  assert(actual.resumeAt > Date.now());
  return actual;
}

async function reassigned(id, brief, { notice = false, secret } = {}) {
  const run = await finished(id, b);
  const exhaustion = run.history.filter(event => event.kind === "exhausted");
  const assignments = run.history.filter(event => event.kind === "reassigned");
  assert.equal(exhaustion.length, 1);
  assert.equal(assignments.length, 1);
  assert.equal(run.attempts, 2);
  const original = await native(exhaustion[0].agentId);
  assert.equal(original.provider, a);
  assert(!original.archivedAt);
  assert.notEqual(original.id, run.current.agentId);
  const logs = await eventually(trace, entries => entries.some(row => row.kind === "agent.turn" && row.id === original.id));
  const turn = logs.find(row => row.kind === "agent.turn" && row.id === original.id);
  if (notice) {
    assert.equal(exhaustion[0].note, "from the last reply");
    assert.equal(turn.outcome.kind, "completed");
    assert(!original.lastError);
  } else {
    assert.equal(turn.outcome.kind, "failed");
    assert.equal(turn.outcome.error.code, "usage_limit_exceeded");
  }
  const prompt = logs.find(row => row.kind === "prompt" && row.provider === b && row.text.includes(brief));
  assert(prompt?.text.includes("Recent activity of the previous agent"));
  if (secret) {
    assert(!prompt.text.includes(secret));
    assert(prompt.text.includes("[redacted]"));
    assert(prompt.text.includes(`user: ${brief}`), "Expected the initial prompt in Paseo's transcript");
  }
  const created = logs.filter(row => row.kind === "agent.create" && row.provider === b && row.metadata["zelqio.run"] === id);
  assert.deepEqual(created.map(row => row.id), [run.current.agentId]);
  assert.equal(logs.filter(row => row.kind === "prompt" && row.provider === b && row.text.includes(brief)).length, 1);
  return { original: original.id, replacement: run.current.agentId, originalKept: true, replacementPrompts: 1, outcome: turn.outcome.kind };
}

async function resumed(waitingRun, { concurrent = false, restored = false } = {}) {
  const { agentId } = waitingRun.current;
  assert(!trace().some(row => row.kind === "agent.turn" && row.id === agentId && row.outcome.kind === "completed"));
  await setQuota(95);
  await delay(Math.max(0, waitingRun.resumeAt - Date.now() - 100));
  if (concurrent) {
    // Start overlapping RPC-driven ticks just as the timer can resume the run.
    await tickBurst();
  } else {
    // Observe fixtures without invoking runs.list, which would trigger additional ticks.
    await eventually(trace, logs => logs.some(row =>
      row.kind === "agent.turn" && row.id === agentId && row.outcome.kind === "completed"), 40_000);
  }
  const run = await finished(waitingRun.id, a);
  assert.equal(run.current.agentId, agentId);
  assert.equal(run.attempts, 1);
  assert.equal(run.history.filter(event => event.kind === "resumed").length, 1);
  await delay(700);
  const logs = trace();
  const turns = logs.filter(row => row.kind === "agent.turn" && row.id === agentId);
  assert.deepEqual(turns.map(row => row.outcome.kind), ["failed", "completed"]);
  const prompts = logs.filter(row => row.kind === "prompt" && row.turnId === turns[1].turnId && row.text === resumeText);
  assert.equal(prompts.length, 1);
  assert.equal(logs.filter(row => row.kind === "prompt" && row.sessionId === prompts[0].sessionId && row.text === resumeText).length, 1);
  if (restored) assert(logs.some(row => row.kind === "session.open" && row.sessionId === prompts[0].sessionId && row.restored));
  return { agentId, resumePrompts: 1, turns: turns.length, resetWaitMs: waitingRun.resumeAt - waitingRun.updatedAt };
}

async function tickBurst() {
  for (let wave = 0; wave < 8; wave++) {
    await Promise.all([list(), list(), list(), list()]);
    await delay(100);
  }
}

async function scenario(id, exercise) {
  if (selection.length && !selection.includes(id)) return;
  const start = Date.now();
  const previous = new Set((await list()).map(row => row.id));
  try {
    await setQuota(95);
    const detail = await exercise();
    report({ scenario: id, verdict: "PASS", ms: Date.now() - start, ...detail });
  } catch (error) {
    report({ scenario: id, verdict: "FAIL", ms: Date.now() - start, error: String(error) });
    process.exitCode = 1;
    for (const row of await list()) {
      if (!previous.has(row.id) && !terminal.has(row.status)) await zelqio("runs.cancel", { id: row.id });
    }
  }
}

try {
  probe.initialize();
  report({ daemon: probe.start() });
  probe.checked("plugin", "install", fixture);
  probe.checked("plugin", "install", repository);
  await connect();

  await scenario("S1", async () => {
    await settings(true);
    const submitted = await submit("S1 happy path");
    assert(submitted.current?.agentId, JSON.stringify(submitted));
    const result = await finished(submitted.id, a);
    assert.equal(result.current.agentId, submitted.current.agentId);
    assert.equal(result.attempts, 1);
    return { agentId: result.current.agentId, result: result.result };
  });
  await scenario("S2", async () => {
    await settings(true);
    const secret = "fictional-fixture-value";
    const run = await submit(`S2 original brief [[limit]] token=${secret}`);
    return reassigned(run.id, "S2 original brief", { secret });
  });
  await scenario("S3", async () => {
    await settings(false);
    return resumed(await waiting("S3 wait on the original agent [[limit]]"));
  });
  await scenario("S4", async () => {
    await settings(true);
    const run = await submit("S4 reply notice [[limit-reply]]");
    return reassigned(run.id, "S4 reply notice", { notice: true });
  });
  await scenario("S5", async () => {
    await settings(true);
    const config = { provider: `${b}/${b}-model` };
    const manual = await api.agents.create({ config, cwd: probe.cwd, prompt: "S5 manual choice" });
    const manualTurn = await eventually(trace, logs => logs.some(row => row.kind === "agent.turn" && row.id === manual.id));
    assert.equal(manualTurn.find(row => row.kind === "agent.turn" && row.id === manual.id).outcome.kind, "completed");
    const untouched = await native(manual.id);
    assert.equal(untouched.provider, b);
    assert.equal(untouched.model, `${b}-model`);
    assert(!untouched.metadata["zelqio-flow.routing"]);
    assert(!(await list()).some(row => row.current?.agentId === manual.id));
    const adopted = await api.agents.create({
      config, cwd: probe.cwd, prompt: "S5 native Automatic [[limit]]", clientMessageId: "s5-native-automatic",
      metadata: { "zelqio-flow.orchestration": { version: 1, mode: "automatic" } },
    });
    const routed = await native(adopted.id);
    assert.equal(routed.provider, a, JSON.stringify(routed.metadata));
    assert.equal(routed.model, `${a}-model`);
    const run = await eventually(list, rows => rows.some(row => row.history.some(event => event.agentId === adopted.id && event.note === "adopted")));
    const actual = run.find(row => row.history.some(event => event.agentId === adopted.id && event.note === "adopted"));
    return { ...await reassigned(actual.id, "S5 native Automatic"), manualAgent: manual.id, manualProvider: untouched.provider };
  });
  await scenario("S6", async () => {
    await settings(false);
    const before = await waiting("S6 wait across daemon restart [[limit]]");
    await client.close();
    client = undefined;
    probe.stop();
    report({ restart: probe.start() });
    await connect();
    // The first runs RPC gives the restarted plugin its Paseo API and initiates recovery.
    const after = await find(before.id);
    assert.equal(after.status, "waiting_quota", JSON.stringify(after));
    assert.deepEqual(after.current, before.current);
    assert.equal(after.resumeAt, before.resumeAt);
    return { ...await resumed(after, { restored: true }), firstTrigger: "zelqio.runs.list", persistenceRestored: true };
  });
  await scenario("S7", async () => {
    await settings(true);
    const run = await submit("S7 overlapping reassignment [[limit]]");
    await tickBurst();
    const handoff = await reassigned(run.id, "S7 overlapping reassignment");
    await setQuota(95);
    await settings(false);
    const recovery = await resumed(await waiting("S7 overlapping resume [[limit]]"), { concurrent: true });
    return { ...handoff, ...recovery, concurrentListRpcsPerWave: 4 };
  });
  await scenario("S8", async () => {
    await settings(false);
    const run = await waiting("S8 hand over to user [[limit]]");
    const { agentId } = run.current;
    await setQuota(95);
    await api.agents.ref(agentId).send("S8 user takeover", { messageId: "s8-user-takeover" });
    const result = await eventually(() => find(run.id), row => terminal.has(row?.status));
    assert.equal(result.status, "cancelled", JSON.stringify(result));
    assert.equal(result.history.at(-1).note, "the user took over");
    assert.equal(result.attempts, 1);
    assert.equal(result.current.agentId, agentId);
    await delay(700);
    const logs = trace();
    const turns = logs.filter(row => row.kind === "agent.turn" && row.id === agentId);
    assert.deepEqual(turns.map(row => row.outcome.kind), ["failed", "completed"]);
    assert.equal(logs.find(row => row.kind === "prompt" && row.turnId === turns[1].turnId)?.text, "S8 user takeover");
    assert(!result.history.some(event => event.kind === "resumed" || event.kind === "reassigned"));
    return { agentId, runsStopped: true, nativeTurns: 2 };
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
