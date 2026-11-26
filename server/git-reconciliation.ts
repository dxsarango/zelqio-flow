import { isFullGitObjectId } from "./git-preflight";

export interface GitReconciliationOperation {
  /** Canonical common repository identity, using the same convention as Git preflight. */
  repository: string;
  targetRef: string;
  previousSha: string;
  expectedSha: string;
}

export interface GitReconciliationSnapshot {
  repository: string | null;
  ref: string | null;
  observation:
    | { status: "unreadable" }
    | { status: "absent" }
    | { status: "present"; sha: string; object: "verified" | "unverified" };
}

type UnknownReason =
  | "repository_unverified"
  | "repository_mismatch"
  | "ref_unverified"
  | "ref_mismatch"
  | "operation_sha_invalid"
  | "identical_operation_shas"
  | "ref_unreadable"
  | "ref_absent"
  | "observed_sha_invalid"
  | "object_unverified";

export type GitReconciliationResult =
  | { status: "applied"; observedSha: string }
  | { status: "no_change_observed"; observedSha: string }
  | { status: "conflict"; observedSha: string }
  | { status: "unknown"; reason: UnknownReason };

/**
 * Classifies a supplied ref observation. The caller supplies the canonical identities,
 * fully qualified ref names and verification of the object named by the observed SHA.
 * A matching ref describes its observed state. It cannot identify the writer or authorize a retry.
 */
export function reconcileGitOperation(
  operation: GitReconciliationOperation,
  snapshot: GitReconciliationSnapshot,
): GitReconciliationResult {
  if (!operation.repository || !snapshot.repository) return { status: "unknown", reason: "repository_unverified" };
  if (snapshot.repository !== operation.repository) return { status: "unknown", reason: "repository_mismatch" };
  if (!operation.targetRef.startsWith("refs/") || operation.targetRef === "refs/" || !snapshot.ref) {
    return { status: "unknown", reason: "ref_unverified" };
  }
  if (snapshot.ref !== operation.targetRef) return { status: "unknown", reason: "ref_mismatch" };

  const { previousSha, expectedSha } = operation;
  if (!isFullGitObjectId(previousSha) || !isFullGitObjectId(expectedSha) || previousSha.length !== expectedSha.length) {
    return { status: "unknown", reason: "operation_sha_invalid" };
  }
  if (previousSha === expectedSha) return { status: "unknown", reason: "identical_operation_shas" };

  const { observation } = snapshot;
  if (observation.status === "unreadable") return { status: "unknown", reason: "ref_unreadable" };
  if (observation.status === "absent") return { status: "unknown", reason: "ref_absent" };

  const { sha: observedSha } = observation;
  if (!isFullGitObjectId(observedSha) || observedSha.length !== expectedSha.length) {
    return { status: "unknown", reason: "observed_sha_invalid" };
  }
  if (observation.object !== "verified") return { status: "unknown", reason: "object_unverified" };
  if (observedSha === expectedSha) return { status: "applied", observedSha };
  if (observedSha === previousSha) return { status: "no_change_observed", observedSha };
  return { status: "conflict", observedSha };
}
