import { describe, expect, it } from "vitest";
import { classifyCoordinator, evaluateCoordinatorRecovery, planRecoveryRetry, type SessionObservation } from "../server/watchdog";

const lease = { agent: "old", epoch: 2, checkpoint: "last", acquiredAt: 100, expiresAt: 200 };
const replayed = { agent: "old", epoch: 2, state: "running" as const, observedAt: 205 };
const limits = { observationAge: 30, progressAge: 20, quotaAge: 30 };
const running = { ...replayed, turn: { id: "turn", startedAt: 120, progressedAt: 200 } };
const idle = { ...replayed, state: "idle" as const };
const quota = { state: "available" as const, provider: "fixture", observedAt: 205 };
const reconciliation = { epoch: 2, checkpoint: "last", completedAt: 206 };
const recovery = { lease, observation: idle, quota, reconciliation, now: 210, limits };

describe("coordinator recovery decisions", () => {
  it("distinguishes the underlying turn from the registered session", () => {
    expect(classifyCoordinator(lease, replayed, 210, limits)).toBe("unknown");
    expect(classifyCoordinator(lease, running, 210, limits)).toBe("active");
    expect(classifyCoordinator(lease, { ...running, turn: { ...running.turn, progressedAt: 180 } }, 210, limits)).toBe("obsolete");
    for (const [state, expected] of [["idle", "inactive"], ["interrupted", "interrupted"], ["missing", "obsolete"]] as const) {
      expect(classifyCoordinator(lease, { ...idle, state }, 210, limits)).toBe(expected);
    }
  });

  it("rejects stale, future, contradictory or wrong-epoch observations", () => {
    const observations: SessionObservation[] = [
      { ...idle, epoch: 1 }, { ...idle, observedAt: 179 }, { ...idle, observedAt: 211 },
      { ...idle, turn: running.turn }, { ...running, turn: { ...running.turn, progressedAt: 206 } },
    ];
    for (const observation of observations) expect(classifyCoordinator(lease, observation, 210, limits)).toBe("unknown");
  });

  it("protects a live or unresolved coordinator and unknown effects even after apparent expiry", () => {
    expect(evaluateCoordinatorRecovery({ ...recovery, now: 199 })).toEqual({ status: "wait_lease", until: 200 });
    expect(evaluateCoordinatorRecovery({ ...recovery, observation: running })).toMatchObject({ status: "reconcile", activity: "active" });
    expect(evaluateCoordinatorRecovery({ ...recovery, observation: { ...idle, state: "missing" } }))
      .toMatchObject({ status: "reconcile", activity: "obsolete" });
    expect(evaluateCoordinatorRecovery({ ...recovery, observation: { ...idle, observedAt: 199 } }))
      .toMatchObject({ status: "reconcile", activity: "unknown" });
    for (const proof of [undefined, { ...reconciliation, epoch: 1 }, { ...reconciliation, checkpoint: "older" },
      { ...reconciliation, completedAt: 199 }, { ...reconciliation, completedAt: 211 }]) {
      expect(evaluateCoordinatorRecovery({ ...recovery, reconciliation: proof })).toMatchObject({ status: "reconcile" });
    }
  });

  it("requires fresh quota and proposes the current epoch only after verified recovery", () => {
    for (const snapshot of [undefined, { ...quota, state: "exhausted" as const }, { ...quota, observedAt: 199 }]) {
      expect(evaluateCoordinatorRecovery({ ...recovery, quota: snapshot })).toEqual({ status: "wait_quota" });
    }
    expect(evaluateCoordinatorRecovery(recovery)).toEqual({ status: "propose_takeover", expectedEpoch: 2, provider: "fixture" });
  });

  it("uses bounded backoff and ignores a quota observation that predates the failed check", () => {
    const retryLimits = { maxFailures: 4, initialDelayMs: 4, maxDelayMs: 10 };
    const first = planRecoveryRetry(1, 208, retryLimits);
    expect(evaluateCoordinatorRecovery({ ...recovery, retry: first })).toEqual({ status: "wait_retry", until: 212 });
    expect(evaluateCoordinatorRecovery({ ...recovery, retry: first, now: 213, quota: { ...quota, observedAt: 212 } }))
      .toMatchObject({ status: "reconcile", activity: "unknown" });
    const fresh = {
      ...recovery, retry: first, now: 213,
      observation: { ...idle, observedAt: 212 }, reconciliation: { ...reconciliation, completedAt: 212 },
    };
    expect(evaluateCoordinatorRecovery(fresh)).toEqual({ status: "wait_quota" });
    expect(evaluateCoordinatorRecovery({ ...fresh, quota: { ...quota, observedAt: 212 } }))
      .toMatchObject({ status: "propose_takeover", expectedEpoch: 2 });
    expect(planRecoveryRetry(3, 208, retryLimits)).toMatchObject({ nextCheckAt: 218 });
    expect(evaluateCoordinatorRecovery({ ...recovery, retry: planRecoveryRetry(4, 208, retryLimits) }))
      .toEqual({ status: "retry_exhausted" });
  });
});
