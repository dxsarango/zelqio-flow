import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { z } from "zod";
import type { DeliveryDecisionInput } from "../shared/delivery-decision";
import { policyLayers, type ActionId } from "../shared/policy";
import type { RunDelivery, RunGitPlan, RunRecord } from "../shared/runs";
import type { ZelqioSettings } from "../shared/settings";
import { evaluateDeliveryDecision } from "./delivery-decision";
import { GitOperationJournal } from "./git-operation-journal";
import { inspectGitPreflight, isFullGitObjectId } from "./git-preflight";
import type { GitReconciliationOperation } from "./git-reconciliation";
import { GitCommandError, runGitCommand, type GitRunner } from "./git-runner";
import { inspectGitHubEvidence } from "./github-evidence";
import { evaluate, validateLayers } from "./policy";
import { redactSecrets } from "./quota-signal";
import { VersionedStore } from "./store";
import { inspectWorktreeRetirement } from "./worktree-retirement";

const sha = z.string().refine(isFullGitObjectId);
const repositoryName = z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/);
const branchName = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._/-]*$/);
const projectGrant = z.strictObject({
  commonDir: z.string().min(1),
  base: branchName,
  origin: z.string().min(1),
  upstream: repositoryName.optional(),
  policy: policyLayers,
  // A filesystem remote can opt in to Git's connectivity and fast-forward checks as its local policy.
  localDirect: z.boolean().optional(),
  requireOwnerReview: z.boolean().optional(),
  deferred: z.strictObject({
    taskId: z.string(), sha, destination: z.string(), expiresAt: z.int().positive(),
    independentReview: z.literal(true), validationEnvironment: z.literal(true),
  }).optional(),
});
type ProjectGrant = z.infer<typeof projectGrant>;
type GitSettings = Pick<ZelqioSettings, "git" | "mode" | "remoteAuthorization">;
type Effect = GitReconciliationOperation & { id: string; deferred?: true };
const effectPlans = z.strictObject({ plans: z.record(z.string(), z.strictObject({
  id: z.string(), repository: z.string(), targetRef: z.string(), previousSha: sha, expectedSha: sha, deferred: z.literal(true).optional(),
})) });

const githubRepo = z.object({
  full_name: repositoryName, default_branch: branchName, fork: z.boolean(),
  parent: z.object({ full_name: repositoryName }).optional(),
  allow_squash_merge: z.boolean().optional(),
  permissions: z.object({ push: z.boolean() }).optional(),
});
const pull = z.object({
  number: z.int().positive(), html_url: z.string(), state: z.enum(["open", "closed"]),
  merged_at: z.string().nullable(), merge_commit_sha: sha.nullable(), draft: z.boolean(),
  mergeable: z.boolean().nullable().optional(), mergeable_state: z.string().optional(),
  head: z.object({ ref: branchName, sha, repo: z.object({ full_name: repositoryName }).nullable() }),
  base: z.object({ ref: branchName, sha, repo: z.object({ full_name: repositoryName }) }),
});
type Pull = z.infer<typeof pull>;
const protection = z.object({
  required_status_checks: z.object({
    strict: z.boolean(), contexts: z.array(z.string()),
    checks: z.array(z.object({ context: z.string(), app_id: z.int().nullable() })),
  }).optional(),
  enforce_admins: z.object({ enabled: z.boolean() }),
  required_linear_history: z.object({ enabled: z.boolean() }),
  required_pull_request_reviews: z.looseObject({}).optional(),
});
const checkPage = z.object({
  total_count: z.int().nonnegative(),
  check_runs: z.array(z.object({
    head_sha: sha, name: z.string(), status: z.string(),
    conclusion: z.string().nullable(), app: z.object({ id: z.int() }).nullable(),
  })),
});
const queueStatus = z.object({ data: z.object({
  repository: z.object({ pullRequest: z.object({ isMergeQueueEnabled: z.boolean() }) }),
}) });

class DeliveryBlocked extends Error {}
const block = (reason: string): never => { throw new DeliveryBlocked(reason); };
const errorCode = (error: unknown, code: number | string) =>
  error instanceof GitCommandError ? error.code === code : (error as NodeJS.ErrnoException)?.code === code;
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const branchRef = (branch: string) => "refs/heads/" + branch;
const nul = (value: string) => value.split("\0").filter(Boolean);
const canonical = (path: string) => process.platform === "win32" ? path.replaceAll("\\", "/").toLowerCase() : path;
const samePath = (a: string, b: string) => canonical(a) === canonical(b);
const opaque = (label: string, object: string) => digest(label + ":" + object).slice(0, object.length);
const privatePath = /(?:^|\/)(?:\.env(?:[.-][^/]*)?|\.gitmodules|\.git|\.npmrc|\.netrc|\.pypirc|\.aws|\.ssh|id_(?:rsa|ed25519|ecdsa)|credentials(?:\.[^/]*)?|secrets?(?:\.[^/]*)?|[^/]+\.(?:pem|pfx|p12|key|jks|keystore))(?=\/|$)/i;
const privateText = /(?:[A-Za-z]:[\\/]|\\\\[^\s\\]+\\|\/(?:Users|home|private|tmp|var\/folders)\/|mailto:|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}|(?:ai[- ]generated|co-authored-by|generated (?:by|with)|chatgpt|claude code|copilot|codex)\b)/i;
const secretText = (line: string) => redactSecrets(line) !== line || /-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(line);

function gitLabel(title: string | null, capability: RunRecord["capability"]) {
  const type = capability === "docs" ? "docs" : capability === "test" ? "test" : "feat";
  const first = (title ?? "").split(/\r?\n/, 1)[0].trim().replace(/^[a-z]+(?:\([^)]*\))?!?:\s+/i, "");
  const safe = first && !privateText.test(first) && !secretText(first) &&
    /^[\p{L}\p{N}][\p{L}\p{N} .,_()'-]{0,90}$/u.test(first);
  return { type, subject: safe ? first : "deliver task changes" };
}

