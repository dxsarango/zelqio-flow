import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { setTimeout } from "node:timers/promises";
import { eventually, isolate, report } from "./isolation.mjs";

const exec = promisify(execFile);
const system = join(process.env.SystemRoot, "System32");
const powershell = join(system, "WindowsPowerShell/v1.0/powershell.exe");
const project = fileURLToPath(new URL("../../", import.meta.url));
const loopback = address => /^\[?(?:::ffff:)?127\.|^\[?::1(?:\]|$)/i.test(address);
const fixtureOptions = { windowsHide: true, timeout: 5000 };
const descendants = (rows, known) => {
  let size;
  do {
    size = known.size;
    for (const { pid, parent } of rows) if (known.has(parent)) known.add(pid);
  } while (known.size !== size);
  return known;
};

async function sample() {
  const time = new Date().toISOString();
  const [processes, sockets] = await Promise.all([
    exec(powershell, ["-NoProfile", "-NonInteractive", "-Command",
      "Get-CimInstance Win32_Process -Property ProcessId,ParentProcessId -ErrorAction Stop | ForEach-Object { '{0} {1}' -f $_.ProcessId,$_.ParentProcessId }"],
    fixtureOptions),
    exec(join(system, "netstat.exe"), ["-ano"], fixtureOptions),
  ]);
  const rows = processes.stdout.trim().split(/\r?\n/).map(line => {
    const [pid, parent] = line.trim().split(/\s+/).map(Number);
    return { pid, parent };
  });
  const connections = sockets.stdout.split(/\r?\n/).map(line => line.trim().split(/\s+/))
    .filter(([protocol]) => protocol === "TCP" || protocol === "UDP")
    .map(([protocol, local, remote, stateOrPid, tcpPid]) => ({
      time, protocol, local, remote, state: tcpPid ? stateOrPid : "BOUND", pid: Number(tcpPid ?? stateOrPid),
    }));
  return { rows, connections };
}

async function matrixCase(probe, speech, plugins) {
  if (plugins) {
    probe.start();
    probe.checked("plugin", "install", project);
    probe.stop();
    probe.checked("daemon", "config", "set", "features.dictation.enabled", String(speech));
    probe.checked("daemon", "config", "set", "features.voiceMode.enabled", String(speech));
  }
  const cwd = join(probe.home, "network-calibration");
  const calibrationFile = join(cwd, "started.json");
  mkdirSync(cwd);
  writeFileSync(join(cwd, "paseo.json"), JSON.stringify({
    scripts: { calibration: { type: "service", command: "node calibration.cjs" } },
  }));
  writeFileSync(join(cwd, "calibration.cjs"), `
const { createConnection, createServer } = require("node:net");
const { writeFileSync } = require("node:fs");
const { join } = require("node:path");
const ready = {};
for (const host of ["127.0.0.1", "::1"]) {
  const server = createServer(socket => socket.resume());
  server.listen(0, host, () => {
    const socket = createConnection(server.address().port, host).resume();
    socket.once("connect", () => {
      ready[host] = socket.remotePort;
      if (Object.keys(ready).length === 2) writeFileSync(join(__dirname, "started.json"),
        JSON.stringify({ pid: process.pid, ports: ready }));
    });
  });
}
`);
  let identity;
  const observed = [];
  const processIds = new Set();
  const windowStart = new Date().toISOString();
  function collect({ rows, connections }) {
    if (!identity) return;
    processIds.add(identity.supervisor).add(identity.pid);
    descendants(rows, processIds);
    observed.push(...connections.filter(row => processIds.has(row.pid)));
  }
  // Take OS snapshots after identifying the daemon. Node instrumentation spans startup and teardown.
  identity = probe.start();
  const sampleErrors = [];
  let complete = false;
  let samples = 0;
  const polling = (async () => {
    while (!complete) {
      try { collect(await sample()); samples++; }
      catch (error) { sampleErrors.push(error.code ?? error.name); }
      if (!complete) await setTimeout(300);
    }
  })();
  let rpc = false;
  let calibration;
  let client;
  let workspace;
  try {
    client = await probe.connect("t08-network");
    workspace = (await client.createWorkspace({ source: { kind: "directory", path: cwd },
      title: "synthetic network calibration" })).workspace;
    assert(workspace?.id);
    assert.equal((await client.startWorkspaceScriptWithStatus(workspace.id, "calibration")).error, null);
    calibration = await eventually(() => {
      if (!existsSync(calibrationFile)) return null;
      return JSON.parse(readFileSync(calibrationFile, "utf8"));
    }, Boolean);
    assert(Number.isInteger(calibration.pid) && calibration.pid > 0);
    // Windows ConPTY can reparent the workspace command through a pseudoconsole.
    // Its dedicated readiness marker ties the exact PID and ports back to the isolated service.
    processIds.add(calibration.pid);
    if (plugins) {
      for (const name of ["zelqio.status", "zelqio.roles.list", "zelqio.providers.list"]) {
        const result = await client.invokePluginRpc("zelqio-flow", name, {});
        assert.equal(result.ok, true);
      }
      rpc = true;
    }
    await setTimeout(12_000);
  } finally {
    complete = true;
    await polling;
    try {
      if (workspace) await client.stopWorkspaceScript(workspace.id, "calibration");
    } finally {
      if (client) await client.close();
    }
  }
  const windowEnd = new Date().toISOString();
  probe.stop();
  const log = join(probe.home, "node-network.ndjson");
  const events = existsSync(log) ? readFileSync(log, "utf8").trim().split("\n").map(JSON.parse)
    .filter(row => row.time >= windowStart && row.time <= windowEnd) : [];
  descendants(events.filter(row => row.event === "process"), processIds);
  const node = events.filter(row => processIds.has(row.pid));
  const tuple = (address, port) => address?.includes(":") ? `[${address}]:${port}` : `${address}:${port}`;
  const http = node.filter(row => row.event === "http-socket");
  const sockets = node.filter(row => row.event === "outbound" || row.event === "inbound");
  const remote = observed.filter(row => row.protocol === "TCP" && row.state !== "LISTENING"
    && row.remote !== "0.0.0.0:0" && row.remote !== "[::]:0" && !loopback(row.remote));
  const remoteGroups = new Map();
  for (const row of remote) {
    const match = http.find(event => event.pid === row.pid && tuple(event.remoteAddress, event.remotePort) === row.remote
      && tuple(event.localAddress, event.localPort) === row.local);
    const key = `${row.pid}/${row.remote}/${match?.host ?? "unknown"}`;
    remoteGroups.set(key, { pid: row.pid, remote: row.remote, host: match?.host ?? null,
      purpose: match?.purpose ?? "unattributed" });
  }
  const nodeRemote = sockets.filter(row => row.remoteAddress && !loopback(row.remoteAddress));
  const unattributedNode = nodeRemote.filter(row => !http.some(event => event.pid === row.pid
    && event.localPort === row.localPort && event.remoteAddress === row.remoteAddress && event.remotePort === row.remotePort));
  const childLoopback = Object.fromEntries(Object.entries(calibration.ports).map(([host, port]) => [
    host, observed.some(row => row.pid === calibration.pid && row.protocol === "TCP" && row.remote === tuple(host, port)),
  ]));
  writeFileSync(join(probe.home, "socket-samples.json"), JSON.stringify({ windowStart, windowEnd,
    processIds: [...processIds], calibration, observed, node }, null, 2));
  report("network", {
    speech, plugins, rpc, windowStart, windowEnd, samples, sampleErrors, processCount: processIds.size,
    families: [...new Set([...observed.map(row => row.local.startsWith("[") ? "IPv6" : "IPv4"),
      ...sockets.map(row => row.family).filter(Boolean)])],
    udpBindings: observed.filter(row => row.protocol === "UDP").length,
    osLoopback: observed.filter(row => loopback(row.remote)).length,
    childLoopback,
    osRemote: [...remoteGroups.values()],
    httpHosts: [...new Set(http.map(row => row.host))],
    requestHosts: [...new Set(node.filter(row => row.event === "http-request").map(row => row.host))],
    unattributedNode: unattributedNode.map(row => ({ pid: row.pid, remote: tuple(row.remoteAddress, row.remotePort) })),
    zelqioRemote: nodeRemote.filter(row => row.source === "zelqio-frame").length,
  });
}

export async function exerciseNetwork(sandbox, run, git) {
  for (const [speech, plugins] of [[false, false], [false, true], [true, false], [true, true]]) {
    const probe = isolate(sandbox, `${run}-v${Number(speech)}-p${Number(plugins)}`, git);
    try {
      await probe.within({ speech: !plugins && speech, plugins, trace: true }, () => matrixCase(probe, speech, plugins));
    } catch (error) {
      report("network-error", { speech, plugins, error: String(error) });
      process.exitCode = 1;
    }
  }
}
