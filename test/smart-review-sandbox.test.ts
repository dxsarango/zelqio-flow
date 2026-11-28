import { appendFile, mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runRecord, type RunDelivery, type RunRecord } from "../shared/runs";
import { GitDelivery } from "../server/git-delivery";
import { runGitCommand } from "../server/git-runner";

/**
 * Smart Review through the product's own delivery code, against the one GitHub repository authorized for tests.
 * Optional: set ZELQIO_SMART_REVIEW_SANDBOX to one of the scenarios below. Every PR and branch it opens is closed or
 * deleted afterwards. The merge scenarios need the sandbox to allow the merge: see docs/evidence/S11-stall-adopted-smart-review.md.
 */
const sandbox = "dxsarango/zelqio-flow-s00-public-sandbox";
const scenario = process.env.ZELQIO_SMART_REVIEW_SANDBOX;
const runner = runGitCommand(60_000);
const git = (cwd: string, ...args: string[]) => runner("git", args, cwd).then(out => out.trim());
const gh = (cwd: string, ...args: string[]) => runner("gh", args, cwd);
const folders: string[] = [];
afterEach(async () => {
  for (const path of folders.splice(0)) await rm(path, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

/** Prints each receipt and, when asked, appends it to a file so the evidence survives the test runner's output handling. */
const record = async (line: string) => {
  console.info(line);
  if (process.env.ZELQIO_SMART_REVIEW_EVIDENCE) await appendFile(process.env.ZELQIO_SMART_REVIEW_EVIDENCE, line + "\n");
};

const settings = { git: { workflow: "pull_request" }, mode: "smart_review", remoteAuthorization: "per_project" } as const;

async function open(name: string, capability: RunRecord["capability"], files: Record<string, string>) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "zelqio-smart-")));
  folders.push(root);
  const source = join(root, "source");
  await git(root, "clone", "--branch", "main", "https://github.com/" + sandbox + ".git", source);
  await git(source, "config", "user.name", "Zelqio Flow Sandbox");
  await git(source, "config", "user.email", "fixture@example.invalid");
  await git(source, "config", "--local", "credential.https://github.com.helper", "!gh auth git-credential");
  const commonDir = await realpath(join(source, ".git"));
  let deferred: Record<string, unknown> | undefined;
  const delivery = new GitDelivery(join(root, "state"), runner, async () => ({
    commonDir, base: "main", origin: sandbox,
    policy: { global: [], session: [], project: ["docs", "test", "feat"].map(type => ({ effect: "allow", action: "git.push", resource: sandbox + ":refs/heads/" + type + "/*" }))
      .concat([{ effect: "allow", action: "pr.create", resource: sandbox + ":refs/heads/main" }, { effect: "allow", action: "pr.merge", resource: sandbox + ":refs/heads/main" }]) },
    ...(deferred ? { deferred } : {}),
  }) as never);
  const id = `smart-${name}-${Date.now()}`;
  const task = runRecord.parse({
    id, cwd: source, prompt: "Smart Review check", title: "Smart Review check " + name, role: "developer", capability, complexity: null,
    current: null, status: "delivered", attempts: 1, suspended: {}, resumeAt: null, pending: null, handledError: null,
    userBaseline: null, attention: false, result: null, error: null, history: [], createdAt: 1, updatedAt: 1,
  });
  const plan = (await delivery.plan(source, task))!;
  const cwd = join(root, id);
  await git(source, "worktree", "add", "-b", plan.branch, cwd, plan.baseSha);
  const run = { ...task, gitPlan: await delivery.attach(plan, cwd, id) };
  for (const [path, text] of Object.entries(files)) {
    await mkdir(dirname(join(cwd, path)), { recursive: true });
    await writeFile(join(cwd, path), text);
  }
  const settle = async (start: RunDelivery | undefined) => {
    let result = await delivery.deliver({ ...run, delivery: start }, settings);
    const end = Date.now() + 170_000;
    while (result.state === "checks" && Date.now() < end) {
      await new Promise(resolve => setTimeout(resolve, 5000));
      result = await delivery.deliver({ ...run, delivery: result }, settings);
    }
    await record(JSON.stringify({ scenario: name, branch: plan.branch, ...result }));
    return result;
  };
  const receipt = async (result: RunDelivery) => {
    const number = result.prUrl!.split("/").at(-1);
    const out = await gh(source, "api", "repos/" + sandbox + "/pulls/" + number, "--jq", "{number, head: .head.sha, state, merged, merge_commit_sha, base: .base.ref}");
    await record(out.trim());
    return JSON.parse(out) as { number: number; head: string; state: string; merged: boolean; merge_commit_sha: string | null };
  };
  const cleanup = async () => {
    const open = await gh(source, "pr", "list", "--repo", sandbox, "--head", plan.branch, "--state", "open", "--json", "number");
    for (const { number } of JSON.parse(open)) await gh(source, "pr", "close", String(number), "--repo", sandbox);
    if (await git(source, "ls-remote", "--heads", "origin", "refs/heads/" + plan.branch)) await git(source, "push", "origin", "--delete", plan.branch);
  };
  return { run, plan, delivery, settle, receipt, cleanup, source, grant: (value: Record<string, unknown>) => { deferred = value; } };
}

