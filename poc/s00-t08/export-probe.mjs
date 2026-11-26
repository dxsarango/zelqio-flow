import assert from "node:assert/strict";

// Disposable privacy probe. Only synthetic records reach this export.
const results = new Set(["PASS", "FAIL", "BLOCKED", "NOT RUN"]);
const privateMarker = "fixture-only-private-marker";
const sha = "a".repeat(40);

function projectEvidence({ check, result, sha }) {
  assert.ok(typeof check === "string" && /^POC-(12|13|14|16)$/.test(check), "Invalid check identifier");
  assert.ok(results.has(result), "Invalid result");
  assert.ok(typeof sha === "string" && /^[a-f0-9]{40}$/.test(sha), "Invalid fixture SHA");
  return { check, result, sha };
}

const record = {
  check: "POC-16",
  result: "BLOCKED",
  sha,
  cwd: `<fixture>/${privateMarker}`,
  notes: { toolOutput: privateMarker },
  messages: [{ text: privateMarker }],
  credential: privateMarker,
};
const report = { version: 1, evidence: [projectEvidence(record)] };
const expected = { version: 1, evidence: [{ check: "POC-16", result: "BLOCKED", sha }] };
assert.deepEqual(report, expected);

const serialized = JSON.stringify(report, null, 2);
assert.ok(!serialized.includes(privateMarker));
assert.throws(() => projectEvidence({ ...record, check: privateMarker }), { message: "Invalid check identifier" });
assert.throws(() => projectEvidence({ ...record, result: privateMarker }), { message: "Invalid result" });
assert.throws(() => projectEvidence({ ...record, sha: privateMarker }), { message: "Invalid fixture SHA" });
console.log(serialized);
