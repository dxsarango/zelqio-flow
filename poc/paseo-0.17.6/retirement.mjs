import assert from "node:assert/strict";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, join, relative } from "node:path";
import { pathToFileURL } from "node:url";
import { createRepo, dirtyWorktree } from "../paseo-0.17.5/retirement.mjs";
import { print } from "./client.mjs";

export async function exercise(probe, git) {
  const repo = createRepo(probe, git);
  const outer = dirtyWorktree(probe, repo, "outer");
  const dirty = dirtyWorktree(probe, repo, "archive-dirty");
  assert.match(relative(probe.home, dirty.path), /^configured-worktrees[\\/]/i);
  const archived = probe.paseo("workspace", "archive", dirty.workspace.workspaceId);
  const removal = readFileSync(join(probe.home, "fixture-git.trace"), "utf8").split(/\r?\n/)
    .find(line => /worktree remove.+--force/i.test(line) && line.replaceAll("\\", "/").includes(dirty.path.replaceAll("\\", "/")));
  print("P3-dirty", { before: dirty.before, code: archived.code, directory: existsSync(dirty.path),
    force: Boolean(removal), branchPreserved: Boolean(repo.git("rev-parse", "refs/heads/probe/archive-dirty")) });

  // Reproduce the marker walk with a configured root nested inside an existing native worktree.
  const nested = join(outer.path, "nested-root");
  probe.stop();
  probe.checked("daemon", "config", "set", "worktrees.root", nested);
  print("restart", probe.start());
  const inner = dirtyWorktree(probe, repo, "missing-inner");
  const innerPath = relative(realpathSync(nested), realpathSync(inner.path));
  assert(innerPath && !innerPath.startsWith("..") && !isAbsolute(innerPath));
  repo.gitAt(inner.path, "restore", "dirty.txt");
  repo.gitAt(inner.path, "clean", "-f", "--", "untracked.txt");
  assert.equal(repo.gitAt(inner.path, "status", "--porcelain"), "");
  probe.stop();
  repo.git("worktree", "remove", inner.path);
  assert(!existsSync(inner.path));
  const before = readFileSync(join(probe.home, "fixture-git.trace"), "utf8").length;
  const utilityPath = join(probe.installed, "@getpaseo", "server", "dist", "server", "utils", "worktree.js");
  const { isPaseoOwnedWorktreeCwd } = await import(pathToFileURL(utilityPath).href);
  const backing = await isPaseoOwnedWorktreeCwd(inner.path, { paseoHome: probe.home, worktreesRoot: nested,
    knownGitCommonDir: join(repo.clone, ".git") });
  assert(backing.worktreePath);
  assert.equal(relative(inner.path, backing.worktreePath), "");
  print("restart", probe.start());
  const result = probe.paseo("workspace", "archive", inner.workspace.workspaceId);
  const trace = readFileSync(join(probe.home, "fixture-git.trace"), "utf8").slice(before);
  const removalTargets = trace.split(/\r?\n/).flatMap(line => {
    const match = /\bgit worktree remove (?:'([^']+)'|"([^"]+)"|(\S+))/i.exec(line);
    return match ? [match[1] ?? match[2] ?? match[3]] : [];
  });
  const removedOuter = removalTargets.some(target => relative(outer.path, target) === "");
  assert(!removedOuter);
  assert.equal(result.code, 0, result.stdout || result.stderr);
  print("P3-ownership", { code: result.code, archive: result.stdout, ownsExpectedPath: backing.allowed,
    owningPath: relative(nested, backing.worktreePath), outerStillExists: existsSync(outer.path),
    outerStillDirty: repo.gitAt(outer.path, "status", "--porcelain").includes("M dirty.txt"),
    removalTargets: removalTargets.map(target => relative(nested, target)), removedOuter });
}
