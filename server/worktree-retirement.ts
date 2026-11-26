type Proof = "verified" | "unknown";
type Activity = "clear" | "present" | "unknown";

interface WorktreeScope {
  /** Canonical opaque identities supplied by the Git/workspace readers. */
  repository: string;
  workspace: string;
  worktree: string;
}

interface WorktreeSnapshot extends WorktreeScope {
  kind: "managed" | "primary" | "external" | "unknown";
  ownership: Proof;
  changes: Activity;
  untracked: Activity;
  ignored: Activity;
  operations: Activity;
  activeReferences: Activity;
  pendingValidations: Activity;
  commitsPreserved: Proof;
  nonForceRemoval: Proof;
}

/** Evidence for planning retirement. The eventual adapter must lock and recheck before any removal. */
export function inspectWorktreeRetirement(target: WorktreeScope, snapshot: WorktreeSnapshot) {
  if (!target.repository || !target.workspace || !target.worktree || snapshot.repository !== target.repository ||
      snapshot.workspace !== target.workspace || snapshot.worktree !== target.worktree) {
    return { status: "scope_unverified" } as const;
  }
  if (snapshot.kind !== "managed" || snapshot.ownership !== "verified") return { status: "ownership_unverified" } as const;
  if (snapshot.changes !== "clear" || snapshot.untracked !== "clear" || snapshot.ignored !== "clear") {
    return { status: "content_not_clear" } as const;
  }
  if (snapshot.operations !== "clear" || snapshot.activeReferences !== "clear" || snapshot.pendingValidations !== "clear") {
    return { status: "usage_not_clear" } as const;
  }
  if (snapshot.commitsPreserved !== "verified") return { status: "preservation_unverified" } as const;
  if (snapshot.nonForceRemoval !== "verified") return { status: "removal_unverified" } as const;
  return { status: "retirement_candidate" } as const;
}
