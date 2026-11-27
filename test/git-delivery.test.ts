import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runRecord, type RunRecord } from "../shared/runs";
import { defaultSettings } from "../shared/settings";
import { GitDelivery } from "../server/git-delivery";
import { runGitCommand, type GitRunner } from "../server/git-runner";

const runner = runGitCommand(60_000);
const git = (cwd: string, ...args: string[]) => runner("git", args, cwd).then(out => out.trim());
const folders: string[] = [];
const folder = async () => {
  const path = await realpath(await mkdtemp(join(tmpdir(), "zelqio-git-test-")));
  folders.push(path);
  return path;
};
afterEach(async () => {
  for (const path of folders.splice(0)) await rm(path, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

const task = (id: string, cwd: string, parentRunId: string | null = null) => runRecord.parse({
  id, cwd, prompt: "Update the notes", title: "Update the notes", role: "developer", capability: "docs", complexity: null,
  current: null, status: "delivered", attempts: 1, suspended: {}, resumeAt: null, pending: null, handledError: null,
  userBaseline: null, parentRunId, attention: false, result: null, error: null, history: [], createdAt: 1, updatedAt: 1,
});

async function worktree(delivery: GitDelivery, root: string, run: RunRecord) {
  const plan = (await delivery.plan(run.cwd, run))!;
  const cwd = join(root, run.id);
  await git(run.cwd, "worktree", "add", "-b", plan.branch, cwd, plan.baseSha);
  return { ...run, gitPlan: await delivery.attach(plan, cwd, run.id) };
}

async function fixture(wrap?: GitRunner) {
  const root = await folder();
  const source = join(root, "source");
  const remote = join(root, "bare.git");
  const state = join(root, "state");
  await git(root, "init", "--initial-branch=main", source);
  await git(root, "init", "--bare", "--initial-branch=main", remote);
  await git(source, "config", "user.name", "Fixture");
  await git(source, "config", "user.email", "fixture@example.invalid");
  await git(source, "config", "core.autocrlf", "false");
  await writeFile(join(source, "README.md"), "base\n");
  await git(source, "add", "--", "README.md");
  await git(source, "commit", "-m", "docs: initial");
  await git(source, "remote", "add", "origin", remote);
  await git(source, "push", "origin", "main");
  const delivery = new GitDelivery(state, wrap ?? runner);
  const commonDir = await git(source, "rev-parse", "--path-format=absolute", "--git-common-dir");
  const origin = await realpath(remote);
  const authorize = async () => {
    await writeFile(join(state, "git-projects.json"), JSON.stringify([{
      commonDir, base: "main", origin, localDirect: true,
      policy: { project: [{ effect: "allow", action: "git.push", resource: origin + ":refs/heads/main" }] },
    }]));
  };
  return { root, source, remote, state, delivery, authorize };
}

describe("Git delivery in real linked worktrees", { timeout: 240_000 }, () => {
  it("commits and retires a local run while preserving its branch and original checkout", async () => {
    const { root, source, remote, delivery } = await fixture();
    const run = await worktree(delivery, root, task("local", source));
    await writeFile(join(run.gitPlan.cwd!, "README.md"), "local change\n");
    const result = await delivery.deliver(run, defaultSettings());
    expect(result.state).toBe("local");
    expect(await git(source, "log", "-1", "--format=%s", run.gitPlan.branch)).toBe("docs: Update the notes");
    expect(await delivery.retire({ ...run, delivery: result }, async () => true)).toBe(true);
    expect(await git(source, "rev-parse", run.gitPlan.branch)).toBe(result.sha);
    expect(await git(remote, "rev-parse", "main")).toBe(run.gitPlan.baseSha);
    expect(await readFile(join(source, "README.md"), "utf8")).toBe("base\n");
  });

  it("keeps dirty cancelled worktrees and refuses credential paths before staging", async () => {
    const { root, source, delivery } = await fixture();
    const run = await worktree(delivery, root, task("dirty", source));
    await writeFile(join(run.gitPlan.cwd!, "credentials.fixture"), "fixture only");
    expect(await delivery.deliver(run, defaultSettings())).toMatchObject({ state: "blocked", reason: "sensitive_content" });
    expect(await git(run.gitPlan.cwd!, "diff", "--cached", "--name-only")).toBe("");
    expect(await delivery.retire({ ...run, status: "cancelled" }, async () => true)).toBe(false);
    expect(await readFile(join(run.gitPlan.cwd!, "credentials.fixture"), "utf8")).toBe("fixture only");
  });

  it("falls back to a local commit when the project has no destination grant", async () => {
    const { root, source, remote, delivery } = await fixture();
    const run = await worktree(delivery, root, task("no-grant", source));
    await writeFile(join(run.gitPlan.cwd!, "README.md"), "local change\n");
    expect(await delivery.deliver(run, { git: { workflow: "direct" }, mode: "autopilot", remoteAuthorization: "per_project" }))
      .toMatchObject({ state: "remote_denied" });
    expect(await git(remote, "rev-parse", "main")).toBe(run.gitPlan.baseSha);
  });

  it("reconciles a completed direct push after restart without repeating it", async () => {
    let pushed = 0;
    let disconnected = false;
    const interrupted: GitRunner = async (command, args, cwd) => {
      if (disconnected && args.includes("ls-remote")) throw new Error("connection lost after push");
      const out = await runner(command, args, cwd);
      if (args.includes("push")) { pushed++; disconnected = true; throw new Error("daemon stopped after push"); }
      return out;
    };
    const { root, source, remote, state, delivery, authorize } = await fixture(interrupted);
    const run = await worktree(delivery, root, task("direct", source));
    await writeFile(join(run.gitPlan.cwd!, "README.md"), "direct change\n");
    await delivery.deliver(run, defaultSettings()); // create the state directory and commit
    await authorize();
    const settings = { git: { workflow: "direct" as const }, mode: "auto_merge" as const, remoteAuthorization: "per_project" as const };
    const first = await delivery.deliver(run, settings);
    expect(first.state).toBe("blocked");
    expect(pushed).toBe(1);
    expect(await git(remote, "rev-parse", "main")).toBe(first.sha);
    disconnected = false;
    const restarted = new GitDelivery(state, interrupted);
    expect(await restarted.deliver(run, settings)).toMatchObject({ state: "direct", sha: first.sha });
    expect(pushed).toBe(1);
  });

  it("pushes a fork topic to the fork and opens the PR against the verified upstream", async () => {
    const fork = "fixture/fork";
    const upstream = "fixture/upstream";
    const url = (repository: string) => "https://github.com/" + repository + ".git";
    const remotes: Record<string, string> = {};
    let posting = 0;
    let pr: unknown;
    const adapter: GitRunner = async (command, args, cwd) => {
      if (command === "git") {
        if (args.includes("push") || args.includes("ls-remote") && !args.includes("--get-url")) {
          return runner(command, args.map(arg => remotes[arg] ?? arg), cwd);
        }
        return runner(command, args, cwd);
      }
      const route = args[3];
      if (route === "repos/" + fork) return JSON.stringify({
        full_name: fork, default_branch: "main", fork: true, parent: { full_name: upstream }, permissions: { push: true },
      });
      if (route === "repos/" + upstream + "/pulls" && args.includes("POST")) {
        posting++;
        expect(args).toContain("head=fixture:" + expected.branch);
        expect(args).toContain("head_repo=fork");
        expect(args).toContain("base=main");
        pr = { number: 9, html_url: "https://github.com/" + upstream + "/pull/9", state: "open",
          merged_at: null, merge_commit_sha: null, draft: false,
          head: { ref: expected.branch, sha: expected.sha, repo: { full_name: fork } },
          base: { ref: "main", sha: expected.base, repo: { full_name: upstream } } };
        return JSON.stringify(pr);
      }
      if (route.startsWith("repos/" + upstream + "/pulls?")) return JSON.stringify([pr ? [pr] : []]);
      throw new Error("Unexpected forge operation");
    };
    const { root, source, remote, state, delivery } = await fixture(adapter);
    const parent = join(root, "upstream.git");
    await git(root, "clone", "--bare", remote, parent);
    remotes[url(fork)] = remote;
    remotes[url(upstream)] = parent;
    await git(source, "remote", "set-url", "origin", url(fork));
    await git(source, "remote", "add", "upstream", url(upstream));
    const run = await worktree(delivery, root, task("fork", source));
    await writeFile(join(run.gitPlan.cwd!, "README.md"), "fork change\n");
    const local = await delivery.deliver(run, defaultSettings());
    const expected = { branch: run.gitPlan.branch, sha: local.sha!, base: run.gitPlan.baseSha };
    const commonDir = await realpath(join(source, ".git"));
    await writeFile(join(state, "git-projects.json"), JSON.stringify([{
      commonDir, base: "main", origin: fork, upstream,
      policy: { project: [
        { effect: "allow", action: "git.push", resource: fork + ":refs/heads/docs/*" },
        { effect: "allow", action: "pr.create", resource: upstream + ":refs/heads/main" },
      ] },
    }]));
    const settings = { git: { workflow: "fork" as const }, mode: "review_first" as const, remoteAuthorization: "per_project" as const };
    const result = await delivery.deliver(run, settings);
    expect(result).toMatchObject({ state: "review", sha: expected.sha, prUrl: "https://github.com/" + upstream + "/pull/9" });
    expect(await git(remote, "rev-parse", expected.branch)).toBe(expected.sha);
    expect(await git(parent, "rev-parse", "main")).toBe(expected.base);
    expect(posting).toBe(1);
  });

  it("integrates independent children serially and preserves a conflicting child branch", async () => {
    const { root, source, delivery } = await fixture();
    const parent = await worktree(delivery, root, task("parent", source));
    const cwd = parent.gitPlan.cwd!;
    const children = await Promise.all(["first", "second", "third"].map(id => worktree(delivery, root, task(id, cwd, parent.id))));
    await writeFile(join(children[0].gitPlan.cwd!, "README.md"), "first\n");
    await writeFile(join(children[1].gitPlan.cwd!, "other.md"), "second\n");
    await writeFile(join(children[2].gitPlan.cwd!, "README.md"), "conflict\n");
    const completed = [];
    for (const child of children) completed.push({ ...child, delivery: await delivery.deliver(child, defaultSettings()) });
    const [first, second, third] = completed;
    expect(await delivery.integrate(first, parent)).toMatchObject({ state: "integrated" });
    expect(await delivery.integrate(second, parent)).toMatchObject({ state: "integrated" });
    const before = await git(cwd, "rev-parse", "HEAD");
    expect(await delivery.integrate(third, parent)).toMatchObject({ state: "blocked", reason: "integration_conflict" });
    expect(await git(cwd, "rev-parse", "HEAD")).toBe(before);
    expect(await readFile(join(cwd, "README.md"), "utf8")).toBe("first\n");
    expect(await readFile(join(cwd, "other.md"), "utf8")).toBe("second\n");
    expect(await readFile(join(third.gitPlan.cwd!, "README.md"), "utf8")).toBe("conflict\n");
  });
});

const sandbox = "dxsarango/zelqio-flow-s00-public-sandbox";
it.skipIf(!process.env.ZELQIO_GITHUB_SANDBOX_TEST)("publishes to the authorized GitHub sandbox and waits for review", async () => {
  const root = await folder();
  const source = join(root, "source");
  const state = join(root, "state");
  await git(root, "clone", "--branch", "main", "https://github.com/" + sandbox + ".git", source);
  await git(source, "config", "user.name", "Zelqio Flow Sandbox");
  await git(source, "config", "user.email", "fixture@example.invalid");
  await git(source, "config", "--local", "credential.https://github.com.helper", "!gh auth git-credential");
  const commonDir = await realpath(join(source, ".git"));
  const traced: GitRunner = async (command, args, cwd) => {
    try { return await runner(command, args, cwd); }
    catch (error) {
      if (command === "gh" || !args.includes("--get-regexp")) {
        console.info(command, command === "gh" ? args.slice(0, 5).join(" ") : args.slice(11, 14).join(" "), String(error).replaceAll(root, "[fixture]"));
      }
      throw error;
    }
  };
  const delivery = new GitDelivery(state, traced, async () => ({
    commonDir, base: "main", origin: sandbox,
    policy: { global: [], session: [], project: [
      { effect: "allow", action: "git.push", resource: sandbox + ":refs/heads/docs/*" },
      { effect: "allow", action: "pr.create", resource: sandbox + ":refs/heads/main" },
      { effect: "allow", action: "pr.merge", resource: sandbox + ":refs/heads/main" },
    ] },
  }));
  const run = await worktree(delivery, root, task("sandbox-" + Date.now(), source));
  const { branch, cwd } = run.gitPlan;
  await writeFile(join(cwd!, "delivery-fixture-" + run.id + ".md"), "GitHub sandbox delivery check.\n");
  const mode = process.env.ZELQIO_GITHUB_SANDBOX_TEST === "auto_merge" ? "auto_merge" : "review_first";
  const settings = { git: { workflow: "pull_request" }, mode, remoteAuthorization: "per_project" } as const;
  const gh = (...args: string[]) => runner("gh", args, source);
  let result;
  try {
    result = await delivery.deliver(run, settings);
    console.info(JSON.stringify({ branch, ...result }));
    if (mode === "review_first") {
      expect(result).toMatchObject({ state: "review", reason: "human_approval_required", prUrl: expect.stringContaining("/pull/") });
    } else {
      const end = Date.now() + 150_000;
      while (result.state === "checks" && Date.now() < end) {
        await new Promise(resolve => setTimeout(resolve, 5000));
        result = await delivery.deliver({ ...run, delivery: result }, settings);
        console.info(JSON.stringify(result));
      }
      expect(result).toMatchObject({ state: "merged", prUrl: expect.stringContaining("/pull/") });
    }
    const number = result.prUrl!.split("/").at(-1);
    const receipt = await gh("api", "repos/" + sandbox + "/pulls/" + number, "--jq",
      "{number, head: .head.sha, state, merged, merge_commit_sha, base: .base.ref}");
    console.info(receipt.trim());
  } finally {
    const prClosure = await gh("pr", "list", "--repo", sandbox, "--head", branch, "--state", "open", "--json", "number");
    for (const { number } of JSON.parse(prClosure)) await gh("pr", "close", String(number), "--repo", sandbox);
    if (await git(source, "ls-remote", "--heads", "origin", "refs/heads/" + branch)) {
      await git(source, "push", "origin", "--delete", branch);
    }
  }
}, 420_000);
