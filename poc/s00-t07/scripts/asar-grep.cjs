// Read-only helper (S00-T07): grep text files inside the installed app's app.asar.
// Usage: ELECTRON_RUN_AS_NODE=1 <paseo-install>\Paseo.exe asar-grep.cjs <paseo-install> <subdir-under-app.asar> <regex> [context]
const fs = require("fs"), path = require("path");
const [install, sub, re, ctxArg] = process.argv.slice(2);
const ctx = Number(ctxArg || 0);
const root = path.join(install, "resources", "app.asar", sub);
const rx = new RegExp(re);
function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) { if (e.name !== "node_modules" || sub.includes("node_modules")) walk(p); }
    else if (/\.(js|mjs|cjs|json)$/.test(e.name)) {
      let lines; try { lines = fs.readFileSync(p, "utf8").split("\n"); } catch { continue; }
      lines.forEach((l, i) => { if (rx.test(l)) { const out = []; for (let k = Math.max(0, i - ctx); k <= Math.min(lines.length - 1, i + ctx); k++) out.push(lines[k].slice(0, 220)); console.log(path.relative(root, p) + ":" + (i + 1) + "\n" + out.join("\n")); } });
    }
  }
}
walk(root);
