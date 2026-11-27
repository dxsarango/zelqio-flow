import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import { Readable } from "node:stream";
import { setTimeout } from "node:timers/promises";
import { connect, eventually, observations, print, provider } from "./client.mjs";
import { endpoint } from "./isolation.mjs";
import { createRepo, dirtyWorktree, installObserver } from "./retirement.mjs";

const webPort = 16776;
const webOrigin = `http://127.0.0.1:${webPort}`;
const appOrigin = `http://${endpoint}`;
const browserScript = readFileSync(new URL("./browser-actions.js", import.meta.url), "utf8");

export async function exercise(probe, git, chrome, mode = "both") {
  assert(chrome && existsSync(chrome));
  assert(["both", "model"].includes(mode));
  assert.deepEqual(probe.listener(webPort), []);
  assert.deepEqual(probe.listener(16777), []);
  const repo = createRepo(probe, git);
  installObserver(probe);
  const worktrees = mode === "both" ? ["web-first", "web-second"].map(name => dirtyWorktree(probe, repo, name)) : [];
  const local = probe.checked("workspace", "create", "--isolation", "local", "--path", repo.clone, "--title", "web-model");
  const { client, api } = await connect(probe);
  const results = [];
  const server = createServer((request, response) => {
    async function respond() {
      if (request.url === "/probe-observations" && request.method === "GET") {
        response.setHeader("content-type", "application/json");
        response.setHeader("cache-control", "no-store");
        response.end(JSON.stringify(await observations(client)));
        return;
      }
      if (request.url === "/probe-result" && request.method === "POST") {
        const chunks = [];
        for await (const chunk of request) {
          chunks.push(chunk);
          assert(chunks.length <= 10);
        }
        const result = JSON.parse(Buffer.concat(chunks));
        results.push(result);
        print("browser", result);
        response.end();
        return;
      }
      const url = new URL(request.url, appOrigin);
      if (request.method !== "GET" || url.origin !== appOrigin) {
        response.writeHead(400).end();
        return;
      }
      const asset = await fetch(url);
      const contentType = asset.headers.get("content-type") ?? "application/octet-stream";
      response.writeHead(asset.status, {
        "content-type": contentType,
        "content-security-policy": `connect-src 'self' ws://${endpoint} ws://localhost:16775 ${appOrigin}`,
      });
      if (contentType.startsWith("text/html")) {
        const settings = { local: local.workspaceId, worktrees: worktrees.map(row => row.workspace.workspaceId) };
        const source = (await asset.text()).replace(/<\/head>/i,
          () => `<script>globalThis.fixture = ${JSON.stringify(settings)};\n${browserScript}</script></head>`);
        response.end(source);
      } else if (asset.body) {
        Readable.fromWeb(asset.body).pipe(response);
      } else {
        response.end();
      }
    }
    void respond().catch(error => {
      results.push({ error: String(error) });
      response.destroy();
    });
  });
  let child;
  let diagnostics = "";
  try {
    await eventually(() => api.providers.snapshot(), result =>
      result.entries.some(entry => entry.provider === provider && entry.status === "ready"));
    server.listen(webPort, "127.0.0.1");
    await once(server, "listening");
    child = spawn(chrome, ["--headless=new", "--no-first-run", "--no-default-browser-check",
      "--window-size=1440,1000",
      "--disable-background-networking", "--disable-component-update", "--disable-extensions", "--disable-sync",
      "--disable-domain-reliability", "--metrics-recording-only", "--enable-logging=stderr",
      "--host-resolver-rules=MAP localhost 127.0.0.1, MAP * ~NOTFOUND, EXCLUDE 127.0.0.1",
      "--proxy-server=http://127.0.0.1:16777",
      `--user-data-dir=${join(probe.home, "chrome-profile")}`, webOrigin],
    { cwd: probe.home, env: probe.env, stdio: ["ignore", "ignore", "pipe"], windowsHide: true });
    child.stderr.on("data", chunk => { diagnostics = (diagnostics + chunk).slice(-2500); });
    child.on("error", error => { diagnostics += String(error); });
    try {
      await eventually(() => results, rows => rows.some(row => row.finished), 45_000);
    } catch (error) {
      print("browser-diagnostics", diagnostics);
      throw error;
    }
    if (results.some(row => row.archiveAccepted)) {
      await eventually(() => worktrees.map(row => existsSync(row.path)), value => value.every(exists => !exists), 35_000);
      const trace = readFileSync(join(probe.home, "fixture-git.trace"), "utf8").replaceAll("\\", "/");
      print("browser-bulk-results", worktrees.map(row => ({ name: row.workspace.name, before: row.before,
        removed: !existsSync(row.path), force: trace.split(/\r?\n/).some(line => /worktree remove.+--force/i.test(line) &&
          line.includes(row.path.replaceAll("\\", "/"))) })));
    }
    if (results.some(row => row.error)) process.exitCode = 1;
  } finally {
    if (child?.pid && child.exitCode === null) {
      const exit = once(child, "exit");
      child.kill();
      await Promise.race([exit, setTimeout(1500)]);
    }
    server.closeAllConnections();
    server.close();
    await client.close();
  }
}
