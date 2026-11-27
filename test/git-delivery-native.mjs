import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import console from "node:console";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath, URL } from "node:url";
import { isolate } from "../poc/e2e/isolation.mjs";

const [, , sandbox, runId, gitPath] = process.argv;
assert(sandbox && runId && gitPath, "Usage: node test/git-delivery-native.mjs <sandbox> <run-id> <git.exe>");
const probe = isolate(sandbox, runId, gitPath, "0.17.6");
const git = (...args) => execFileSync(gitPath, args, { cwd: probe.cwd, encoding: "utf8", windowsHide: true }).trim();
const plugin = fileURLToPath(new URL("../", import.meta.url));
const fixture = fileURLToPath(new URL("../poc/e2e/fixture/", import.meta.url));
let client;
try {
  probe.initialize();
  git("init", "--initial-branch=main");
  writeFileSync(join(probe.cwd, "README.md"), "git delivery fixture\n");
  git("add", "--", "README.md");
  git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-m", "docs: initialize");
  const base = git("rev-parse", "HEAD");
  probe.start();
  probe.checked("plugin", "install", fixture);
  probe.checked("plugin", "install", plugin);
  const connection = await probe.connect();
  client = connection.client;
  for (let i = 0; i < 20; i++) {
    const catalog = await connection.api.providers.snapshot();
    if (catalog.entries.some(entry => entry.provider === "fixture-a" && entry.status === "ready")) break;
    await delay(300);
  }
  const invoke = (method, input) => client.invokePluginRpc("zelqio-flow", method, input);
  const current = await invoke("settings.general.read", {});
  assert.equal(current.status, "ready");
  assert.equal((await invoke("settings.general.write", { revision: current.revision, values: {
    ...current.values, onboardingCompleted: true, providers: { "fixture-a": { use: "primary", funding: "subscription" } },
  } })).status, "saved");
  const run = await invoke("zelqio.runs.submit", { cwd: probe.cwd, prompt: "Check native worktree placement", capability: "docs", role: "assistant" });
  assert.equal(run.ok, true, JSON.stringify(run));
  const plan = run.data.gitPlan;
  assert(plan?.workspaceId && plan.cwd && plan.cwd !== probe.cwd,
    JSON.stringify({ status: run.data.status, error: run.data.error, state: run.data.delivery, plan: Boolean(plan) }));
  assert.equal(plan.baseSha, base);
  assert.match(plan.branch, /^docs\//);
  let delivered;
  for (let i = 0; i < 25; i++) {
    const rows = await invoke("zelqio.runs.list", {});
    delivered = rows.data.runs.find(entry => entry.id === run.data.id);
    if (delivered?.delivery?.retired) break;
    await delay(600);
  }
  assert.equal(delivered.status, "delivered");
  assert.equal(delivered.delivery.state, "no_changes");
  assert.equal(delivered.delivery.retired, true);
  assert.equal(git("rev-parse", plan.branch), base);
  assert.equal(git("branch", "--show-current"), "main");
  console.log(JSON.stringify({ version: "0.17.6", branch: plan.branch, base, result: delivered.delivery }));
} finally {
  if (client) await client.close();
  probe.stop();
  probe.verifyCleanup();
}
