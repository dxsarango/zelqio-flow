import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

export function isolate(root, run, git, version, { delegation = false, fixtureTools = delegation } = {}) {
  assert.match(run, /^run-[a-z0-9-]+$/);
  assert(["0.17.5", "0.17.6"].includes(version));
  const sandbox = realpathSync(root);
  const installed = join(sandbox, `v${version}`, "node_modules", "@getpaseo");
  const cli = join(installed, "cli", "bin", "paseo");
  const manifest = name => JSON.parse(readFileSync(join(installed, name, "package.json"), "utf8"));
  for (const name of ["cli", "client", "plugin"]) assert.equal(manifest(name).version, version);
  const homeRoot = join(sandbox, delegation ? "home-deleg" : "home-e2e");
  if (existsSync(homeRoot)) assert.equal(realpathSync(homeRoot), homeRoot);
  const home = join(homeRoot, run);
  assert(!existsSync(home), "Use a fresh run identifier");
  const profile = join(home, "profile");
  const fixture = join(home, "fixture");
  const cwd = join(home, "workspace");
  const system = join(process.env.SystemRoot, "System32");
  const env = {
    SystemRoot: process.env.SystemRoot,
    SystemDrive: process.env.SystemDrive,
    ComSpec: process.env.ComSpec,
    PATH: [dirname(process.execPath), dirname(realpathSync(git)), system, join(system, "WindowsPowerShell", "v1.0")].join(";"),
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
    DO_NOT_TRACK: "1",
    ZELQIO_E2E_FIXTURE: fixture,
    ZELQIO_FLOW_HOME: join(home, "zelqio-state"),
    ZELQIO_TICK_MS: "1000",
    ZELQIO_RECHECK_MS: "500",
    ZELQIO_DEFAULT_WAIT_MS: "1000",
  };
  function command(executable, args) {
    const result = spawnSync(executable, args, { cwd: sandbox, env, encoding: "utf8", windowsHide: true, timeout: delegation ? 300_000 : 60_000 });
    if (result.error) throw result.error;
    assert.equal(result.status, 0, result.stderr || result.stdout);
    return result.stdout;
  }
  function checked(...args) {
    return JSON.parse(command(process.execPath, [cli, ...args, "--home", home, "--json"]));
  }
  function listeners() {
    return command(join(system, "netstat.exe"), ["-ano", "-p", "TCP"]).split(/\r?\n/)
      .map(line => line.trim().split(/\s+/))
      .filter(([, , , state]) => state === "LISTENING")
      .map(([, address, , , pid]) => ({ address, pid: Number(pid) }));
  }
  const atPort = (rows, port) => rows.filter(row => row.address.endsWith(`:${port}`));
  const initial = listeners();
  const regular = atPort(initial, 6767);
  const firstPort = delegation ? 16801 : 16791;
  const port = Array.from({ length: 10 }, (_, index) => firstPort + index).find(p => atPort(initial, p).length === 0);
  assert(port, `No free port in ${firstPort}–${firstPort + 9}`);
  const endpoint = `127.0.0.1:${port}`;
  if (fixtureTools) env.ZELQIO_E2E_ENDPOINT = endpoint;
  function initialize() {
    mkdirSync(homeRoot, { recursive: true });
    mkdirSync(home);
    for (const path of [fixture, cwd, env.TEMP, env.APPDATA, env.LOCALAPPDATA]) mkdirSync(path, { recursive: true });
    for (const id of ["fixture-a", "fixture-b"]) {
      writeFileSync(join(fixture, `${id}.json`), JSON.stringify({ remainingPct: 95, resetsAt: null }));
    }
    checked("daemon", "config", "set", "daemon.listen", endpoint);
    checked("daemon", "config", "set", "daemon.relay.enabled", "false");
    checked("daemon", "config", "set", "features.dictation.enabled", "false");
    checked("daemon", "config", "set", "features.voiceMode.enabled", "false");
    checked("daemon", "config", "set", "pluginsEnabled", "true");
    if (fixtureTools) checked("daemon", "config", "set", "daemon.mcp.injectIntoAgents", "true");
  }
  let startRequested = false;
  function start() {
    assert.deepEqual(atPort(listeners(), port), []);
    startRequested = true;
    checked("daemon", "start", "--timeout", delegation ? "180" : "30");
    const status = checked("daemon", "status");
    assert.equal(status.listen, endpoint);
    assert.equal(status.daemonVersion, version);
    assert.equal(status.desktopManaged, false);
    assert.equal(status.connectedDaemon, "reachable");
    assert.equal(status.relay?.enabled, false);
    const isolated = atPort(listeners(), port);
    assert.equal(isolated.length, 1);
    assert.equal(isolated[0].address, endpoint);
    assert([status.pid, status.workerPid].includes(isolated[0].pid));
    assert(!regular.some(row => [status.pid, status.workerPid].includes(row.pid)));
    return { endpoint, pid: isolated[0].pid, version };
  }
  function stop() {
    if (startRequested) {
      try {
        checked("daemon", "stop", "--timeout", delegation ? "90" : "20");
      } catch (error) {
        if (!delegation) throw error;
        // The home was created by this run and the CLI checks ownership of its PID lock.
        checked("daemon", "stop", "--timeout", "60", "--force");
      }
      startRequested = false;
    }
    assert.deepEqual(atPort(listeners(), port), []);
  }
  function verifyCleanup() {
    const after = listeners();
    const isolated = atPort(after, port);
    const sameRegular = atPort(after, 6767);
    console.log(JSON.stringify({ isolation: { before: regular, after: sameRegular, remainingIsolated: isolated } }));
    assert.deepEqual(sameRegular, regular);
    assert.deepEqual(isolated, []);
  }
  async function connect() {
    const clientDir = join(installed, "client", "dist");
    const { createHostClient } = await import(pathToFileURL(join(clientDir, "node", "index.js")).href);
    const { createPaseoApi } = await import(pathToFileURL(join(clientDir, "index.js")).href);
    const client = createHostClient(endpoint, { clientId: "zelqio-e2e", clientType: "cli" });
    try {
      await client.connect();
      assert.equal(client.getLastServerInfoMessage().version, version);
      return { client, api: createPaseoApi(client) };
    } catch (error) {
      await client.close();
      throw error;
    }
  }
  return { cwd, fixture, checked, initialize, start, stop, verifyCleanup, connect };
}
