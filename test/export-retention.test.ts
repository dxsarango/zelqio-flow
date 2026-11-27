import { describe, expect, it } from "vitest";
import { evaluateRetention, exportFixtures } from "../server/export-retention";

const sha = "a".repeat(40);

describe("minimal export from fixtures", () => {
  it("copies only the allowed fields and never leaks locations, notes, messages or credentials", () => {
    const result = exportFixtures([{
      id: "check-1", verdict: "PASS", sha,
      path: "C:\\private\\repo", notes: "free text", message: "chat", token: "sk-secret",
    }]);
    expect(result).toEqual({ version: 1, records: [{ id: "check-1", verdict: "PASS", sha }], rejected: 0 });
    expect(JSON.stringify(result)).not.toMatch(/private|free text|chat|sk-secret/);
  });

  it("rejects invalid values in allowed fields, duplicate ids and non-objects instead of repairing them", () => {
    const result = exportFixtures([
      { id: "C:\\private", verdict: "PASS", sha },
      { id: "a", verdict: "pass", sha },
      { id: "b", verdict: "PASS", sha: "ABC" },
      { id: "c", verdict: "PASS", sha: sha.toUpperCase() },
      { id: "ok", verdict: "FAIL", sha },
      { id: "ok", verdict: "PASS", sha },
      null,
      "text",
    ]);
    expect(result.records).toEqual([{ id: "ok", verdict: "FAIL", sha }]);
    expect(result.rejected).toBe(7);
  });
});

describe("simulated retention", () => {
  const now = 1_000;
  const base = { now, maxAgeMs: { log: 100, approval: 500 }, activeRefs: [] as string[] };
  const decide = (input: Parameters<typeof evaluateRetention>[0]) => {
    const result = evaluateRetention(input);
    if (result.status !== "evaluated") throw new Error(result.reason);
    return Object.fromEntries(result.decisions.map(item => [item.id, item.decision]));
  };

  it("marks only old records of a known kind as eligible", () => {
    expect(decide({
      ...base,
      records: [
        { id: "old", kind: "log", createdAt: 100, refs: [] },
        { id: "recent", kind: "log", createdAt: 950, refs: [] },
        { id: "boundary", kind: "log", createdAt: 900, refs: [] },
        { id: "mystery", kind: "other", createdAt: 1, refs: [] },
        { id: "future", kind: "log", createdAt: 5_000, refs: [] },
      ],
    })).toEqual({ old: "eligible", recent: "keep_recent", boundary: "eligible", mystery: "keep_unknown_kind", future: "keep_future" });
  });

  it("protects records reached by an active reference, directly or through other records, even in cycles", () => {
    expect(decide({
      ...base,
      activeRefs: ["approval-1", "missing"],
      records: [
        { id: "approval-1", kind: "approval", createdAt: 1, refs: ["log-a"] },
        { id: "log-a", kind: "log", createdAt: 1, refs: ["log-b"] },
        { id: "log-b", kind: "log", createdAt: 1, refs: ["log-a"] },
        { id: "unrelated", kind: "log", createdAt: 1, refs: [] },
      ],
    })).toEqual({ "approval-1": "keep_referenced", "log-a": "keep_referenced", "log-b": "keep_referenced", unrelated: "eligible" });
  });

  it("blocks invalid input and duplicate ids instead of guessing", () => {
    expect(evaluateRetention({ ...base, records: [{ id: "a", kind: "log", createdAt: 1 }, { id: "a", kind: "log", createdAt: 2 }] }))
      .toEqual({ status: "blocked", reason: "duplicate_id" });
    expect(evaluateRetention({ ...base, now: -1, records: [] })).toEqual({ status: "blocked", reason: "invalid" });
    expect(evaluateRetention({ ...base, maxAgeMs: { log: 0 }, records: [] })).toEqual({ status: "blocked", reason: "invalid" });
  });

  it("does not delete or mutate its input", () => {
    const records = [{ id: "old", kind: "log", createdAt: 1, refs: [] as string[] }];
    const snapshot = JSON.stringify(records);
    evaluateRetention({ ...base, records });
    expect(JSON.stringify(records)).toBe(snapshot);
  });
});
