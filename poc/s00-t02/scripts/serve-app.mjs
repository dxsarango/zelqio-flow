// Disposable POC (S00-T02): read-only static server for the web build of the installed Paseo app,
// so a headless browser can render the real composer against the ISOLATED daemon.
//   node serve-app.mjs <path-to-app-dist> <port>
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";

const [, , root, port] = process.argv;
const base = resolve(root);
const types = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".png": "image/png", ".ico": "image/x-icon", ".ttf": "font/ttf", ".woff2": "font/woff2", ".svg": "image/svg+xml", ".css": "text/css", ".wasm": "application/wasm" };

createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  let file = normalize(join(base, decodeURIComponent(url.pathname)));
  if (!file.startsWith(base)) { res.writeHead(403).end(); return; }
  try { if (!(await stat(file)).isFile()) throw new Error("not a file"); }
  catch { file = join(base, "index.html"); } // SPA fallback
  const body = await readFile(file);
  res.writeHead(200, { "content-type": types[extname(file)] ?? "application/octet-stream" }).end(body);
}).listen(Number(port), "127.0.0.1", () => console.log("serving " + base + " on 127.0.0.1:" + port));