const stamp = Date.now();
describe("Smart Review against the GitHub sandbox", () => {
  it.skipIf(scenario !== "docs")("integrates a docs-only change once the checks on the exact SHA pass", async () => {
    const t = await open("docs", "docs", { ["docs/smart-review-" + stamp + ".md"]: "Docs-only Smart Review check.\n" });
    try {
      const result = await t.settle(undefined);
      expect(result).toMatchObject({ state: "merged", prUrl: expect.stringContaining("/pull/") });
      expect(result.reason).toBeUndefined();
      const receipt = await t.receipt(result);
      expect(receipt).toMatchObject({ merged: true, head: result.sha });
    } finally { await t.cleanup(); }
  }, 420_000);

  it.skipIf(scenario !== "test")("integrates a test-only change the same way", async () => {
    const t = await open("test", "test", { ["test/smart-review-" + stamp + ".test.js"]: "// Test-only Smart Review check.\n" });
    try {
      const result = await t.settle(undefined);
      expect(result).toMatchObject({ state: "merged", prUrl: expect.stringContaining("/pull/") });
      expect(await t.receipt(result)).toMatchObject({ merged: true, head: result.sha });
    } finally { await t.cleanup(); }
  }, 420_000);

  it.skipIf(scenario !== "unknown")("keeps a change of unknown risk waiting for a human", async () => {
    const t = await open("unknown", "implement", { ["src/smart-review-" + stamp + ".js"]: "export const value = 1;\n" });
    try {
      const result = await t.settle(undefined);
      expect(result).toMatchObject({ state: "review", reason: "unknown_risk", prUrl: expect.stringContaining("/pull/") });
      expect(await t.receipt(result)).toMatchObject({ merged: false, state: "open" });
    } finally { await t.cleanup(); }
  }, 420_000);

  it.skipIf(scenario !== "sensitive")("keeps a sensitive change waiting for a human", async () => {
    const t = await open("sensitive", "implement", { ["package.json"]: JSON.stringify({ name: "smart-review-" + stamp, private: true }) + "\n" });
    try {
      const result = await t.settle(undefined);
      expect(result).toMatchObject({ state: "review", reason: "human_approval_required", prUrl: expect.stringContaining("/pull/") });
      expect(await t.receipt(result)).toMatchObject({ merged: false, state: "open" });
    } finally { await t.cleanup(); }
  }, 420_000);

  it.skipIf(scenario !== "protected")("leaves a low-risk change to the human when the sandbox still requires an approving review", async () => {
    const t = await open("protected", "docs", { ["docs/smart-review-protected-" + stamp + ".md"]: "Protected check.\n" });
    try {
      const result = await t.settle(undefined);
      expect(result).toMatchObject({ state: "review", reason: "human_approval_required", prUrl: expect.stringContaining("/pull/") });
      expect(await t.receipt(result)).toMatchObject({ merged: false, state: "open" });
    } finally { await t.cleanup(); }
  }, 420_000);

  it.skipIf(scenario !== "deferred")("integrates a reversible interface change only inside a bound deferred-review window", async () => {
    const t = await open("deferred", "ui", { ["client/smart-review-" + stamp + ".css"]: ".smart-review { color: inherit; }\n" });
    try {
      const first = await t.settle(undefined);
      expect(first).toMatchObject({ state: "review", reason: "validation_environment_required", prUrl: expect.stringContaining("/pull/") });
      const binding = (expiresAt: number, sha = first.sha) => ({
        taskId: t.run.id, sha, destination: sandbox + ":refs/heads/main", expiresAt, independentReview: true, validationEnvironment: true,
      });
      t.grant(binding(Date.now() - 1000));
      expect(await t.delivery.deliver({ ...t.run, delivery: first }, settings)).toMatchObject({ state: "review", reason: "validation_environment_required" });
      t.grant(binding(Date.now() + 600_000, "0".repeat(40)));
      expect(await t.delivery.deliver({ ...t.run, delivery: first }, settings)).toMatchObject({ state: "review", reason: "validation_environment_required" });
      expect((await t.receipt(first)).merged).toBe(false);
      t.grant(binding(Date.now() + 600_000));
      const merged = await t.settle(first);
      expect(merged).toMatchObject({ state: "merged", reason: "review_deferred", sha: first.sha });
      expect(await t.receipt(merged)).toMatchObject({ merged: true, head: first.sha });
      expect(await t.delivery.retire({ ...t.run, delivery: merged }, async () => true)).toBe(false);
    } finally { await t.cleanup(); }
  }, 600_000);
});

