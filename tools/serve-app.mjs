// Dev tool: read-only static server for the web build of an installed Paseo app, pre-connected to ONE
// isolated daemon so a reviewer can open a single link. Loopback only; serves files, never writes.
//   node tools/serve-app.mjs <path-to-app-dist> <port> <daemon-host:port>
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";

const [, , root, port, listen] = process.argv;
if (!root || !port || !listen) {
  console.error("usage: node tools/serve-app.mjs <app-dist> <port> <daemon-host:port>");
  process.exit(2);
}
const base = resolve(root);
const types = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".png": "image/png", ".ico": "image/x-icon", ".ttf": "font/ttf", ".woff2": "font/woff2", ".svg": "image/svg+xml", ".css": "text/css", ".wasm": "application/wasm" };
const seed = `<script>globalThis.__PASEO_INITIAL_DAEMON_CONNECTION__=${JSON.stringify({ listen, useTls: false })};</script>`;

createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  let file = normalize(join(base, decodeURIComponent(url.pathname)));
  if (!file.startsWith(base)) { res.writeHead(403).end(); return; }
  try { if (!(await stat(file)).isFile()) throw new Error("not a file"); }
  catch { file = join(base, "index.html"); } // SPA fallback
  let body = await readFile(file);
  if (file.endsWith("index.html")) body = Buffer.from(body.toString("utf8").replace(/<head[^>]*>/i, (m) => m + seed));
  res.writeHead(200, { "content-type": types[extname(file)] ?? "application/octet-stream" }).end(body);
}).listen(Number(port), "127.0.0.1", () => console.log(`serving ${base} on http://127.0.0.1:${port}/ -> daemon ${listen}`));
