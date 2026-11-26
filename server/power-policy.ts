type Activity = "active" | "idle" | "unknown";

interface PowerSnapshot {
  project: string;
  execution: string;
  now: number;
  executionState: "working" | "recoverable" | "finished" | "blocked" | "unknown";
  holdActive: boolean;
  holdEnabled: boolean;
  temporaryHoldSupported: boolean;
  suspendSupported: boolean;
  protectedActivity: { projects: Activity; agents: Activity; userProcesses: Activity };
}

interface SuspendAuthorization {
  project: string;
  execution: string;
  cancelled: boolean;
  expiresAt: number;
}

/** Plans one step from an immutable fixture. An adapter must verify authority and refresh the snapshot at each effect. */
export function evaluatePowerPolicy(snapshot: PowerSnapshot, authorization?: SuspendAuthorization) {
  const scoped = Boolean(snapshot.project && snapshot.execution && Number.isFinite(snapshot.now));
  const progressing = snapshot.executionState === "working" || snapshot.executionState === "recoverable";
  if (scoped && progressing && snapshot.holdEnabled === true && snapshot.temporaryHoldSupported === true) {
    if (snapshot.holdActive === false) return { action: "acquire_hold", display: "unchanged" } as const;
    return { action: "none" } as const;
  }
  if (snapshot.holdActive === true) return { action: "release_hold" } as const;
  if (scoped && snapshot.executionState === "finished" && snapshot.holdActive === false && snapshot.suspendSupported === true &&
      authorization?.project === snapshot.project && authorization.execution === snapshot.execution &&
      authorization.cancelled === false && Number.isFinite(authorization.expiresAt) && snapshot.now < authorization.expiresAt &&
      snapshot.protectedActivity.projects === "idle" && snapshot.protectedActivity.agents === "idle" &&
      snapshot.protectedActivity.userProcesses === "idle") {
    return { action: "suspend_candidate" } as const;
  }
  return { action: "none" } as const;
}
