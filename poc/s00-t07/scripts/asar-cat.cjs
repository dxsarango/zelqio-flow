// Read-only helper (S00-T07): print a file (optionally a line range) from the installed app.asar.
// Usage: ELECTRON_RUN_AS_NODE=1 Paseo.exe asar-cat.cjs <paseo-install> <path-under-app.asar> [from] [to]
const fs = require("fs"), path = require("path");
const [install, rel, from, to] = process.argv.slice(2);
const lines = fs.readFileSync(path.join(install, "resources", "app.asar", rel), "utf8").split("\n");
lines.slice(Number(from || 1) - 1, Number(to || lines.length)).forEach((l, i) => console.log(Number(from || 1) + i + ": " + l));
