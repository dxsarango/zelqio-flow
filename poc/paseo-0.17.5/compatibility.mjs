import assert from "node:assert/strict";
import { cpSync, mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { connect, print } from "./client.mjs";

export async function exercise(probe, git, npmCli, worktree) {
  const repository = realpathSync(worktree);
  const copy = join(probe.fixture, "main-copy");
  const packs = join(probe.fixture, "packages");
  mkdirSync(copy);
  mkdirSync(packs);
  function checked(command, args, cwd) {
    const result = probe.runCommand(command, args, cwd);
    assert.equal(result.code, 0, result.stdout + "\n" + result.stderr);
    return result.stdout;
  }
  function runNpm(cwd, ...args) {
    return checked(process.execPath, [npmCli, "--offline", "--no-audit", "--no-fund",
      "--userconfig", join(probe.home, "npmrc"), "--cache", join(probe.home, "npm-cache"), ...args], cwd);
  }
  const commit = checked(git, ["rev-parse", "main"], repository);
  const archive = join(probe.fixture, "main.tar");
  const tar = join(probe.env.SystemRoot, "System32", "tar.exe");
  checked(git, ["archive", "--format=tar", "--output", archive, commit], repository);
  checked(tar, ["-xf", archive, "-C", copy], probe.fixture);
  cpSync(join(repository, "node_modules"), join(copy, "node_modules"), { recursive: true, verbatimSymlinks: true });
  // The prepared sandbox contains tarball contents but has no npm registry metadata cache.
  const packages = ["plugin", "client", "protocol", "relay"];
  for (const name of packages) {
    const dir = join(probe.installed, "@getpaseo", name);
    const stdout = runNpm(packs, "pack", "--ignore-scripts", "--json", dir);
    const pkg = join(packs, JSON.parse(stdout)[0].filename);
    const target = join(copy, "node_modules", "@getpaseo", name);
    renameSync(target, join(packs, `original-${name}`));
    mkdirSync(target);
    checked(tar, ["-xf", pkg, "--strip-components", "1", "-C", target], probe.fixture);
  }
  const packageJson = join(copy, "package.json");
  const project = JSON.parse(readFileSync(packageJson, "utf8"));
  project.devDependencies["@getpaseo/plugin"] = "0.17.5";
  writeFileSync(packageJson, JSON.stringify(project, null, 2));
  const manifest = name => JSON.parse(readFileSync(join(copy, "node_modules", "@getpaseo", name, "package.json")));
  for (const name of packages) assert.equal(manifest(name).version, "0.17.5");
  const npmVersion = runNpm(copy, "--version");
  const tree = JSON.parse(runNpm(copy, "ls", "@getpaseo/plugin", "@getpaseo/client", "@getpaseo/protocol",
    "@getpaseo/relay", "--all", "--json"));
  assert.deepEqual(tree.problems ?? [], []);
  const check = runNpm(copy, "run", "check").replace(/\u001b\[[\d;]*m/g, "");
  print("compatibility-checks", { commit, npmVersion, sdk: manifest("plugin").version, packageProblems: [],
    summary: check.split(/\r?\n/).filter(line => /Test Files|Tests +\d+ passed/.test(line)).map(line => line.trim()) });
  probe.checked("plugin", "install", copy);
  print("compatibility-plugin-list", probe.checked("plugin", "ls").filter(row => row.id === "zelqio-flow"));
  const { client } = await connect(probe);
  try {
    const calls = {
      "zelqio.status": {},
      "zelqio.providers.list": {},
      "zelqio.usage.list": {},
      "zelqio.roles.list": {},
      "zelqio.routing.preview": { role: "developer", capability: "implement", models: [] },
      "settings.general.read": {},
    };
    for (const [method, input] of Object.entries(calls)) {
      const output = await client.invokePluginRpc("zelqio-flow", method, input);
      print(method, { ok: output.ok, status: output.status ?? output.data?.status,
        keys: Object.keys(output.data ?? output).sort() });
      if (method.startsWith("zelqio.")) assert.equal(output.ok, true, JSON.stringify(output));
      else assert.equal(output.status, "ready");
    }
  } finally {
    await client.close();
  }
}
