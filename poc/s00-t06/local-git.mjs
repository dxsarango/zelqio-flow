import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const fixture = mkdtempSync(join(tmpdir(), "zelqio-s00-t06-"));
const repo = join(fixture, "integration");
const workerA = join(fixture, "worker-a");
const workerB = join(fixture, "worker-b");
const conflictA = join(fixture, "conflict-a");
const conflictB = join(fixture, "conflict-b");

function git(cwd, args, expectedStatus = 0) {
  const result = spawnSync("git", [
    "-c", "user.name=POC Fixture",
    "-c", "user.email=fixture@example.invalid",
    "-c", "commit.gpgsign=false",
    "-c", "core.autocrlf=false",
    "-C", cwd, ...args,
  ], { encoding: "utf8" });
  if (result.error) throw result.error;
  assert.equal(result.status, expectedStatus, `git ${args.join(" ")}: ${result.stderr}`);
  return result.stdout.trim();
}

function commit(cwd, file, content, message) {
  writeFileSync(join(cwd, file), content + "\n");
  git(cwd, ["add", "--", file]);
  git(cwd, ["commit", "-m", message]);
  return git(cwd, ["rev-parse", "HEAD"]);
}

git(fixture, ["init", "-b", "main", repo]);
const base = commit(repo, "shared.txt", "base", "test: initialize disposable fixture");

git(repo, ["worktree", "add", "-b", "test/worker-a", workerA, base]);
git(repo, ["worktree", "add", "-b", "test/worker-b", workerB, base]);
for (const checkout of [workerA, workerB]) assert.equal(git(checkout, ["rev-parse", "HEAD"]), base);
const a = commit(workerA, "a.txt", "worker A", "test: add worker A output");
const b = commit(workerB, "b.txt", "worker B", "test: add worker B output");
git(repo, ["merge", "--no-ff", "--no-edit", a]);
git(repo, ["merge", "--no-ff", "--no-edit", b]);
const cleanCandidate = git(repo, ["rev-parse", "HEAD"]);
assert.equal(readFileSync(join(repo, "a.txt"), "utf8"), "worker A\n");
assert.equal(readFileSync(join(repo, "b.txt"), "utf8"), "worker B\n");
assert.equal(git(repo, ["status", "--porcelain"]), "");
git(repo, ["merge-base", "--is-ancestor", a, cleanCandidate]);
git(repo, ["merge-base", "--is-ancestor", b, cleanCandidate]);
console.log(JSON.stringify({ poc: "09", status: "PASS", base, candidate: cleanCandidate }));

git(repo, ["worktree", "add", "-b", "test/conflict-a", conflictA, cleanCandidate]);
git(repo, ["worktree", "add", "-b", "test/conflict-b", conflictB, cleanCandidate]);
const left = commit(conflictA, "shared.txt", "left", "test: change shared content on A");
const right = commit(conflictB, "shared.txt", "right", "test: change shared content on B");
git(repo, ["merge", "--no-ff", "--no-edit", left]);
const beforeConflict = git(repo, ["rev-parse", "HEAD"]);
git(repo, ["merge", "--no-ff", "--no-edit", right], 1);

// Each call runs a fresh Git process. Inspect the persisted merge before choosing a recovery.
assert.equal(git(repo, ["rev-parse", "HEAD"]), beforeConflict);
assert.equal(git(repo, ["rev-parse", "MERGE_HEAD"]), right);
assert.match(git(repo, ["status", "--porcelain"]), /^UU shared\.txt$/);
git(repo, ["merge", "--abort"]);
assert.equal(git(repo, ["rev-parse", "HEAD"]), beforeConflict);
assert.equal(git(repo, ["status", "--porcelain"]), "");
assert.equal(git(conflictA, ["rev-parse", "HEAD"]), left);
assert.equal(git(conflictB, ["rev-parse", "HEAD"]), right);

git(repo, ["merge", "--no-ff", "--no-edit", right], 1);
const recovered = commit(repo, "shared.txt", "left + right", "test: resolve fixture conflict");
assert.equal(git(repo, ["rev-parse", "HEAD^1"]), beforeConflict);
assert.equal(git(repo, ["rev-parse", "HEAD^2"]), right);
assert.equal(readFileSync(join(repo, "shared.txt"), "utf8"), "left + right\n");
assert.equal(git(repo, ["status", "--porcelain"]), "");
git(repo, ["merge", "--no-ff", "--no-edit", right]);
assert.equal(git(repo, ["rev-parse", "HEAD"]), recovered);
console.log(JSON.stringify({ poc: "10", status: "PASS", beforeConflict, pending: right, recovered }));
