// Validates planning/tasks.json integrity and its consistency with planning/PLAN.md.
// No dependencies. Usage: node tools/check-planning.mjs
import { readFileSync } from "node:fs";

const STATUSES = new Set(["todo", "in_progress", "awaiting_validation", "blocked", "done"]);
const REQUIRED = ["id", "phase", "title", "dependencies", "role", "risk", "acceptance", "status", "evidence", "owner", "branch", "pr", "blockers"];
const errors = [];
const fail = (m) => errors.push(m);

const data = JSON.parse(readFileSync("planning/tasks.json", "utf8"));
const plan = readFileSync("planning/PLAN.md", "utf8");
const tasks = data.tasks ?? [];
const ids = new Set();

for (const t of tasks) {
  for (const k of REQUIRED) if (!(k in t)) fail(`${t.id ?? "?"}: missing field ${k}`);
  if (ids.has(t.id)) fail(`${t.id}: duplicate id`);
  ids.add(t.id);
  if (!STATUSES.has(t.status)) fail(`${t.id}: invalid status ${t.status}`);
  if (!t.acceptance) fail(`${t.id}: empty acceptance`);
}
const byId = new Map(tasks.map((t) => [t.id, t]));
for (const t of tasks) {
  for (const d of t.dependencies ?? []) if (!byId.has(d)) fail(`${t.id}: unknown dependency ${d}`);
  if (t.status === "done") {
    for (const d of t.dependencies ?? []) if (byId.get(d)?.status !== "done") fail(`${t.id}: done but dependency ${d} is not done`);
    if (!(t.evidence ?? []).length) fail(`${t.id}: done without evidence`);
  }
}
// acyclic (Kahn)
const left = new Set(ids);
for (let progressed = true; left.size && progressed; ) {
  progressed = false;
  for (const id of [...left]) {
    if ((byId.get(id).dependencies ?? []).every((d) => !left.has(d))) { left.delete(id); progressed = true; }
  }
}
if (left.size) fail(`dependency cycle among: ${[...left].join(", ")}`);

// PLAN.md rows must match tasks.json ids and dependencies
const rows = new Map();
for (const m of plan.matchAll(/^\| (S\d\d-T\d\d) \|[^|]*\| ([^|]*) \|/gm)) {
  rows.set(m[1], m[2].split(",").map((s) => s.trim()).filter((s) => s && s !== "—"));
}
for (const id of ids) if (!rows.has(id)) fail(`${id}: missing in PLAN.md`);
for (const id of rows.keys()) if (!ids.has(id)) fail(`${id}: in PLAN.md but not in tasks.json`);
for (const [id, deps] of rows) {
  const j = byId.get(id)?.dependencies;
  if (j && [...deps].sort().join() !== [...j].sort().join()) fail(`${id}: dependencies differ between PLAN.md and tasks.json`);
}

if (errors.length) {
  console.error(errors.map((e) => `ERROR ${e}`).join("\n"));
  process.exit(1);
}
console.log(`planning OK: ${tasks.length} tasks, ${rows.size} plan rows`);
