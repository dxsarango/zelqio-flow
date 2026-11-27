import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";

export const port = 16775;
export const endpoint = `127.0.0.1:${port}`;
export const version = "0.17.6";

export function isolate(root, run, git) {
  assert.match(run, /^run-[a-z0-9-]+$/);
  const sandbox = realpathSync(root);
  const installed = join(sandbox, `v${version}`, "node_modules");
  const cli = join(installed, "@getpaseo", "cli", "bin", "paseo");
  assert.equal(JSON.parse(readFileSync(join(dirname(dirname(cli)), "package.json"))).version, version);
  const home = join(sandbox, "home-0176", run);
  const fixture = join(sandbox, "fixtures", run);
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
    GIT_TRACE: join(home, "fixture-git.trace"),
    DO_NOT_TRACK: "1",
    NODE_USE_ENV_PROXY: "1",
    HTTP_PROXY: "http://127.0.0.1:16777",
    HTTPS_PROXY: "http://127.0.0.1:16777",
    NO_PROXY: "127.0.0.1,localhost",
  };
  function runCommand(command, args, cwd = sandbox) {
    const result = spawnSync(command, args, { cwd, env, encoding: "utf8", windowsHide: true, timeout: 90_000 });
    if (result.error) throw result.error;
    return { code: result.status, stdout: result.stdout.trim(), stderr: result.stderr.trim() };
  }
  function paseo(...args) {
    return runCommand(process.execPath, [cli, ...args, "--home", home, "--json"]);
  }
  function checked(...args) {
    const result = paseo(...args);
    assert.equal(result.code, 0, result.stdout || result.stderr);
    return JSON.parse(result.stdout);
  }
  function listener(port) {
    const result = runCommand(join(process.env.SystemRoot, "System32", "netstat.exe"), ["-ano", "-p", "TCP"]);
    assert.equal(result.code, 0, result.stderr);
    return result.stdout.split(/\r?\n/).map(line => line.trim().split(/\s+/))
      .filter(([, address, , state]) => address?.endsWith(`:${port}`) && state === "LISTENING")
      .map(([, address, , , pid]) => ({ address, pid: Number(pid) }));
  }
  function initialize() {
    assert(!existsSync(home) && !existsSync(fixture), "Use a fresh run identifier");
    mkdirSync(home, { recursive: true });
    mkdirSync(fixture, { recursive: true });
    for (const path of [env.TEMP, env.APPDATA, env.LOCALAPPDATA]) mkdirSync(path, { recursive: true });
    checked("daemon", "config", "set", "daemon.listen", endpoint);
    checked("daemon", "config", "set", "daemon.relay.enabled", "false");
    checked("daemon", "config", "set", "features.dictation.enabled", "false");
    checked("daemon", "config", "set", "features.voiceMode.enabled", "false");
    checked("daemon", "config", "set", "pluginsEnabled", "true");
  }
  function start() {
    assert.deepEqual(listener(port), []);
    checked("daemon", "start", "--timeout", "45");
    const status = checked("daemon", "status");
    assert.equal(status.listen, endpoint);
    assert.equal(status.daemonVersion, version);
    assert.equal(status.desktopManaged, false);
    assert.equal(status.connectedDaemon, "reachable");
    assert(status.pid && status.serverId);
    assert.equal(status.relay?.enabled, false);
    const isolated = listener(port);
    assert.equal(isolated.length, 1);
    assert.equal(isolated[0].address, endpoint);
    assert([status.pid, status.workerPid].includes(isolated[0].pid));
    assert(!listener(6767).some(row => [status.pid, status.workerPid].includes(row.pid)));
    return { ...isolated[0], workerPid: status.workerPid, supervisorPid: status.pid, serverId: status.serverId, version };
  }
  function stop() {
    if (!existsSync(home)) return;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const result = paseo("daemon", "stop", "--timeout", "20");
      if (result.code === 0 && listener(port).length === 0) return;
      if (result.code !== 0) console.error("Isolated stop:", result.stdout || result.stderr);
    }
    assert.deepEqual(listener(port), []);
  }
  return { home, fixture, installed, cli, env, runCommand, checked, paseo, listener, initialize, start, stop };
}
