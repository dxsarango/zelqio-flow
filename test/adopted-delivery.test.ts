import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ProviderCatalogData } from "../shared/providers";
import { runRecord, runsState, type RunRecord } from "../shared/runs";
import { defaultSettings } from "../shared/settings";
import { AttemptJournal } from "../server/attempt-journal";
import { GitDelivery } from "../server/git-delivery";
import { runGitCommand } from "../server/git-runner";
import { RunManager, type AgentPort, type AgentSnapshot } from "../server/run-manager";
import { VersionedStore } from "../server/store";

const runner = runGitCommand(60_000);
const git = (cwd: string, ...args: string[]) => runner("git", args, cwd).then(out => out.trim());
const folders: string[] = [];
const folder = async () => {
  const path = await realpath(await mkdtemp(join(tmpdir(), "zelqio-adopt-")));
  folders.push(path);
  return path;
};
afterEach(async () => {
  for (const path of folders.splice(0)) await rm(path, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

async function fixture() {
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
  await writeFile(join(source, "notes.md"), "notes\n");
  await git(source, "add", "--", "README.md", "notes.md");
  await git(source, "commit", "-m", "docs: initial");
  await git(source, "remote", "add", "origin", remote);
  await git(source, "push", "origin", "main");
  await mkdir(state, { recursive: true });
  /** A checkout Paseo would create for a native agent: a linked worktree on its own branch. */
  const linked = async (name: string) => {
    const cwd = join(root, name);
    await git(source, "worktree", "add", "-b", "paseo/" + name, cwd, "main");
    return cwd;
  };
  return { root, source, remote, state, linked, delivery: new GitDelivery(state, runner) };
}

const adopted = (id: string, cwd: string, baseline: NonNullable<RunRecord["adopted"]>, extra: Partial<RunRecord> = {}) => runRecord.parse({
  id, cwd, prompt: "Update the notes", title: "Update the notes", role: "developer", capability: "implement", complexity: null,
  current: null, status: "delivered", attempts: 1, suspended: {}, resumeAt: null, pending: null, handledError: null,
  userBaseline: null, attention: false, result: null, error: null, history: [], createdAt: 1, updatedAt: 1,
  adopted: baseline, delivery: { state: "pending" }, ...extra,
});

describe("delivery of adopted sessions", { timeout: 120_000 }, () => {
  it("records the head and the files that were already modified, and ignores folders that are not repositories", async () => {
    const { source, state, delivery, root } = await fixture();
    await writeFile(join(source, "README.md"), "already changed\n");
    await writeFile(join(source, "scratch.txt"), "mine\n");
    const baseline = await delivery.baseline(source);
    expect(baseline).toMatchObject({ head: await git(source, "rev-parse", "HEAD"), ref: "refs/heads/main" });
    expect(baseline?.dirty.sort()).toEqual(["README.md", "scratch.txt"]);
    const plain = join(root, "plain");
    await mkdir(plain);
    expect(await delivery.baseline(plain)).toBeNull();
    expect(state).toBeTruthy();
  });

  it("commits the agent's changes on a new branch from a linked worktree without touching that checkout", async () => {
    const { source, remote, linked, delivery } = await fixture();
    const cwd = await linked("agent");
    const baseline = (await delivery.baseline(cwd))!;
    expect(baseline.dirty).toEqual([]);
    await writeFile(join(cwd, "README.md"), "agent change\n");
    await writeFile(join(cwd, "added.md"), "new file\n");
    const before = { head: await git(cwd, "rev-parse", "HEAD"), branch: await git(cwd, "branch", "--show-current") };

    const run = adopted("adopted-linked", cwd, baseline);
    const prepared = await delivery.adopt(run, "Update the notes");
    expect(prepared.delivery).toMatchObject({ state: "pending" });
    const plan = prepared.plan!;
    expect(plan.branch).toMatch(/^feat\/update-the-notes-adopted-linked$/);
    expect(plan.cwd).not.toBe(cwd);

    // The agent's checkout is exactly as it was: same branch, same HEAD, same dirty files, nothing staged.
    expect(await git(cwd, "branch", "--show-current")).toBe(before.branch);
    expect(await git(cwd, "rev-parse", "HEAD")).toBe(before.head);
    expect(await git(cwd, "diff", "--cached", "--name-only")).toBe("");
    expect(await git(cwd, "status", "--porcelain")).toBe("M README.md\n?? added.md");
    expect(await readFile(join(cwd, "README.md"), "utf8")).toBe("agent change\n");
    expect(await git(source, "rev-parse", "main")).toBe(baseline.head);

    // The new branch carries the work as a Conventional Commit on top of the agent's HEAD.
    expect(await git(source, "log", "-1", "--format=%s", plan.branch)).toBe("feat: Update the notes");
    expect(await git(source, "rev-parse", plan.branch + "^")).toBe(before.head);
    expect((await git(source, "diff", "--name-only", before.head, plan.branch)).split("\n").sort()).toEqual(["README.md", "added.md"]);

    const delivered = await delivery.deliver({ ...run, gitPlan: plan, delivery: prepared.delivery }, defaultSettings());
    expect(delivered).toMatchObject({ state: "local", sha: prepared.delivery.sha });
    expect(await git(remote, "rev-parse", "main")).toBe(baseline.head);
    expect(await delivery.retire({ ...run, gitPlan: plan, delivery: delivered }, async () => true)).toBe(true);
    expect(await git(source, "rev-parse", plan.branch)).toBe(delivered.sha);
    expect(await readFile(join(cwd, "added.md"), "utf8")).toBe("new file\n");
  });

  it("is safe to repeat after an interruption: the same branch and worktree are reused", async () => {
    const { linked, delivery, state } = await fixture();
    const cwd = await linked("again");
    const baseline = (await delivery.baseline(cwd))!;
    await writeFile(join(cwd, "README.md"), "change\n");
    const run = adopted("adopted-again", cwd, baseline);
    const first = await delivery.adopt(run, "Update the notes");
    const second = await new GitDelivery(state, runner).adopt(run, "Update the notes");
    expect(second).toEqual(first);
  });

  it("publishes the adopted work through the same direct mode as a managed run", async () => {
    const { source, remote, state, linked, delivery } = await fixture();
    const cwd = await linked("direct");
    const baseline = (await delivery.baseline(cwd))!;
    await writeFile(join(cwd, "README.md"), "direct change\n");
    const run = adopted("adopted-direct", cwd, baseline);
    const prepared = await delivery.adopt(run, "Update the notes");
    const commonDir = await git(source, "rev-parse", "--path-format=absolute", "--git-common-dir");
    const origin = await realpath(remote);
    await writeFile(join(state, "git-projects.json"), JSON.stringify([{
      commonDir, base: "main", origin, localDirect: true,
      policy: { project: [{ effect: "allow", action: "git.push", resource: origin + ":refs/heads/main" }] },
    }]));
    const settings = { git: { workflow: "direct" as const }, mode: "auto_merge" as const, remoteAuthorization: "per_project" as const };
    const result = await delivery.deliver({ ...run, gitPlan: prepared.plan, delivery: prepared.delivery }, settings);
    expect(result).toMatchObject({ state: "direct", sha: prepared.delivery.sha });
    expect(await git(remote, "rev-parse", "main")).toBe(result.sha);
    expect(await readFile(join(cwd, "README.md"), "utf8")).toBe("direct change\n");
  });

  it("keeps the agent's own commits and adds the uncommitted rest", async () => {
    const { source, linked, delivery } = await fixture();
    const cwd = await linked("commits");
    const baseline = (await delivery.baseline(cwd))!;
    await writeFile(join(cwd, "notes.md"), "committed by the agent\n");
    await git(cwd, "add", "--", "notes.md");
    await git(cwd, "commit", "-m", "wip");
    await writeFile(join(cwd, "README.md"), "left dirty\n");
    const prepared = await delivery.adopt(adopted("adopted-commits", cwd, baseline), "Update the notes");
    const files = (await git(source, "diff", "--name-only", baseline.head, prepared.plan!.branch)).split("\n").sort();
    expect(files).toEqual(["README.md", "notes.md"]);
    expect(await git(source, "rev-list", "--count", baseline.head + ".." + prepared.plan!.branch)).toBe("2");
  });

  it("delivers the agent's commits when nothing is left uncommitted", async () => {
    const { source, linked, delivery } = await fixture();
    const cwd = await linked("clean");
    const baseline = (await delivery.baseline(cwd))!;
    await writeFile(join(cwd, "notes.md"), "committed by the agent\n");
    await git(cwd, "add", "--", "notes.md");
    await git(cwd, "commit", "-m", "docs: update notes");
    const head = await git(cwd, "rev-parse", "HEAD");
    const prepared = await delivery.adopt(adopted("adopted-clean", cwd, baseline), "Update the notes");
    expect(prepared.delivery.sha).toBe(head);
    expect(await git(source, "rev-parse", prepared.plan!.branch)).toBe(head);
  });

  it("reports no changes when the agent changed nothing", async () => {
    const { linked, delivery } = await fixture();
    const cwd = await linked("idle");
    const baseline = (await delivery.baseline(cwd))!;
    expect(await delivery.adopt(adopted("adopted-idle", cwd, baseline), null)).toEqual({ delivery: { state: "no_changes", sha: baseline.head } });
  });

  it("never commits or publishes from the user's main checkout and suggests the exact next step", async () => {
    const { source, remote, delivery } = await fixture();
    const baseline = (await delivery.baseline(source))!;
    await writeFile(join(source, "README.md"), "agent edit in the main checkout\n");
    const branches = await git(source, "branch", "--list");
    const result = await delivery.adopt(adopted("adopted-main", source, baseline), "Update the notes");
    expect(result.plan).toBeUndefined();
    expect(result.delivery).toMatchObject({ state: "manual", reason: "main_checkout",
      next: 'git switch -c feat/update-the-notes-adopted-main && git add -A && git commit -m "feat: Update the notes"' });
    expect(await git(source, "rev-parse", "HEAD")).toBe(baseline.head);
    expect(await git(source, "branch", "--list")).toBe(branches);
    expect(await git(source, "status", "--porcelain")).toBe("M README.md");
    expect(await git(remote, "rev-parse", "main")).toBe(baseline.head);
    expect(await git(source, "stash", "list")).toBe("");
  });

  it("suggests only a branch when the main checkout holds committed agent work", async () => {
    const { source, delivery } = await fixture();
    const baseline = (await delivery.baseline(source))!;
    await writeFile(join(source, "notes.md"), "committed\n");
    await git(source, "add", "--", "notes.md");
    await git(source, "commit", "-m", "docs: notes");
    const result = await delivery.adopt(adopted("adopted-main-committed", source, baseline), "Update the notes");
    expect(result.delivery).toMatchObject({ state: "manual", reason: "main_checkout", next: "git branch feat/update-the-notes-adopted-main-committed" });
  });

  it("does not attribute changes that were already in the checkout before the agent started", async () => {
    const { linked, delivery, source } = await fixture();
    const cwd = await linked("busy");
    await writeFile(join(cwd, "scratch.txt"), "the user's own work\n");
    const baseline = (await delivery.baseline(cwd))!;
    expect(baseline.dirty).toEqual(["scratch.txt"]);
    await writeFile(join(cwd, "README.md"), "agent change\n");
    const result = await delivery.adopt(adopted("adopted-busy", cwd, baseline), "Update the notes");
    expect(result.delivery).toMatchObject({ state: "manual", reason: "baseline_dirty" });
    expect(await git(source, "branch", "--list", "feat/*")).toBe("");
    expect(await git(cwd, "status", "--porcelain")).toBe("M README.md\n?? scratch.txt");
  });

  it("does not deliver when the checkout no longer follows the recorded history", async () => {
    const { linked, delivery, source } = await fixture();
    const cwd = await linked("moved");
    const baseline = (await delivery.baseline(cwd))!;
    await git(cwd, "checkout", "--orphan", "other");
    await git(cwd, "rm", "-rf", "--quiet", ".");
    await writeFile(join(cwd, "other.md"), "unrelated\n");
    await git(cwd, "add", "--", "other.md");
    await git(cwd, "commit", "-m", "docs: unrelated");
    await writeFile(join(cwd, "other.md"), "unrelated and dirty\n");
    const result = await delivery.adopt(adopted("adopted-moved", cwd, baseline), "Update the notes");
    expect(result.delivery).toMatchObject({ state: "manual", reason: "checkout_moved" });
    expect(await git(source, "branch", "--list", "feat/*")).toBe("");
  });

  it("refuses credential files and leaves the checkout alone", async () => {
    const { linked, delivery, source } = await fixture();
    const cwd = await linked("secret");
    const baseline = (await delivery.baseline(cwd))!;
    await writeFile(join(cwd, "credentials.fixture"), "fixture only");
    const result = await delivery.adopt(adopted("adopted-secret", cwd, baseline), "Update the notes");
    expect(result.delivery).toMatchObject({ state: "blocked", reason: "sensitive_content" });
    expect(await git(cwd, "diff", "--cached", "--name-only")).toBe("");
    expect(await git(source, "branch", "--list", "feat/*")).toBe("");
    expect(await readFile(join(cwd, "credentials.fixture"), "utf8")).toBe("fixture only");
  });

  it("waits while an operation is in progress in the checkout", async () => {
    const { linked, delivery } = await fixture();
    const cwd = await linked("busy-op");
    const baseline = (await delivery.baseline(cwd))!;
    await writeFile(join(cwd, "README.md"), "change\n");
    const gitDir = await git(cwd, "rev-parse", "--absolute-git-dir");
    await writeFile(join(gitDir, "MERGE_HEAD"), baseline.head + "\n");
    expect((await delivery.adopt(adopted("adopted-op", cwd, baseline), null)).delivery).toMatchObject({ state: "blocked", reason: "operation_in_progress" });
  });
});

describe("the run manager delivers adopted sessions", { timeout: 120_000 }, () => {
  class Port implements AgentPort {
    snapshots = new Map<string, AgentSnapshot>();
    reply = "Done.";
    async create() { return { id: "unused" }; }
    async snapshot(id: string) { return this.snapshots.get(id) ?? null; }
    async send() {}
    async stop() {}
    async lastReply() { return this.reply; }
    async recentActivity() { return ""; }
    async firstUserMessage() { return "Update the notes"; }
  }
  const catalog: ProviderCatalogData = { providers: [], generatedAt: new Date(0).toISOString() };
  const idle = (id: string): AgentSnapshot => ({ id, status: "idle", lastError: null, pendingPermissions: 0, archived: false, restorable: false, lastUserMessageAt: null });

  async function manager(delivery: GitDelivery, state: string, port: Port) {
    const store = new VersionedStore({ dir: state, name: "runs", version: 1, schema: runsState, defaults: () => ({ runs: [] }) });
    return new RunManager({
      port, store, attempts: new AttemptJournal(state), git: delivery,
      readCatalog: async () => catalog, readUsage: async () => null, readSettings: async () => defaultSettings(),
    });
  }

  it("delivers a linked-worktree agent through a new branch and retires only the delivery worktree", async () => {
    const { source, state, linked, delivery } = await fixture();
    const cwd = await linked("managed");
    const port = new Port();
    const runs = await manager(delivery, state, port);
    const run = await runs.adopt({ agentId: "agent-1", provider: "alpha", model: "m", cwd });
    expect(run.adopted).toMatchObject({ dirty: [], ref: "refs/heads/paseo/managed" });
    expect(run.delivery).toEqual({ state: "pending" });
    await writeFile(join(cwd, "README.md"), "agent change\n");
    port.snapshots.set("agent-1", idle("agent-1"));
    await runs.tick();
    await runs.tick();
    const [done] = await runs.list();
    expect(done).toMatchObject({ status: "delivered", delivery: { state: "local", retired: true } });
    expect(done.gitPlan?.branch).toMatch(/^feat\/update-the-notes-/);
    expect(await git(source, "log", "-1", "--format=%s", done.gitPlan!.branch)).toBe("feat: Update the notes");
    // The agent's checkout and its branch are untouched.
    expect(await git(cwd, "branch", "--show-current")).toBe("paseo/managed");
    expect(await readFile(join(cwd, "README.md"), "utf8")).toBe("agent change\n");
    expect(await git(cwd, "status", "--porcelain")).toBe("M README.md");
  });

  it("marks a main-checkout agent as a manual delivery and leaves the checkout alone", async () => {
    const { source, state, delivery } = await fixture();
    const port = new Port();
    const runs = await manager(delivery, state, port);
    await runs.adopt({ agentId: "agent-2", provider: "alpha", model: "m", cwd: source });
    await writeFile(join(source, "README.md"), "agent edit\n");
    port.snapshots.set("agent-2", idle("agent-2"));
    await runs.tick();
    await runs.tick();
    const [done] = await runs.list();
    expect(done.delivery).toMatchObject({ state: "manual", reason: "main_checkout", next: expect.stringContaining("git switch -c feat/update-the-notes-") });
    expect(done.gitPlan).toBeUndefined();
    expect(await git(source, "status", "--porcelain")).toBe("M README.md");
    expect(await git(source, "branch", "--list")).toBe("* main");
  });

  it("leaves the checkout to the person when an adopted run is stopped", async () => {
    const { state, linked, delivery } = await fixture();
    const cwd = await linked("stopped");
    const runs = await manager(delivery, state, new Port());
    const run = await runs.adopt({ agentId: "agent-4", provider: "alpha", model: "m", cwd });
    expect((await runs.cancel(run.id)).delivery).toEqual({ state: "unmanaged" });
  });

  it("keeps non-repository agents unmanaged and old stored runs readable", async () => {
    const { root, state, delivery } = await fixture();
    const plain = join(root, "plain");
    await mkdir(plain);
    const runs = await manager(delivery, state, new Port());
    expect((await runs.adopt({ agentId: "agent-3", provider: "alpha", model: "m", cwd: plain })).delivery).toEqual({ state: "unmanaged" });
    const legacy = runRecord.parse({
      id: "run-old", prompt: "x", role: "developer", capability: "implement", complexity: null, cwd: "/x", status: "delivered", current: null,
      attempts: 1, suspended: {}, resumeAt: null, pending: null, handledError: null, userBaseline: null, attention: false, result: null,
      error: null, history: [], createdAt: 1, updatedAt: 1, delivery: { state: "unmanaged" },
    });
    expect(legacy.adopted).toBeUndefined();
    expect(legacy.stall).toBeUndefined();
  });
});
