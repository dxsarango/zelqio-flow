import { describe, expect, it } from "vitest";
import {
  reconcileGitOperation,
  type GitReconciliationOperation,
  type GitReconciliationSnapshot,
} from "../server/git-reconciliation";

const operation: GitReconciliationOperation = {
  repository: "canonical-git",
  targetRef: "refs/heads/main",
  previousSha: "a".repeat(40),
  expectedSha: "b".repeat(40),
};

function snapshotAt(sha: string): GitReconciliationSnapshot {
  return {
    repository: operation.repository,
    ref: operation.targetRef,
    observation: { status: "present", sha, object: "verified" },
  };
}

const expectedSnapshot = snapshotAt(operation.expectedSha);

describe("Git operation reconciliation", () => {
  it.each([
    [operation.expectedSha, "applied"],
    [operation.previousSha, "no_change_observed"],
    ["c".repeat(40), "conflict"],
  ])("classifies verified ref SHA %s as %s", (observedSha, status) => {
    expect(reconcileGitOperation(operation, snapshotAt(observedSha))).toEqual({ status, observedSha });
  });

  it("accepts full SHA-256 object IDs", () => {
    const previousSha = "a".repeat(64);
    const expectedSha = "b".repeat(64);
    expect(reconcileGitOperation({ ...operation, previousSha, expectedSha }, snapshotAt(expectedSha)))
      .toEqual({ status: "applied", observedSha: expectedSha });
  });

  it.each<[Partial<GitReconciliationSnapshot>, string]>([
    [{ repository: "other-git" }, "repository_mismatch"],
    [{ repository: null }, "repository_unverified"],
    [{ ref: "refs/heads/other" }, "ref_mismatch"],
    [{ ref: null }, "ref_unverified"],
    [{ observation: { status: "absent" } }, "ref_absent"],
    [{ observation: { status: "unreadable" } }, "ref_unreadable"],
    [{ observation: { status: "present", sha: operation.expectedSha, object: "unverified" } }, "object_unverified"],
    [{ observation: { status: "present", sha: operation.previousSha, object: "unverified" } }, "object_unverified"],
  ])("reports unknown for observation %o", (snapshotPatch, reason) => {
    expect(reconcileGitOperation(operation, { ...expectedSnapshot, ...snapshotPatch }))
      .toEqual({ status: "unknown", reason });
  });

  it("requires a fully qualified target ref even when the snapshot names the same ref", () => {
    const ref = "main";
    expect(reconcileGitOperation({ ...operation, targetRef: ref }, { ...expectedSnapshot, ref }))
      .toEqual({ status: "unknown", reason: "ref_unverified" });
  });

  it.each(["abc123", "g".repeat(40), "0".repeat(40), "a".repeat(39) + "\n", "a".repeat(64)])(
    "rejects malformed or incompatible SHA %j wherever it occurs",
    (sha) => {
      const invalidOperation = { status: "unknown", reason: "operation_sha_invalid" };
      expect(reconcileGitOperation({ ...operation, previousSha: sha }, expectedSnapshot)).toEqual(invalidOperation);
      expect(reconcileGitOperation({ ...operation, expectedSha: sha }, expectedSnapshot)).toEqual(invalidOperation);
      expect(reconcileGitOperation(operation, snapshotAt(sha)))
        .toEqual({ status: "unknown", reason: "observed_sha_invalid" });
    },
  );

  it("leaves identical previous and expected SHAs ambiguous", () => {
    expect(reconcileGitOperation({ ...operation, previousSha: operation.expectedSha }, expectedSnapshot))
      .toEqual({ status: "unknown", reason: "identical_operation_shas" });
  });
});
