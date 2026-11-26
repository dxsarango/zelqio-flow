import { mkdtemp, rm, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CoordinationJournal } from "../server/coordination-journal";

describe("local coordination lease journal", () => {
  let directory: string;
  let now: number;
  let journal: CoordinationJournal;
  const policy = { maxLeaseMs: 60, retryLimits: { maxFailures: 3, initialDelayMs: 10, maxDelayMs: 30 } };
  const startup = { agent: "root", expectedEpoch: 0, checkpoint: "initial", durationMs: 20 };

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "zelqio-lease-"));
    now = 100;
    journal = new CoordinationJournal(directory, policy, () => now);
  });
  afterEach(() => rm(directory, { recursive: true, force: true }));

  it("persists progress and allows only one successor from the same epoch in this process", async () => {
    expect(await journal.acquire(startup)).toMatchObject({ status: "recorded", lease: { epoch: 1, expiresAt: 120 } });
    now = 110;
    expect(await journal.advance({ agent: "root", epoch: 1, checkpoint: "last", durationMs: 20 })).toMatchObject({ status: "recorded" });
    const reopened = new CoordinationJournal(directory, policy, () => now);
    const evidence = {
      provider: "fixture",
      observation: { agent: "root", epoch: 1, state: "idle" as const, observedAt: 130 },
      quota: { provider: "fixture", state: "available" as const, observedAt: 130 },
      reconciliation: { epoch: 1, checkpoint: "last", completedAt: 130 },
      limits: { observationAge: 30, progressAge: 30, quotaAge: 30 },
    };
    const attempt = { agent: "successor", expectedEpoch: 1, checkpoint: "last", durationMs: 20, recovery: evidence };
    expect(await reopened.acquire(attempt)).toEqual({ status: "blocked" });
    now = 130;
    expect(await reopened.acquire({ ...attempt, checkpoint: "initial" })).toEqual({ status: "blocked" });
    expect(await reopened.acquire({ ...attempt, recovery: undefined })).toEqual({ status: "blocked" });
    expect(await reopened.acquire({ ...attempt, recovery: { ...evidence, provider: "other" } })).toEqual({ status: "blocked" });
    const concurrent = await Promise.all([journal.acquire(attempt), reopened.acquire({ ...attempt, agent: "other" })]);
    expect(concurrent.map(result => result.status).sort()).toEqual(["blocked", "recorded"]);
    expect(await reopened.read()).toMatchObject({ lease: { epoch: 2, checkpoint: "last" }, retry: null });
    now = 131;
    expect(await journal.advance({ agent: "root", epoch: 1, checkpoint: "obsolete", durationMs: 20 })).toEqual({ status: "blocked" });
  });

  it("cannot extend a lease on repeated, retrograde or expired timestamps", async () => {
    for (const at of [NaN, Infinity]) {
      now = at;
      expect(await journal.acquire(startup)).toEqual({ status: "blocked" });
    }
    now = 100;
    await journal.acquire(startup);
    const progress = { agent: "root", epoch: 1, checkpoint: "last", durationMs: 20 };
    for (const at of [100, 99, 120, NaN, Infinity]) {
      now = at;
      expect(await journal.advance(progress)).toEqual({ status: "blocked" });
    }
  });

  it("bounds lease length and keeps the current expiry when recording progress with a shorter interval", async () => {
    expect(await journal.acquire({ ...startup, durationMs: 61 })).toEqual({ status: "blocked" });
    await journal.acquire({ ...startup, durationMs: 50 });
    const changedPolicy = new CoordinationJournal(directory, { ...policy, maxLeaseMs: 600 }, () => now);
    now = 110;
    const progress = { agent: "root", epoch: 1, checkpoint: "progress", durationMs: 20 };
    expect(await changedPolicy.advance({ ...progress, durationMs: 61 })).toEqual({ status: "blocked" });
    expect(await changedPolicy.advance(progress)).toMatchObject({ status: "recorded", lease: { checkpoint: "progress", expiresAt: 150 } });
  });

  it("keeps an older backup from recreating a lost lease epoch", async () => {
    await journal.acquire(startup);
    now = 110;
    await journal.advance({ agent: "root", epoch: 1, checkpoint: "newer", durationMs: 20 });
    await unlink(join(directory, "coordination-lease.json"));
    const reopened = new CoordinationJournal(directory, policy, () => 140);
    await expect(reopened.read()).rejects.toMatchObject({ code: "disabled" });
    await expect(reopened.acquire({ ...startup, agent: "successor" })).rejects.toMatchObject({ code: "disabled" });
  });

  it("recovers an expired epoch after restart without losing backoff or counting a duplicated check", async () => {
    await journal.acquire(startup);
    now = 121;
    const reopened = new CoordinationJournal(directory, { ...policy, retryLimits: { ...policy.retryLimits, initialDelayMs: 1 } }, () => now);
    const failed = { expectedEpoch: 1, previousFailures: 0, evidenceRef: "read-timeout" };
    expect(await reopened.recordRecoveryFailure({ ...failed, evidenceRef: "" })).toBeNull();
    const duplicate = await Promise.all([journal.recordRecoveryFailure(failed), reopened.recordRecoveryFailure(failed)]);
    expect(duplicate.filter(result => result !== null)).toEqual([{ status: "retry", failures: 1, failedAt: 121, nextCheckAt: 131 }]);
    expect((await reopened.read()).retry).toMatchObject({ status: "retry", nextCheckAt: 131, evidenceRef: "read-timeout" });
    const attempt = {
      agent: "successor", expectedEpoch: 1, checkpoint: "initial", durationMs: 20,
      recovery: {
        provider: "fixture", reconciliation: { epoch: 1, checkpoint: "initial", completedAt: 124 },
        observation: { agent: "root", epoch: 1, state: "interrupted" as const, observedAt: 123 },
        quota: { provider: "fixture", state: "available" as const, observedAt: 123 },
        limits: { observationAge: 30, progressAge: 30, quotaAge: 30 },
      },
    };
    now = 125;
    expect(await reopened.acquire(attempt)).toEqual({ status: "blocked" });
    now = 131;
    expect(await reopened.acquire({ ...attempt, recovery: { ...attempt.recovery, quota: { ...attempt.recovery.quota, observedAt: 121 } } }))
      .toEqual({ status: "blocked" });
    expect(await reopened.acquire({ ...attempt, recovery: { ...attempt.recovery, quota: { ...attempt.recovery.quota, observedAt: 131 } } }))
      .toMatchObject({ status: "recorded", lease: { agent: "successor", epoch: 2 } });
    expect((await reopened.read()).retry).toBeNull();
  });

  it("persists an exhausted budget across a restart and keeps automatic acquisition blocked", async () => {
    const shortPolicy = { ...policy, retryLimits: { ...policy.retryLimits, maxFailures: 2 } };
    const initial = new CoordinationJournal(directory, shortPolicy, () => now);
    await initial.acquire(startup);
    now = 121;
    const failure = { expectedEpoch: 1, previousFailures: 0, evidenceRef: "first-check" };
    await initial.recordRecoveryFailure(failure);
    now = 131;
    await initial.recordRecoveryFailure({ ...failure, previousFailures: 1, evidenceRef: "retry-check" });
    const reopened = new CoordinationJournal(directory, policy, () => now);
    expect((await reopened.read()).retry).toMatchObject({ status: "exhausted", failures: 2, evidenceRef: "retry-check" });
    expect(await reopened.acquire({
      ...startup, agent: "successor", expectedEpoch: 1,
      recovery: {
        provider: "fixture",
        observation: { agent: "root", epoch: 1, state: "idle", observedAt: 131 },
        reconciliation: { epoch: 1, checkpoint: "initial", completedAt: 131 },
        quota: { provider: "fixture", state: "available", observedAt: 131 },
        limits: { observationAge: 30, progressAge: 30, quotaAge: 30 },
      },
    })).toEqual({ status: "blocked" });
    expect(await reopened.recordRecoveryFailure({ ...failure, previousFailures: 2 })).toBeNull();
  });
});
