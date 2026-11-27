import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { setTimeout } from "node:timers/promises";

export const version = "0.17.5";
export const endpoint = "127.0.0.1:16775";
export const provider = "zelqio-fixture";
export const report = (test, result) => console.log(JSON.stringify({ test, result }));
export const here = fileURLToPath(new URL(".", import.meta.url));

export async function eventually(read, valid, timeout = 15_000) {
  const deadline = Date.now() + timeout;
  do {
    const value = await read();
    if (valid(value)) return value;
    await setTimeout(150);
  } while (Date.now() < deadline);
  throw new Error("Timed out waiting for fixture state");
}

export function isolate(root, run, git) {
  assert.match(run, /^run-t08-[a-z0-9-]+$/);
  assert(isAbsolute(git));
  const sandbox = realpathSync(root);
  const homes = join(sandbox, "home-0175");
  assert.equal(realpathSync(homes), homes);
  const home = join(homes, run);
  const installed = join(sandbox, "v0.17.5", "node_modules", "@getpaseo");
  const cli = join(installed, "cli", "bin", "paseo");
  assert.equal(JSON.parse(readFileSync(join(installed, "cli", "package.json"))).version, version);
  const profile = join(home, "profile");
  const system = join(process.env.SystemRoot, "System32");
  const env = {
    SystemRoot: process.env.SystemRoot,
    SystemDrive: process.env.SystemDrive,
    ComSpec: process.env.ComSpec,
    PATH: [dirname(process.execPath), dirname(git), system, join(system, "WindowsPowerShell", "v1.0")].join(";"),
    PATHEXT: ".COM;.EXE;.BAT;.CMD",
    USERPROFILE: profile,
    HOME: profile,
    APPDATA: join(profile, "Roaming"),
    LOCALAPPDATA: join(profile, "Local"),
    TEMP: join(profile, "Temp"),
    TMP: join(profile, "Temp"),
    XDG_CONFIG_HOME: join(profile, "config"),
    XDG_DATA_HOME: join(profile, "data"),
    XDG_CACHE_HOME: join(profile, "cache"),
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: join(profile, "gitconfig"),
    GIT_TERMINAL_PROMPT: "0",
    GIT_ALLOW_PROTOCOL: "file",
    GIT_AUTHOR_NAME: "Synthetic Fixture",
    GIT_AUTHOR_EMAIL: "fixture@example.invalid",
    GIT_COMMITTER_NAME: "Synthetic Fixture",
    GIT_COMMITTER_EMAIL: "fixture@example.invalid",
    DO_NOT_TRACK: "1",
    ZF_T08_HOME: home,
    ZF_T08_GIT: git,
  };
  function command(exe, args, cwd = home, extra = {}) {
    const result = spawnSync(exe, args, {
      cwd, env, encoding: "utf8", windowsHide: true, timeout: 55_000, ...extra,
    });
    if (result.error) throw result.error;
    return { code: result.status, stdout: result.stdout.trim(), stderr: result.stderr.trim() };
  }
  function systemCommand(name, args) {
    return command(join(system, name), args, sandbox);
  }
  function paseo(...args) {
    return command(process.execPath, [cli, ...args, "--home", home, "--json"]);
  }
  function checked(...args) {
    const result = paseo(...args);
    assert.equal(result.code, 0, result.stdout || result.stderr);
    return JSON.parse(result.stdout);
  }
  function listeners(port) {
    const result = systemCommand("netstat.exe", ["-ano"]);
    assert.equal(result.code, 0, result.stderr);
    return result.stdout.split(/\r?\n/).map(line => line.trim().split(/\s+/))
      .filter(([proto, address, , state]) => proto === "TCP" && address?.endsWith(`:${port}`) && state === "LISTENING")
      .map(([, address, , , pid]) => ({ address, pid: Number(pid) }));
  }
  function initialize({ speech = false, plugins = true, trace = false } = {}) {
    assert.deepEqual(listeners(16775), []);
    mkdirSync(home);
    for (const path of [env.TEMP, env.APPDATA, env.LOCALAPPDATA]) mkdirSync(path, { recursive: true });
    checked("daemon", "config", "set", "daemon.listen", endpoint);
    checked("daemon", "config", "set", "daemon.relay.enabled", "false");
    checked("daemon", "config", "set", "features.dictation.enabled", String(speech));
    checked("daemon", "config", "set", "features.voiceMode.enabled", String(speech));
    checked("daemon", "config", "set", "pluginsEnabled", String(plugins));
    if (trace) {
      env.NODE_OPTIONS = `--require="${join(here, "network.cjs").replaceAll("\\", "/")}"`;
      env.ZF_T08_NETWORK = join(home, "node-network.ndjson");
    }
  }
  function start() {
    assert.deepEqual(listeners(16775), []);
    checked("daemon", "start", "--timeout", "30");
    const status = checked("daemon", "status");
    const [listener, ...others] = listeners(16775);
    assert.equal(others.length, 0);
    assert.equal(listener?.address, endpoint);
    assert.equal(status.listen, endpoint);
    assert.equal(status.daemonVersion, version);
    assert.equal(status.desktopManaged, false);
    assert.equal(status.relay?.enabled, false);
    assert.equal(status.connectedDaemon, "reachable");
    assert([status.pid, status.workerPid].includes(listener.pid));
    return { pid: listener.pid, supervisor: status.pid, serverId: status.serverId };
  }
  function stop() {
    checked("daemon", "stop", "--timeout", "20");
    assert.deepEqual(listeners(16775), []);
  }
  function crash(identity, regular) {
    assert.deepEqual(listeners(6767), regular);
    assert.deepEqual(listeners(16775), [{ address: endpoint, pid: identity.pid }]);
    assert(!regular.some(row => [identity.pid, identity.supervisor].includes(row.pid)));
    // Kill the verified supervisor's tree so its watchdog cannot restart the worker.
    const status = checked("daemon", "status");
    assert.equal(status.pid, identity.supervisor);
    assert.equal(status.serverId, identity.serverId);
    const result = systemCommand("taskkill.exe", ["/PID", String(identity.supervisor), "/T", "/F"]);
    assert.equal(result.code, 0, result.stderr || result.stdout);
    assert.deepEqual(listeners(16775), []);
  }
  async function connect(clientId) {
    const entry = join(installed, "client", "dist", "node", "index.js");
    const { createHostClient } = await import(pathToFileURL(entry).href);
    const client = createHostClient(endpoint, {
      clientId, clientType: "cli", connectTimeoutMs: 5000, reconnect: { enabled: false },
    });
    await client.connect();
    assert.equal(client.getLastServerInfoMessage().version, version);
    return client;
  }
  function repo() {
    function gitAt(cwd, ...args) {
      const result = command(git, args, cwd);
      assert.equal(result.code, 0, result.stderr || result.stdout);
      return result.stdout;
    }
    const bare = join(home, "bare.git");
    const cwd = join(home, "clone");
    gitAt(home, "init", "--bare", "--initial-branch=main", bare);
    gitAt(home, "clone", bare, cwd);
    const g = (...args) => gitAt(cwd, ...args);
    writeFileSync(join(cwd, "tracked.txt"), "baseline\n");
    g("add", "tracked.txt");
    const tree = g("write-tree");
    const previousSha = g("commit-tree", tree, "-m", "synthetic baseline");
    const expectedSha = g("commit-tree", tree, "-p", previousSha, "-m", "synthetic candidate");
    g("update-ref", "refs/heads/main", previousSha);
    return { cwd, g, previousSha, expectedSha };
  }
  async function within(options, body) {
    const regular = listeners(6767);
    assert(regular.some(row => row.address === "127.0.0.1:6767"), "Regular listener must be present for the control");
    assert(!existsSync(home), "Use a fresh fixture home");
    try {
      initialize(options);
      await body(regular);
    } finally {
      if (existsSync(home)) {
        try {
          if (listeners(16775).length) stop();
        } finally {
          assert.deepEqual(listeners(16775), []);
          assert.deepEqual(listeners(6767), regular);
          report("isolation", { isolatedListenerClosed: true, regularListenerUnchanged: true, regular });
        }
      }
    }
  }
  return { home, installed, checked, paseo, listeners, start, stop, crash, connect, repo, within };
}
