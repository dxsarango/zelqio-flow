import assert from "node:assert/strict";
import { existsSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { connect, observations, print } from "./client.mjs";

export function createRepo(probe, git) {
  function gitRun(cwd, ...args) {
    const result = probe.runCommand(git, args, cwd);
    assert.equal(result.code, 0, result.stdout || result.stderr);
    return result.stdout;
  }
  const bare = join(probe.fixture, "bare.git");
  const clone = join(probe.fixture, "clone");
  gitRun(probe.fixture, "init", "--bare", "--initial-branch=main", bare);
  gitRun(probe.fixture, "clone", bare, clone);
  gitRun(clone, "config", "user.name", "Synthetic Fixture");
  gitRun(clone, "config", "user.email", "fixture@example.invalid");
  writeFileSync(join(clone, "dirty.txt"), "baseline\n");
  gitRun(clone, "add", "dirty.txt");
  gitRun(clone, "commit", "-m", "fixture baseline");
  gitRun(clone, "push", "origin", "main");
  return { clone, git: (...args) => gitRun(clone, ...args), gitAt: gitRun };
}

export function installObserver(probe) {
  probe.checked("plugin", "install", fileURLToPath(new URL("./observer", import.meta.url)));
}

export function dirtyWorktree(probe, repo, name, marker) {
  const workspace = probe.checked("workspace", "create", "--isolation", "worktree", "--path", repo.clone,
    "--mode", "branch-off", "--new-branch", `probe/${name}`, "--base", repo.git("rev-parse", "HEAD"), "--title", name);
  const path = realpathSync(workspace.cwd);
  const child = relative(realpathSync(probe.home), path);
  assert(child && child !== ".." && !child.startsWith(`..${sep}`) && !isAbsolute(child));
  writeFileSync(join(path, "dirty.txt"), "modified fixture\n");
  writeFileSync(join(path, "untracked.txt"), "untracked fixture\n");
  if (marker) writeFileSync(join(path, marker), "");
  const before = repo.gitAt(path, "status", "--porcelain");
  assert.match(before, /M dirty\.txt/);
  assert.match(before, /\?\? untracked\.txt/);
  return { workspace, path, before };
}

export async function exercise(probe, git) {
  const repo = createRepo(probe, git);
  installObserver(probe);
  const { client } = await connect(probe);
  try {
    function archive(name, data) {
      const result = probe.paseo("workspace", "archive", data.workspace.workspaceId);
      const directory = existsSync(data.path);
      const listed = repo.git("worktree", "list", "--porcelain").includes(data.path.replaceAll("\\", "/"));
      const trace = readFileSync(join(probe.home, "fixture-git.trace"), "utf8");
      const force = trace.split(/\r?\n/).some(line => /worktree remove.+--force/i.test(line) &&
        line.replaceAll("\\", "/").includes(data.path.replaceAll("\\", "/")));
      const preserved = ["dirty.txt", "untracked.txt"].map(file => {
        const copy = join(data.path, "..", `probe-preserved-${file}`);
        return existsSync(copy) ? readFileSync(copy, "utf8").trim() : null;
      });
      print(name, { workspaceId: data.workspace.workspaceId, before: data.before, code: result.code,
        result: JSON.parse(result.stdout || result.stderr), directory, listed, force, preserved });
    }
    archive("no-teardown", dirtyWorktree(probe, repo, "throw-after"));
    writeFileSync(join(repo.clone, "paseo.json"), JSON.stringify({ worktree: { teardown: ["echo fixture-teardown"] } }));
    repo.git("add", "paseo.json");
    repo.git("commit", "-m", "fixture teardown");
    archive("denied-command", dirtyWorktree(probe, repo, "deny-command", "deny-teardown"));
    archive("preserving-command", dirtyWorktree(probe, repo, "copy-command", "copy-before-teardown"));
    print("archive-hooks", (await observations(client)).filter(row => /archive|command\.run/.test(row.hook)));
  } finally {
    await client.close();
  }
}
