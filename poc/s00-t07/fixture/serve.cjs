// Fixture preview server: reports the exact git SHA it was started from, health on /health.
const http = require("http"), cp = require("child_process");
const sha = cp.execFileSync("git", ["rev-parse", "HEAD"]).toString().trim();
const port = Number(process.env.PORT || process.argv[2] || 16781);
const srv = http.createServer((q, r) => {
  if (q.url === "/health") { r.setHeader("content-type", "application/json"); r.end(JSON.stringify({ ok: true, sha, cwd: process.cwd().split(/[\/]/).pop(), port })); return; }
  r.end("preview sha=" + sha + "\n");
});
srv.listen(port, "127.0.0.1", () => console.log("listening", port, "sha", sha));
process.on("SIGTERM", () => { console.log("SIGTERM"); srv.close(() => process.exit(0)); });