function githubRemote(url: string) {
  return /^(?:https:\/\/github\.com\/|git@github\.com:)([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+?)(?:\.git)?\/?$/i.exec(url)?.[1].toLowerCase();
}

/** Reads operator policy from plugin state, never from the checkout or an agent-supplied RPC. */
export function readGitProjectGrants(directory: string) {
  return async (commonDir: string): Promise<ProjectGrant | null> => {
    const file = join(directory, "git-projects.json");
    try {
      if (!(await lstat(file)).isFile()) return null;
      const grants = z.array(projectGrant).parse(JSON.parse(await readFile(file, "utf8")));
      const matches = grants.filter(grant => samePath(grant.commonDir, commonDir));
      return matches.length === 1 && validateLayers(matches[0].policy).ok ? matches[0] : null;
    } catch {
      return null;
    }
  };
}

interface Checkout {
  cwd: string;
  commonDir: string;
  gitDir: string;
  repository: string;
  ref: string;
  head: string;
  tracked: string[];
  untracked: string[];
  operation: boolean;
}

interface Destination {
  url: string;
  origin: string;
  repository: string;
  base: string;
  local: boolean;
  grant: ProjectGrant;
}

function remoteIdentity(repository: string, target: Destination) {
  return digest(JSON.stringify([repository, target.url, target.origin, target.repository, target.base]));
}

export class GitDelivery {
  private readonly journal: GitOperationJournal;
  private readonly plans: VersionedStore<z.infer<typeof effectPlans>>;

  constructor(
    directory: string,
    private readonly run: GitRunner = runGitCommand(),
    private readonly readGrant = readGitProjectGrants(directory),
    private readonly clock = Date.now,
    private readonly readSettings?: () => Promise<GitSettings | null>,
  ) {
    this.journal = new GitOperationJournal(directory);
    this.plans = new VersionedStore({
      dir: directory, name: "git-delivery-plans", version: 1, schema: effectPlans, defaults: () => ({ plans: {} }),
    });
  }

  private git(cwd: string, ...args: string[]) {
    // Avoid hooks, replacement objects, and arbitrary Git remote helpers in daemon-owned commands.
    return this.run("git", ["--no-replace-objects", "-c", "core.hooksPath=" + (process.platform === "win32" ? "NUL" : "/dev/null"),
      "-c", "core.fsmonitor=false",
      "-c", "protocol.allow=never", "-c", "protocol.https.allow=always", "-c", "protocol.ssh.allow=always",
      "-c", "protocol.file.allow=always", ...args], cwd);
  }

  private async api<T>(cwd: string, schema: z.ZodType<T>, route: string, ...args: string[]): Promise<T> {
    return schema.parse(JSON.parse(await this.run("gh", ["api", "--hostname", "github.com", route, ...args], cwd)));
  }

  private async revision(cwd: string, ref: string) {
    return sha.parse((await this.git(cwd, "rev-parse", "--verify", "--end-of-options", ref + "^{commit}")).trim());
  }

  private async checkout(path: string): Promise<Checkout> {
    const root = (await this.git(path, "rev-parse", "--show-toplevel")).trim();
    const cwd = await realpath(root);
    const [common, dir, ref, head, tracked, untracked] = await Promise.all([
      this.git(cwd, "rev-parse", "--path-format=absolute", "--git-common-dir"),
      this.git(cwd, "rev-parse", "--absolute-git-dir"),
      this.git(cwd, "symbolic-ref", "-q", "HEAD").catch(error => {
        if (errorCode(error, 1)) return "";
        throw error;
      }),
      this.revision(cwd, "HEAD"),
      this.git(cwd, "status", "--porcelain=v1", "-z", "--untracked-files=no", "--ignore-submodules=none"),
      this.git(cwd, "ls-files", "-z", "--others", "--exclude-standard"),
    ]);
    const [commonDir, gitDir] = await Promise.all([realpath(common.trim()), realpath(dir.trim())]);
    const operations = await Promise.all(["MERGE_HEAD", "CHERRY_PICK_HEAD", "REVERT_HEAD", "rebase-merge", "rebase-apply",
      "sequencer", "BISECT_START", "index.lock"].map(name => lstat(join(gitDir, name)).then(() => true, error => {
      if (errorCode(error, "ENOENT")) return false;
      throw error;
    })));
    return { cwd, commonDir, gitDir, repository: digest(canonical(commonDir)), ref: ref.trim(), head,
      tracked: nul(tracked), untracked: nul(untracked), operation: operations.some(Boolean) };
  }

  private async ancestor(cwd: string, before: string, after: string) {
    return this.git(cwd, "merge-base", "--is-ancestor", before, after).then(() => true, error => {
      if (errorCode(error, 1)) return false;
      throw error;
    });
  }

  async plan(cwd: string, run: Pick<RunRecord, "id" | "title" | "capability">): Promise<RunGitPlan | undefined> {
    const inside = await this.git(cwd, "rev-parse", "--is-inside-work-tree").catch(error => {
      // Distinguish a non-repository from a missing/broken Git executable or an inaccessible checkout.
      if (errorCode(error, 128) && /not a git repository/i.test(String(error))) return "false";
      throw error;
    });
    if (inside.trim() !== "true") return undefined;
    const base = await this.checkout(cwd);
    this.preflight(base, base.ref, base.head, base, true);
    const { type, subject } = gitLabel(run.title, run.capability);
    const slug = subject.normalize("NFKD").toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40).replace(/^-|-$/g, "");
    return { repository: base.repository, source: base.cwd, baseRef: base.ref, baseSha: base.head,
      branch: type + "/" + (slug || "task") + "-" + run.id.replace(/^run-/, "") };
  }

  private preflight(checkout: Checkout, baseRef: string, baseSha: string, base: Checkout, allowDirty = false) {
    const result = inspectGitPreflight({ repository: base.repository, baseRef, baseSha }, {
      repository: checkout.repository, headSha: checkout.head,
      refs: new Map([[base.ref, base.head]]),
      worktree: allowDirty || !checkout.tracked.length && !checkout.untracked.length ? "clean" : "dirty",
      operation: checkout.operation ? "in_progress" : "none",
    });
    if (result.status !== "snapshot_ready") block(result.status);
  }

  async attach(plan: RunGitPlan, path: string, workspaceId: string): Promise<RunGitPlan> {
    const tree = await this.checkout(path);
    if (!workspaceId || tree.repository !== plan.repository || tree.ref !== branchRef(plan.branch) ||
        tree.head !== plan.baseSha || samePath(tree.cwd, plan.source) || samePath(tree.gitDir, tree.commonDir) ||
        tree.operation || tree.tracked.length || tree.untracked.length) block("isolation_unverified");
    return { ...plan, cwd: tree.cwd, workspaceId };
  }

  private async managed(plan: RunGitPlan): Promise<Checkout> {
    if (!plan.cwd || !plan.workspaceId) return block("isolation_unverified");
    const tree = await this.checkout(plan.cwd);
    if (tree.repository !== plan.repository || tree.ref !== branchRef(plan.branch) ||
        !samePath(tree.cwd, plan.cwd) || samePath(tree.cwd, plan.source) || samePath(tree.gitDir, tree.commonDir)) {
      return block("isolation_unverified");
    }
    const [behind, ahead] = (await this.git(tree.cwd, "rev-list", "--left-right", "--count", plan.baseSha + "..." + tree.head))
      .trim().split(/\s+/).map(Number);
    if (behind !== 0 || !Number.isSafeInteger(ahead) || ahead < 0) block("base_diverged");
    return tree;
  }

  /**
   * Persist the known transition before invoking the CLI. An existing intent is observation-only.
   * Remote effects with an unknown output SHA use a receipt ref whose observation is specific to the exact
   * candidate (a verified PR tuple, merge receipt or missing registered checkout).
   */
  private async effect(
    id: string, proposed: Omit<Effect, "id">,
    observe: (intent: Effect) => Promise<string | null>,
    apply: (intent: Effect) => Promise<void>,
  ): Promise<Effect> {
    const intent = await this.plans.update<Effect>(state => {
      if (Object.hasOwn(state.plans, id)) return { result: state.plans[id] };
      const pending = { id, ...proposed };
      return { result: pending, next: { plans: { ...state.plans, [id]: pending } } };
    });
    if (intent.repository !== proposed.repository || intent.targetRef !== proposed.targetRef) return block("operation_target_changed");
    const reconcile = async () => {
      const current = await observe(intent);
      return this.journal.reconcile(id, {
        repository: intent.repository, ref: intent.targetRef,
        observation: current ? { status: "present", sha: current, object: "verified" } : { status: "unreadable" },
      });
    };
    const started = await this.journal.recordIntent({
      id, repository: intent.repository, targetRef: intent.targetRef, previousSha: intent.previousSha, expectedSha: intent.expectedSha,
    });
    if (started === "blocked") return block("operation_pending");
    if (started === "recorded") {
      if (await observe(intent) !== intent.previousSha) {
        if ((await reconcile()).status === "applied") return intent;
        return block("operation_target_changed");
      }
      try { await apply(intent); } catch {
        if ((await reconcile()).status === "applied") return intent;
        return block("operation_uncertain");
      }
    }
    const completion = await reconcile();
    if (completion.status !== "applied" && completion.status !== "already_applied") return block("operation_uncertain");
    return intent;
  }

  private async scan(cwd: string, args: string[], publication: boolean) {
    const files = nul(await this.git(cwd, "diff", "--no-ext-diff", "--no-textconv", "--no-renames", "--name-only", "-z", ...args, "--"));
    if (files.some(path => privatePath.test(path) || [...path].some(character => character.charCodeAt(0) < 32))) block("sensitive_content");
    if (!files.length) return files;
    const patch = await this.git(cwd, "diff", "--no-ext-diff", "--no-textconv", "--no-renames", "--no-color", "-U0", ...args, "--");
    if (/^(?:new file mode (?:120000|160000)|new mode (?:120000|160000)|\+Subproject commit )/m.test(patch) ||
        patch.split("\n").some(line => /^\+(?!\+\+)/.test(line) && secretText(line.slice(1)))) block("sensitive_content");
    if (publication && /^Binary files .* differ$/m.test(patch)) block("unverified_content");
    return files;
  }

  private async commit(run: RunRecord, plan: RunGitPlan) {
    const tree = await this.managed(plan);
    const base = await this.revision(tree.cwd, plan.baseRef);
    const recorded = await this.revision(tree.cwd, plan.baseSha);
    if (!await this.ancestor(tree.cwd, recorded, base)) block("base_diverged");
    const anchor = "refs/zelqio/base/" + run.id;
    this.preflight(tree, anchor, plan.baseSha, { ...tree, ref: anchor, head: recorded }, true);
    const id = run.id + "-commit";
    const saved = await this.plans.update(state => ({ result: state.plans[id] }));
    if (!saved && !tree.tracked.length && !tree.untracked.length) return tree.head;
    let expected = saved?.expectedSha;
    if (!expected) {
      const changed = [
        ...tree.untracked,
        ...nul(await this.git(tree.cwd, "diff", "--no-renames", "--name-only", "-z", "HEAD", "--")),
        ...nul(await this.git(tree.cwd, "diff", "--cached", "--no-renames", "--name-only", "-z", "HEAD", "--")),
      ];
      if (changed.some(path => privatePath.test(path))) block("sensitive_content");
      await this.git(tree.cwd, "--literal-pathspecs", "add", "-A", "--", ".");
      const index = sha.parse((await this.git(tree.cwd, "write-tree")).trim());
      if (!(await this.scan(tree.cwd, [tree.head, index], false)).length) return tree.head;
      const { type, subject } = gitLabel(run.title, run.capability);
      expected = sha.parse((await this.git(tree.cwd, "commit-tree", index, "-p", tree.head, "-m", type + ": " + subject)).trim());
    }
    const intent = await this.effect(id, { repository: tree.repository, targetRef: tree.ref, previousSha: tree.head, expectedSha: expected },
      () => this.revision(tree.cwd, tree.ref), async operation => {
        const fresh = await this.managed(plan);
        if (fresh.operation || fresh.head !== operation.previousSha) block("operation_target_changed");
        const contents = (await this.git(tree.cwd, "rev-parse", operation.expectedSha + "^{tree}")).trim();
        if ((await this.git(tree.cwd, "write-tree")).trim() !== contents) block("worktree_changed");
        await this.git(tree.cwd, "update-ref", "-m", "deliver run", tree.ref, operation.expectedSha, operation.previousSha);
      });
    if (await this.revision(tree.cwd, tree.ref) !== intent.expectedSha) block("worktree_changed");
    return intent.expectedSha;
  }

  private async destination(tree: Checkout, settings: GitSettings): Promise<Destination | null> {
    if (settings.remoteAuthorization !== "per_project") return null;
    const grant = await this.readGrant(tree.commonDir);
    if (!grant || !samePath(grant.commonDir, tree.commonDir) || !branchName.safeParse(grant.base).success ||
        !validateLayers(grant.policy).ok) return null;
    await this.git(tree.cwd, "check-ref-format", branchRef(grant.base));
    const readRemote = async (name: string) => {
      const raw = (await this.git(tree.cwd, "remote", "get-url", "--all", name)).trim();
      const push = (await this.git(tree.cwd, "remote", "get-url", "--push", "--all", name)).trim();
      if (raw !== push || /[\r\n]/.test(raw)) return block("remote_changed");
      // Verify the exact transport that an explicit URL argument would use.
      const effective = (await this.git(tree.cwd, "ls-remote", "--get-url", raw)).trim();
      if (effective !== raw) return block("remote_changed");
      const rewrites = await this.git(tree.cwd, "config", "--get-regexp", "^url\\..*\\.(pushinsteadof|insteadof)$")
        .catch(error => { if (errorCode(error, 1)) return ""; throw error; });
      if (rewrites) return block("remote_rewrite_unverified");
      return raw;
    };
    const url = await readRemote("origin");
    const origin = githubRemote(url);
    if (!origin && settings.git.workflow === "direct" && grant.localDirect && isAbsolute(url) && samePath(url, grant.origin) &&
        samePath(await realpath(url), url) && (await this.git(url, "rev-parse", "--is-bare-repository")).trim() === "true") {
      return { url, origin: "local", repository: "local", base: grant.base, local: true, grant };
    }
    if (!origin || origin !== grant.origin.toLowerCase()) return block("remote_changed");
    if (settings.git.workflow !== "fork") return { url, origin, repository: origin, base: grant.base, local: false, grant };
    const upstream = githubRemote(await readRemote("upstream"));
    if (!upstream || upstream !== grant.upstream?.toLowerCase() || upstream === origin) return block("fork_unverified");
    return { url, origin, repository: upstream, base: grant.base, local: false, grant };
  }

  private resource(destination: Destination, action: ActionId, branch: string) {
    const target = destination.local ? destination.grant.origin : action === "git.push" ? destination.origin : destination.repository;
    return target + ":" + branchRef(branch);
  }

  private allowed(destination: Destination, action: ActionId, branch: string) {
    return evaluate(destination.grant.policy, { action, resource: this.resource(destination, action, branch) }).effect === "allow";
  }

  private async remoteSha(cwd: string, url: string, ref: string) {
    const lines = (await this.git(cwd, "ls-remote", "--refs", "--", url, ref)).trim();
    if (!lines) return null;
    const [object, name] = lines.split("\t");
    if (name !== ref) return block("remote_ref_unverified");
    return sha.parse(object);
  }

  private async revalidate(plan: RunGitPlan, candidate: string, settings: GitSettings, expected: Destination) {
    const tree = await this.managed(plan);
    if (tree.head !== candidate || tree.operation || tree.tracked.length || tree.untracked.length) return block("worktree_changed");
    const now = this.readSettings ? await this.readSettings() : settings;
    if (!now || now.git.workflow !== settings.git.workflow || now.mode !== settings.mode ||
        now.remoteAuthorization !== settings.remoteAuthorization) return block("delivery_settings_changed");
    const fresh = await this.destination(tree, now);
    if (!fresh || JSON.stringify(fresh) !== JSON.stringify(expected)) return block("remote_changed");
    return tree;
  }

  private async push(run: RunRecord, plan: RunGitPlan, candidate: string, settings: GitSettings, target: Destination, branch: string, before: string | null) {
    const cwd = plan.cwd!;
    const ref = branchRef(branch);
    const absent = opaque("absent " + ref, candidate);
    const observe = async () => (await this.remoteSha(cwd, target.url, ref)) ?? absent;
    const intent = await this.effect(run.id + "-push", {
      repository: remoteIdentity(plan.repository, target), targetRef: ref, previousSha: before ?? absent, expectedSha: candidate,
    }, observe, async pending => {
      await this.revalidate(plan, candidate, settings, target);
      if (!this.allowed(target, "git.push", branch) || await observe() !== pending.previousSha) block("remote_changed");
      await this.git(cwd, "push", "--porcelain", "--no-follow-tags", "--recurse-submodules=no", "--", target.url, candidate + ":" + ref);
    });
    if (intent.expectedSha !== candidate || await observe() !== candidate) block("remote_ref_changed");
  }

  private async exactPull(cwd: string, target: Destination, branch: string, candidate: string) {
    const head = target.origin.split("/")[0] + ":" + branch;
    const params = new URLSearchParams({ state: "all", head, base: target.base, per_page: "100" });
    const pages = await this.api(cwd, z.array(z.array(pull)), "repos/" + target.repository + "/pulls?" + params, "--paginate", "--slurp");
    const entries = pages.flat().filter(pr => pr.head.repo?.full_name.toLowerCase() === target.origin && pr.head.ref === branch &&
      pr.base.repo.full_name.toLowerCase() === target.repository && pr.base.ref === target.base);
    if (entries.length > 1 || entries.some(pr => pr.head.sha !== candidate)) return block("pull_request_changed");
    return entries[0] ?? null;
  }

  private async prEvidence(cwd: string, target: Destination, candidate: string) {
    const baseRef = branchRef(target.base);
    const root = "repos/" + target.repository;
    const [rules, classic, pages] = await Promise.all([
      this.api(cwd, z.array(z.unknown()), root + "/rules/branches/" + encodeURIComponent(target.base)),
      this.api(cwd, protection, root + "/branches/" + encodeURIComponent(target.base) + "/protection"),
      this.api(cwd, z.array(checkPage), root + "/commits/" + candidate + "/check-runs?filter=latest&per_page=100", "--paginate", "--slurp"),
    ]);
    const checks = classic.required_status_checks;
    const required = checks?.checks.map(check => ({ name: check.context, appId: check.app_id ?? 0 })) ?? [];
    const complete = !!checks && rules.length === 0 && pages.length > 0 &&
      pages.every(page => page.total_count === pages[0].total_count) &&
      pages.flatMap(page => page.check_runs).length === pages[0].total_count &&
      JSON.stringify([...checks.contexts].sort()) === JSON.stringify(required.map(check => check.name).sort());
    const runs = pages.flatMap(page => page.check_runs).map(check => ({
      headSha: check.head_sha, name: check.name, appId: check.app?.id ?? 0,
      status: check.status === "completed" ? "completed" as const : check.status === "queued" ? "queued" as const : "in_progress" as const,
      conclusion: check.conclusion,
    }));
    const scope = { repository: target.repository, baseRef, headSha: candidate, required };
    return {
      reviewRequired: !!classic.required_pull_request_reviews,
      revision: digest(JSON.stringify([target.grant, classic, rules])),
      result: inspectGitHubEvidence(scope, { ...scope, complete, runs, protections: {
        strict: checks?.strict === true, enforceAdmins: classic.enforce_admins.enabled,
        linearHistory: classic.required_linear_history.enabled, bypassAllowed: !classic.enforce_admins.enabled,
      } }),
    };
  }

  private async mergeQueueEnabled(cwd: string, repository: string, number: number) {
    const [owner, name] = repository.split("/");
    const query = "query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){pullRequest(number:$number){isMergeQueueEnabled}}}";
    const result = await this.api(cwd, queueStatus, "graphql", "-f", "query=" + query,
      "-f", "owner=" + owner, "-f", "name=" + name, "-F", "number=" + number);
    return result.data.repository.pullRequest.isMergeQueueEnabled;
  }

  private decision(
    run: RunRecord, target: Destination, candidate: string, settings: GitSettings, files: string[],
    evidence: { ready: boolean; checked: boolean; human: boolean; revision: string }, action: "pr.merge" | "git.push",
  ) {
    const now = this.clock();
    const destination = this.resource(target, action, target.base);
    const scope = { projectId: run.gitPlan!.repository, taskId: run.id, destination, candidateSha: candidate,
      policyRevision: evidence.revision };
    const low = files.every(path => /^(?:[^/]+\.md|docs\/.*\.(?:md|txt)|(?:test|tests)\/[^.].*\.(?:ts|js|tsx|py))$/i.test(path) &&
      !/(?:^|\/)(?:setup|config|hooks|fixtures\/credentials)(?:[./]|$)/i.test(path));
    const sensitive = files.some(path => /^(?:\.github\/|\.git|\.paseo|package(?:-lock)?\.json|.*(?:^|\/)(?:auth|security|payments?|migrations?)(?:[./_-]|$))/i.test(path));
    const experience = settings.mode === "smart_review" && files.some(path => /^(?:client|ui|frontend)\/|\.css$/i.test(path));
    const risk: DeliveryDecisionInput["risk"] = sensitive ? "sensitive" : low ? "low" : experience ? "reversible_experience"
      : settings.mode === "smart_review" ? "unknown" : "low";
    const deferred = target.grant.deferred;
    const bound = deferred?.taskId === run.id && deferred.sha === candidate && deferred.destination === destination && deferred.expiresAt > now
      ? { scope, state: "active" as const, expiresAt: deferred.expiresAt } : null;
    return evaluateDeliveryDecision({
      mode: settings.mode, scope, risk, ownerReviewRequested: target.grant.requireOwnerReview === true,
      restrictions: { integrationDenied: false, humanApprovalRequired: evidence.human, independentReviewRequired: !!bound },
      evidence: { scope, protections: evidence.checked ? "verified" : "unknown",
        checks: evidence.checked ? "passed" : "unknown", acceptance: evidence.checked ? "met" : "unknown",
        integration: evidence.ready ? "ready" : "unknown", independentReview: bound ? "passed" : "unknown",
        validationEnvironment: experience ? bound ? "ready" : "unknown" : "not_required" },
      authorization: this.allowed(target, action, target.base) ? { scope, kind: "automatic", expiresAt: now + 30_000 } : null,
      deferredReview: bound,
    }, this.clock);
  }

  async deliver(run: RunRecord, settings: GitSettings): Promise<RunDelivery> {
    const plan = run.gitPlan!;
    let candidate = run.delivery?.sha;
    let prUrl = run.delivery?.prUrl;
    try {
      const cwd = plan.cwd!;
      candidate ??= await this.commit(run, plan);
      const tree = await this.managed(plan);
      if (tree.head !== candidate || tree.operation || tree.tracked.length || tree.untracked.length) return block("worktree_changed");
      if (candidate === plan.baseSha) return { state: "no_changes", sha: candidate };
      if (run.parentRunId || settings.git.workflow === "local_only") {
        if (prUrl) return { state: "review", sha: candidate, prUrl, reason: "delivery_settings_changed" };
        return { state: "local", sha: candidate };
      }
      const target = await this.destination(tree, settings);
      if (!target) return prUrl ? { state: "review", sha: candidate, prUrl, reason: "remote_access_denied" }
        : { state: "remote_denied", sha: candidate };
      const direct = settings.git.workflow === "direct";
      if (prUrl && (direct || !prUrl.startsWith("https://github.com/" + target.repository + "/pull/"))) {
        return { state: "review", sha: candidate, prUrl, reason: "delivery_settings_changed" };
      }
      const pushBranch = direct ? target.base : plan.branch;
      if (!this.allowed(target, "git.push", pushBranch) || !direct && !this.allowed(target, "pr.create", target.base)) {
        return prUrl ? { state: "review", sha: candidate, prUrl, reason: "remote_access_denied" }
          : { state: "remote_denied", sha: candidate };
      }
      const files = await this.scan(cwd, [plan.baseSha, candidate], true);
      // Inspect each published commit, including content added and subsequently removed inside the run.
      const commits = (await this.git(cwd, "rev-list", "--max-count=201", plan.baseSha + ".." + candidate)).trim().split("\n");
      if (commits.length > 200) return block("unverified_content");
      for (const object of commits) {
        const line = (await this.git(cwd, "show", "-s", "--format=%P%n%B", sha.parse(object))).trim();
        const [parentLine, ...message] = line.split("\n");
        const parents = parentLine.split(" ");
        if (!parents.every(isFullGitObjectId) || privateText.test(message.join("\n")) || secretText(message.join("\n"))) return block("unverified_content");
        await this.scan(cwd, [parents[0], object], true);
      }
      const baseRef = branchRef(target.base);
      const origin = target.local ? null : await this.api(cwd, githubRepo, "repos/" + target.origin);
      if (origin && (origin.full_name.toLowerCase() !== target.origin || origin.permissions?.push !== true)) return block("remote_permissions_unverified");
      if (origin && settings.git.workflow === "fork" &&
          (!origin.fork || origin.parent?.full_name.toLowerCase() !== target.repository)) return block("fork_unverified");
      if (!direct && (plan.branch === origin?.default_branch || plan.branch === target.base)) return block("publication_branch_unverified");
      const remoteBase = await this.remoteSha(cwd, target.repository === target.origin ? target.url : "https://github.com/" + target.repository + ".git", baseRef);
      if (direct && remoteBase === candidate) {
        const saved = await this.plans.update(state => ({ result: state.plans[run.id + "-push"] }));
        if (!saved || saved.expectedSha !== candidate) return block("remote_ref_changed");
        await this.push(run, plan, candidate, settings, target, target.base, saved.previousSha);
        return { state: "direct", sha: candidate };
      }
      if (direct) {
        if (!remoteBase || remoteBase !== plan.baseSha || !await this.ancestor(cwd, remoteBase, candidate)) return block("remote_base_changed");
        const evidence = target.local
          ? { result: { status: "checks_verified" }, reviewRequired: false, revision: digest(JSON.stringify(target.grant)) }
          : await this.prEvidence(cwd, target, candidate);
        if (target.local) await this.git(cwd, "fsck", "--connectivity-only", "--no-dangling", candidate);
        const decision = this.decision(run, target, candidate, settings, files, {
          ready: true, checked: evidence.result.status === "checks_verified", human: evidence.reviewRequired, revision: evidence.revision,
        }, "git.push");
        if (decision.status !== "allowed") return { state: "review", sha: candidate, reason: decision.reasons[0] };
        await this.push(run, plan, candidate, settings, target, target.base, remoteBase);
        return { state: "direct", sha: candidate };
      }

      let pr = await this.exactPull(cwd, target, plan.branch, candidate);
      if (prUrl && (!pr || pr.html_url.toLowerCase() !== prUrl.toLowerCase())) return block("pull_request_changed");
      const previous = await this.remoteSha(cwd, target.url, branchRef(plan.branch));
      if (!pr) {
        if (!remoteBase || remoteBase !== plan.baseSha) return block("remote_base_changed");
        if (previous && previous !== candidate) return block("remote_ref_changed");
        await this.push(run, plan, candidate, settings, target, plan.branch, null);
        const ref = "refs/zelqio/pr/" + run.id;
        const before = opaque(ref + ":missing", candidate);
        await this.effect(run.id + "-pr", { repository: remoteIdentity(tree.repository, target), targetRef: ref, previousSha: before, expectedSha: candidate },
          async () => await this.exactPull(cwd, target, plan.branch, candidate!) ? candidate! : before,
          async () => {
            await this.revalidate(plan, candidate!, settings, target);
            if (!this.allowed(target, "pr.create", target.base) ||
                await this.remoteSha(cwd, target.url, branchRef(plan.branch)) !== candidate) block("remote_changed");
            const { type, subject } = gitLabel(run.title, run.capability);
            await this.api(cwd, pull, "repos/" + target.repository + "/pulls", "--method", "POST",
              "-f", "head=" + target.origin.split("/")[0] + ":" + plan.branch,
              "-f", "head_repo=" + target.origin.split("/")[1], "-f", "base=" + target.base,
              "-f", "title=" + type + ": " + subject, "-f", "body=Changes for the requested task.");
          });
        pr = await this.exactPull(cwd, target, plan.branch, candidate);
      }
      if (!pr) return block("pull_request_unverified");
      prUrl = "https://github.com/" + target.repository + "/pull/" + pr.number;
      if (pr.html_url.toLowerCase() !== prUrl.toLowerCase()) return block("pull_request_unverified");
      return await this.finishPull(run, plan, settings, target, pr, files, candidate, prUrl, remoteBase);
    } catch (error) {
      const reason = error instanceof DeliveryBlocked ? error.message
        : error instanceof GitCommandError && /permission denied|authentication required|HTTP (?:401|403)/i.test(error.message)
          ? "remote_access_denied" : "git_evidence_unavailable";
      return { state: "blocked", sha: candidate, prUrl, reason,
        ...(["operation_uncertain", "git_evidence_unavailable"].includes(reason) ? { nextAt: this.clock() + 60_000 } : {}) };
    }
  }

  private async finishPull(
    run: RunRecord, plan: RunGitPlan, settings: GitSettings, target: Destination, pr: Pull, files: string[],
    candidate: string, prUrl: string, remoteBase: string | null,
  ): Promise<RunDelivery> {
    const cwd = plan.cwd!;
    const at = this.clock() + 60_000;
    const review = (reason: string): RunDelivery => ({ state: "review", sha: candidate, prUrl, reason, nextAt: at });
    const ref = "refs/zelqio/merge/" + run.id;
    const before = opaque(ref + ":open", candidate);
    const proposed = { repository: remoteIdentity(plan.repository, target), targetRef: ref, previousSha: before, expectedSha: candidate };
    const observe = async () => {
      const current = await this.exactPull(cwd, target, plan.branch, candidate);
      if (current?.number !== pr.number) return null;
      return current.merged_at && current.merge_commit_sha ? candidate : current.state === "open" ? before : null;
    };
    const pending = await this.plans.update(state => ({ result: state.plans[run.id + "-merge"] }));
    if (pending) {
      const intent = await this.effect(run.id + "-merge", proposed, observe, async () => block("operation_uncertain"));
      return { state: "merged", sha: candidate, prUrl, reason: intent.deferred ? "review_deferred" : undefined };
    }
    if (pr.merged_at && pr.merge_commit_sha) return { state: "merged", sha: candidate, prUrl };
    if (pr.state !== "open") return { state: "blocked", sha: candidate, prUrl, reason: "pull_request_closed" };
    if (settings.mode === "review_first" || target.grant.requireOwnerReview || !this.allowed(target, "pr.merge", target.base)) {
      return review("human_approval_required");
    }
    if (pr.draft || pr.mergeable === false || !remoteBase || pr.base.sha !== remoteBase ||
        !await this.ancestor(cwd, remoteBase, candidate)) return review("integration_unverified");
    const [evidence, detailed, repository, queued] = await Promise.all([
      this.prEvidence(cwd, target, candidate),
      this.api(cwd, pull, "repos/" + target.repository + "/pulls/" + pr.number),
      this.api(cwd, githubRepo, "repos/" + target.repository),
      this.mergeQueueEnabled(cwd, target.repository, pr.number),
    ]).catch(() => [null, null, null, null] as const);
    if (!evidence || !detailed || !repository || queued === null) return review("protections_unverified");
    if (queued) return review("merge_queue_required");
    if (evidence.reviewRequired) return review("human_approval_required");
    if (evidence.result.status === "checks_blocked") {
      const waiting = evidence.result.checks.some(check => check.status === "pending" || check.status === "missing") &&
        evidence.result.checks.every(check => ["missing", "pending", "passed"].includes(check.status));
      return waiting ? { state: "checks", sha: candidate, prUrl, nextAt: at } : review("checks_unverified");
    }
    const mergeReady = (current: Pull) => current.number === pr.number && current.head.sha === candidate &&
      current.head.repo?.full_name.toLowerCase() === target.origin && current.head.ref === plan.branch &&
      current.base.repo.full_name.toLowerCase() === target.repository && current.base.ref === target.base &&
      current.base.sha === remoteBase && current.state === "open" && !current.draft &&
      current.mergeable === true && current.mergeable_state === "clean";
    if (detailed.mergeable === null && evidence.result.status === "checks_verified") return { state: "checks", sha: candidate, prUrl, nextAt: at };
    const decision = this.decision(run, target, candidate, settings, files, {
      ready: mergeReady(detailed) && repository.allow_squash_merge === true && repository.permissions?.push === true,
      checked: evidence.result.status === "checks_verified", human: false, revision: evidence.revision,
    }, "pr.merge");
    if (decision.status !== "allowed") return review(decision.reasons[0]);
    await this.effect(run.id + "-merge", { ...proposed, deferred: decision.review === "deferred" ? true : undefined }, observe, async () => {
      await this.revalidate(plan, candidate, settings, target);
      const [fresh, current, queue] = await Promise.all([
        this.prEvidence(cwd, target, candidate),
        this.api(cwd, pull, "repos/" + target.repository + "/pulls/" + pr.number),
        this.mergeQueueEnabled(cwd, target.repository, pr.number),
      ]);
      if (fresh.revision !== evidence.revision || fresh.result.status !== "checks_verified" ||
          queue || fresh.reviewRequired || !mergeReady(current) || this.clock() >= decision.validUntil) block("merge_evidence_changed");
      await this.run("gh", ["pr", "merge", prUrl, "--repo", target.repository, "--squash", "--match-head-commit", candidate], cwd);
    });
    return { state: "merged", sha: candidate, prUrl, reason: decision.review === "deferred" ? "review_deferred" : undefined };
  }

  async integrate(child: RunRecord, parent: RunRecord): Promise<RunDelivery> {
    const plan = child.gitPlan!;
    const candidate = child.delivery?.sha;
    try {
      if (!candidate || candidate === plan.baseSha) return child.delivery ?? { state: "no_changes" };
      const source = await this.managed(plan);
      const parentPlan = parent.gitPlan!;
      const target = await this.managed(parentPlan);
      if (!samePath(target.cwd, plan.source) || source.repository !== target.repository || source.head !== candidate) return block("integration_target_changed");
      if (target.operation || target.tracked.length || target.untracked.length) return block("integration_worktree_dirty");
      const id = child.id + "-integrate";
      const saved = await this.plans.update(state => ({ result: state.plans[id] }));
      let expected = saved?.expectedSha;
      if (!expected) {
        if (await this.ancestor(target.cwd, candidate, target.head)) return { state: "integrated", sha: candidate };
        if (!await this.ancestor(target.cwd, plan.baseSha, target.head)) return block("base_diverged");
        if (target.head === plan.baseSha) expected = candidate;
        else {
          const contents = await this.git(target.cwd, "merge-tree", "--write-tree", target.head, candidate)
            .catch(error => { if (errorCode(error, 1)) return block("integration_conflict"); throw error; });
          expected = sha.parse((await this.git(target.cwd, "commit-tree", sha.parse(contents.trim()), "-p", target.head,
            "-p", candidate, "-m", "chore: integrate delegated task")).trim());
        }
      }
      const intent = await this.effect(id, { repository: target.repository, targetRef: target.ref, previousSha: target.head, expectedSha: expected },
        () => this.revision(target.cwd, target.ref), async operation => {
          const fresh = await this.managed(parentPlan);
          if (fresh.head !== operation.previousSha || fresh.operation || fresh.tracked.length || fresh.untracked.length) block("integration_worktree_dirty");
          // Fast-forward to a precomputed merge commit so Git updates both the ref and checkout without a conflict state.
          await this.git(target.cwd, "merge", "--ff-only", "--no-edit", "--no-overwrite-ignore", operation.expectedSha);
        });
      if (!await this.ancestor(target.cwd, intent.expectedSha, await this.revision(target.cwd, target.ref))) return block("integration_target_changed");
      return { state: "integrated", sha: candidate };
    } catch (error) {
      return { state: "blocked", sha: candidate, reason: error instanceof DeliveryBlocked ? error.message : "integration_unverified" };
    }
  }

  async retire(run: RunRecord, inactive: () => Promise<boolean>): Promise<boolean> {
    const plan = run.gitPlan;
    const deliveryState = run.delivery?.state;
    const pendingValidation = !!run.delivery?.prUrl && deliveryState !== "merged" ||
      deliveryState === "review" || deliveryState === "checks" ||
      run.delivery?.reason === "review_deferred" ||
      !!run.parentRunId && deliveryState === "local";
    if (!plan?.cwd || !plan.workspaceId || pendingValidation) return false;
    const registration = async () => {
      const paths = nul(await this.git(plan.source, "worktree", "list", "--porcelain", "-z"))
        .filter(line => line.startsWith("worktree ")).map(line => line.slice(9).replaceAll("\\", "/"));
      return paths.some(path => samePath(path, plan.cwd!.replaceAll("\\", "/")));
    };
    const ref = "refs/zelqio/retire/" + run.id;
    const check = async () => {
      const tree = await this.managed(plan);
      const ignored = await this.git(tree.cwd, "ls-files", "-z", "--others", "--ignored", "--exclude-standard");
      const scope = { repository: plan.repository, workspace: plan.workspaceId!, worktree: plan.cwd! };
      const result = inspectWorktreeRetirement(scope, {
        ...scope, kind: "managed", ownership: "verified", changes: tree.tracked.length ? "present" : "clear",
        untracked: tree.untracked.length ? "present" : "clear", ignored: ignored ? "present" : "clear",
        operations: tree.operation ? "present" : "clear", activeReferences: await inactive() ? "clear" : "present",
        pendingValidations: pendingValidation ? "present" : "clear",
        commitsPreserved: await this.revision(tree.cwd, tree.ref) === tree.head &&
          (!run.delivery?.sha || run.delivery.sha === tree.head) ? "verified" : "unknown",
        nonForceRemoval: "verified",
      });
      return result.status === "retirement_candidate" ? tree : null;
    };
    try {
      const id = run.id + "-retire";
      const saved = await this.plans.update(state => ({ result: state.plans[id] }));
      const tree = await registration() ? await check() : null;
      if (!saved && !tree) return false;
      const candidate = saved?.expectedSha ?? tree!.head;
      const before = opaque(ref, candidate);
      await this.effect(id, { repository: plan.repository, targetRef: ref, previousSha: before, expectedSha: candidate },
        async () => {
          if (await registration()) return before;
          if (await lstat(plan.cwd!).then(() => true, error => {
            if (errorCode(error, "ENOENT")) return false;
            throw error;
          })) return null;
          return await this.revision(plan.source, branchRef(plan.branch)) === candidate ? candidate : null;
        },
        async () => {
          if (!await check()) block("retirement_unverified");
          await this.git(plan.source, "worktree", "remove", "--", plan.cwd!);
        });
      return true;
    } catch {
      return false;
    }
  }
}
