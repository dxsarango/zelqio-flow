import { describe, expect, it } from "vitest";
import { inspectGitPreflight, type GitPreflightSnapshot } from "../server/git-preflight";

const baseRef = "refs/heads/main";
const baseSha = "a".repeat(40);
const headSha = "b".repeat(40);
const target = { repository: "canonical-git", baseRef, baseSha };
const snapshot: GitPreflightSnapshot = {
  repository: target.repository,
  headSha,
  refs: new Map([[baseRef, baseSha]]),
  worktree: "clean",
  operation: "none",
};

describe("Git preflight snapshot", () => {
  it("returns exact base and head as read-only evidence for a clean snapshot", () => {
    expect(inspectGitPreflight(target, snapshot)).toEqual({ status: "snapshot_ready", baseSha, headSha });
  });

  it("requires repository identity and exact fully resolved refs", () => {
    expect(inspectGitPreflight(target, { ...snapshot, repository: null }).status).toBe("repository_unverified");
    expect(inspectGitPreflight(target, { ...snapshot, repository: "other" }).status).toBe("repository_unverified");
    expect(inspectGitPreflight(target, { ...snapshot, refs: new Map() }).status).toBe("base_unverified");
    expect(inspectGitPreflight({ ...target, baseRef: "main" }, { ...snapshot, refs: new Map([["main", baseSha]]) }).status).toBe("base_unverified");
    expect(inspectGitPreflight(target, { ...snapshot, refs: new Map([[baseRef, headSha]]) }).status).toBe("base_changed");
    expect(inspectGitPreflight(target, { ...snapshot, headSha: "abcdef1" }).status).toBe("head_unverified");
    expect(inspectGitPreflight(target, { ...snapshot, headSha: "0".repeat(40) }).status).toBe("head_unverified");
    expect(inspectGitPreflight(target, { ...snapshot, headSha: "b".repeat(64) }).status).toBe("head_unverified");
  });

  it("holds dirty and unknown worktrees and existing or unknown operations", () => {
    for (const worktree of ["dirty", "unknown"] as const) {
      expect(inspectGitPreflight(target, { ...snapshot, worktree }).status).toBe("worktree_not_clear");
    }
    for (const operation of ["in_progress", "unknown"] as const) {
      expect(inspectGitPreflight(target, { ...snapshot, operation }).status).toBe("operation_not_clear");
    }
  });
});
