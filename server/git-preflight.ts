export interface GitPreflightTarget {
  /** Opaque identity derived from the canonical common repository, shared across its worktrees. */
  repository: string;
  baseRef: string;
  baseSha: string;
}

export interface GitPreflightSnapshot {
  repository: string | null;
  headSha: string | null;
  refs: ReadonlyMap<string, string>;
  worktree: "clean" | "dirty" | "unknown";
  operation: "none" | "in_progress" | "unknown";
}

export function isFullGitObjectId(sha: string): boolean {
  return (sha.length === 40 || sha.length === 64) && !/[^0-9a-f]/.test(sha) && /[1-9a-f]/.test(sha);
}

/**
 * Inspects an already-read snapshot without executing Git. A successful check is evidence for planning.
 * An effect still needs its own authorization, lock and fresh ref/worktree checks.
 */
export function inspectGitPreflight(target: GitPreflightTarget, snapshot: GitPreflightSnapshot) {
  if (!target.repository || snapshot.repository !== target.repository) return { status: "repository_unverified" } as const;
  const base = snapshot.refs.get(target.baseRef);
  if (!target.baseRef.startsWith("refs/") || !base || !isFullGitObjectId(base) || !isFullGitObjectId(target.baseSha)) {
    return { status: "base_unverified" } as const;
  }
  if (base !== target.baseSha) return { status: "base_changed" } as const;
  if (!snapshot.headSha || !isFullGitObjectId(snapshot.headSha) || snapshot.headSha.length !== base.length) {
    return { status: "head_unverified" } as const;
  }
  if (snapshot.operation !== "none") return { status: "operation_not_clear" } as const;
  if (snapshot.worktree !== "clean") return { status: "worktree_not_clear" } as const;
  return { status: "snapshot_ready", baseSha: base, headSha: snapshot.headSha } as const;
}
