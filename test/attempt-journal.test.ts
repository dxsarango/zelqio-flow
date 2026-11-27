import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AttemptJournal, attemptJournalState } from "../server/attempt-journal";

describe("local attempt reservation journal", () => {
  let directory: string;
  let journal: AttemptJournal;
  const reserve = (key: string, task = "t1", attempt = 1, maxConcurrent = 2) => journal.reserve({ key, task, attempt, maxConcurrent });

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "zelqio-attempts-"));
    journal = new AttemptJournal(directory, () => 100);
  });
  afterEach(() => rm(directory, { recursive: true, force: true }));

  it("makes reservations idempotent and rejects a reused key for another attempt", async () => {
    expect(await reserve("k1")).toMatchObject({ status: "reserved" });
    expect(await reserve("k1")).toMatchObject({ status: "existing" });
    expect(await reserve("k1", "t1", 2)).toEqual({ status: "blocked", reason: "key_conflict" });
    expect((await journal.read()).entries).toHaveLength(1);
  });

  it("enforces slots, one active attempt per task and attempt order, even for concurrent callers", async () => {
    const results = await Promise.all([reserve("a", "t1", 1, 1), reserve("b", "t2", 1, 1)]);
    expect(results.map(result => result.status).sort()).toEqual(["blocked", "reserved"]);
    expect(await reserve("c", "t1", 2, 5)).toEqual({ status: "blocked", reason: "task_active" });
    expect(await reserve("d", "t3", 2, 5)).toEqual({ status: "blocked", reason: "attempt_order" });
    expect(await reserve("e", "t3", 1, 0)).toEqual({ status: "blocked", reason: "invalid" });
  });

  it("keeps unsettled attempts ambiguous after restart and holds their slot until explicit evidence", async () => {
    await reserve("k1", "t1");
    await reserve("k2", "t2");
    await journal.confirmLaunch({ key: "k2", agentRef: "agent-2" });
    const reopened = new AttemptJournal(directory, () => 200);
    expect(await reopened.recoverAfterRestart()).toBe(2);
    expect(await reopened.recoverAfterRestart()).toBe(0);
    expect(await reopened.reserve({ key: "k3", task: "t3", attempt: 1, maxConcurrent: 2 })).toEqual({ status: "blocked", reason: "no_slot" });
    expect(await reopened.confirmLaunch({ key: "k1", agentRef: "x" })).toEqual({ status: "blocked" });
    expect(await reopened.settle({ key: "k2", outcome: "succeeded", evidenceRef: "ev" })).toEqual({ status: "blocked" });
    expect(await reopened.resolveAmbiguous({ key: "k1", outcome: "not_launched", evidenceRef: "host-list-1" })).toMatchObject({ status: "recorded" });
    expect(await reopened.reserve({ key: "k3", task: "t3", attempt: 1, maxConcurrent: 2 })).toMatchObject({ status: "reserved" });
    expect(await reopened.reserve({ key: "k4", task: "t1", attempt: 2, maxConcurrent: 3 })).toMatchObject({ status: "reserved" });
  });

  it("settles only running attempts with a safe evidence reference", async () => {
    await reserve("k1");
    expect(await journal.settle({ key: "k1", outcome: "failed", evidenceRef: "ev" })).toEqual({ status: "blocked" });
    await journal.confirmLaunch({ key: "k1", agentRef: "agent-1" });
    expect(await journal.settle({ key: "k1", outcome: "failed", evidenceRef: "C:\\private path" })).toEqual({ status: "blocked" });
    expect(await journal.settle({ key: "k1", outcome: "failed", evidenceRef: "ev" })).toMatchObject({ status: "recorded" });
    expect(await journal.settle({ key: "k1", outcome: "succeeded", evidenceRef: "ev2" })).toEqual({ status: "blocked" });
    expect(await reserve("k2", "t1", 2)).toMatchObject({ status: "reserved" });
  });

  it("blocks a reopened journal from confirming or settling a prior attempt before recovery", async () => {
    await reserve("k1");
    await reserve("k2", "t2");
    await journal.confirmLaunch({ key: "k2", agentRef: "agent-2" });
    const reopened = new AttemptJournal(directory, () => 200);
    expect(await reopened.settle({ key: "k2", outcome: "failed", evidenceRef: "ev" })).toEqual({ status: "blocked" });
    expect(await reopened.confirmLaunch({ key: "k1", agentRef: "agent-1" })).toEqual({ status: "blocked" });
    expect(await reopened.reserve({ key: "k3", task: "t3", attempt: 1, maxConcurrent: 2 })).toEqual({ status: "blocked", reason: "no_slot" });
    expect(await reopened.recoverAfterRestart()).toBe(2);
    expect((await reopened.read()).entries.map(item => item.status)).toEqual(["ambiguous", "ambiguous"]);
  });

  it("never frees the slot of an attempt with a confirmed agent as not_launched", async () => {
    await reserve("k1");
    await journal.confirmLaunch({ key: "k1", agentRef: "agent-1" });
    const reopened = new AttemptJournal(directory, () => 200);
    await reopened.recoverAfterRestart();
    expect(await reopened.resolveAmbiguous({ key: "k1", outcome: "not_launched", evidenceRef: "ev" })).toEqual({ status: "blocked" });
    expect(await reopened.reserve({ key: "k2", task: "t1", attempt: 2, maxConcurrent: 5 })).toEqual({ status: "blocked", reason: "task_active" });
    expect(await reopened.resolveAmbiguous({ key: "k1", outcome: "failed", evidenceRef: "host-list-2" })).toMatchObject({ status: "recorded" });
    expect(await reopened.reserve({ key: "k2", task: "t1", attempt: 2, maxConcurrent: 5 })).toMatchObject({ status: "reserved" });
  });

  it("rejects not_launched when settling a running attempt even for untyped callers", async () => {
    await reserve("k1");
    await journal.confirmLaunch({ key: "k1", agentRef: "agent-1" });
    expect(await journal.settle({ key: "k1", outcome: "not_launched" as never, evidenceRef: "ev" })).toEqual({ status: "blocked" });
    expect((await journal.read()).entries[0].status).toBe("running");
  });

  it("rejects persisted snapshots with duplicate keys, several live attempts per task or attempt gaps", () => {
    const live = (key: string, task: string, attempt: number) => ({ status: "reserved", key, task, attempt, reservedAt: 1, session: "s" });
    const done = (key: string, task: string, attempt: number) => ({ status: "settled", key, task, attempt, reservedAt: 1, outcome: "failed", evidenceRef: "ev" });
    expect(attemptJournalState.safeParse({ entries: [done("a", "t", 1), live("b", "t", 2)] }).success).toBe(true);
    expect(attemptJournalState.safeParse({ entries: [live("a", "t", 1), live("a", "u", 1)] }).success).toBe(false);
    expect(attemptJournalState.safeParse({ entries: [live("a", "t", 1), live("b", "t", 2)] }).success).toBe(false);
    expect(attemptJournalState.safeParse({ entries: [done("a", "t", 1), live("b", "t", 3)] }).success).toBe(false);
    expect(attemptJournalState.safeParse({ entries: [done("a", "t", 1), done("b", "t", 1)] }).success).toBe(false);
  });
});
