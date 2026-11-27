import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { isolate } from "./isolation.mjs";

const [, , root, git] = process.argv;
assert(root && git);
const probe = isolate(root, "run-help-only", git);
const versions = ["0.17.5", "0.17.6"];
const packages = versions.map(version => join(root, `v${version}`, "node_modules", "@getpaseo"));
const declarations = packages.map(path => {
  const dir = join(path, "plugin", "dist");
  const files = readdirSync(dir, { recursive: true }).filter(file => file.endsWith(".d.ts")).sort();
  return Object.fromEntries(files.map(file => [file, readFileSync(join(dir, file), "utf8")]));
});
const files = [...new Set(declarations.flatMap(tree => Object.keys(tree)))].sort();
console.log(JSON.stringify({ declarations: files.length, differences: files.filter(file =>
  declarations[0][file] !== declarations[1][file]),
  clientIndexEqual: readFileSync(join(packages[0], "client", "dist", "index.d.ts"))
    .equals(readFileSync(join(packages[1], "client", "dist", "index.d.ts"))) }));

for (const command of [[], ["agent", "run"], ["agent", "send"], ["workspace", "archive"],
  ["plugin", "install"], ["provider"], ["schedule", "create"], ["heartbeat", "create"]]) {
  const [old, current] = packages.map(path => {
    const cli = join(path, "cli", "bin", "paseo");
    const result = probe.runCommand(process.execPath, [cli, ...command, "--home", probe.home, "--help"]);
    assert.equal(result.code, 0, result.stderr);
    return result.stdout;
  });
  const oldLines = new Set(old.split(/\r?\n/));
  const currentLines = new Set(current.split(/\r?\n/));
  console.log(JSON.stringify({ help: command.join(" ") || "root", equal: old === current,
    removed: [...oldLines].filter(line => !currentLines.has(line)),
    added: [...currentLines].filter(line => !oldLines.has(line)) }));
}

const lock = JSON.parse(readFileSync(join(root, "v0.17.6", "package-lock.json"), "utf8"));
const pinned = ["cli", "client", "plugin", "protocol", "relay", "server"].map(name => {
  const { version, integrity } = lock.packages[`node_modules/@getpaseo/${name}`];
  assert.equal(version, "0.17.6");
  return { name, version, integrity };
});
console.log(JSON.stringify({ pinned }));
