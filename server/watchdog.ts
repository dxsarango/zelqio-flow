type CoordinatorIdentity = { agent: string; epoch: number };

export interface CoordinatorLease extends CoordinatorIdentity {
  checkpoint: string;
  acquiredAt: number;
  expiresAt: number;
}

export interface SessionObservation extends CoordinatorIdentity {
  state: "running" | "idle" | "interrupted" | "missing";
  observedAt: number;
  turn?: { id: string; startedAt: number; progressedAt: number };
}

export type CoordinatorActivity = "active" | "inactive" | "interrupted" | "obsolete" | "unknown";
const time = (value: number) => Number.isSafeInteger(value) && value >= 0;
const fresh = (observedAt: number, now: number, maxAge: number) =>
  time(observedAt) && time(now) && time(maxAge) && observedAt <= now && now - observedAt < maxAge;

/** A registered running session or an obsolete turn alone never establishes that takeover is safe. */
export function classifyCoordinator(
  lease: CoordinatorLease,
  observation: SessionObservation | undefined,
  now: number,
  limits: { observationAge: number; progressAge: number },
): CoordinatorActivity {
  if (!observation || observation.agent !== lease.agent || observation.epoch !== lease.epoch
    || observation.observedAt < lease.acquiredAt || !fresh(observation.observedAt, now, limits.observationAge)) return "unknown";
  if (observation.state !== "running") {
    if (observation.turn) return "unknown";
    if (observation.state === "idle") return "inactive";
    if (observation.state === "interrupted") return "interrupted";
    return "obsolete";
  }
  const { turn } = observation;
  if (!turn?.id.trim() || !time(turn.startedAt) || !time(turn.progressedAt) || turn.progressedAt < turn.startedAt
    || turn.progressedAt > observation.observedAt || !time(limits.progressAge) || limits.progressAge === 0) return "unknown";
  return fresh(turn.progressedAt, now, limits.progressAge) ? "active" : "obsolete";
}

export type RecoveryRetry =
  | { status: "retry"; failures: number; failedAt: number; nextCheckAt: number }
  | { status: "exhausted"; failures: number; failedAt: number };

export function planRecoveryRetry(
  failures: number,
  failedAt: number,
  limits: { maxFailures: number; initialDelayMs: number; maxDelayMs: number },
): RecoveryRetry {
  const { maxFailures, initialDelayMs, maxDelayMs } = limits;
  if (![failures, failedAt, maxFailures, initialDelayMs, maxDelayMs].every(time) || !failures
    || failures >= maxFailures || initialDelayMs < 1 || maxDelayMs < initialDelayMs) {
    return { status: "exhausted", failures, failedAt };
  }
  const delay = Math.min(maxDelayMs, initialDelayMs * 2 ** (failures - 1));
  const nextCheckAt = failedAt + delay;
  return time(nextCheckAt)
    ? { status: "retry", failures, failedAt, nextCheckAt }
    : { status: "exhausted", failures, failedAt };
}

interface RecoveryQuota {
  provider: string;
  state: "available" | "exhausted" | "unknown";
  observedAt: number;
}

export interface RecoveryReconciliation {
  epoch: number;
  checkpoint: string;
  completedAt: number;
}

/**
 * Plans recovery from normalized fixture observations. It starts no session, grants no authority and
 * changes no lease. The effect boundary must reconcile and acquire a fresh epoch atomically.
 */
export function evaluateCoordinatorRecovery(request: {
  lease: CoordinatorLease;
  observation?: SessionObservation;
  quota?: RecoveryQuota;
  retry?: RecoveryRetry;
  reconciliation?: RecoveryReconciliation;
  now: number;
  limits: { observationAge: number; progressAge: number; quotaAge: number };
}) {
  const { lease, observation, quota, retry, reconciliation, now, limits } = request;
  if (!time(now) || !time(lease.epoch) || lease.epoch === 0 || !time(lease.expiresAt) || !time(lease.acquiredAt)
    || lease.expiresAt <= lease.acquiredAt || now < lease.acquiredAt) {
    return { status: "reconcile" } as const;
  }
  if (now < lease.expiresAt) return { status: "wait_lease", until: lease.expiresAt } as const;
  if (retry?.status === "exhausted") return { status: "retry_exhausted" } as const;
  if (retry?.status === "retry" && now < retry.nextCheckAt) return { status: "wait_retry", until: retry.nextCheckAt } as const;
  const activity = observation && observation.observedAt >= lease.expiresAt && (!retry || observation.observedAt > retry.failedAt)
    ? classifyCoordinator(lease, observation, now, limits)
    : "unknown";
  if ((activity !== "inactive" && activity !== "interrupted") || !reconciliation || !observation
    || reconciliation.epoch !== lease.epoch || reconciliation.checkpoint !== lease.checkpoint
    || !time(reconciliation.completedAt) || reconciliation.completedAt < observation.observedAt || reconciliation.completedAt > now) {
    return { status: "reconcile", activity } as const;
  }
  if (!quota?.provider.trim() || quota.state !== "available" || !fresh(quota.observedAt, now, limits.quotaAge)
    || quota.observedAt < lease.expiresAt || (retry && quota.observedAt <= retry.failedAt)) {
    return { status: "wait_quota" } as const;
  }
  return { status: "propose_takeover", expectedEpoch: lease.epoch, provider: quota.provider } as const;
}
