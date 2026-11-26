import { describe, expect, it } from "vitest";
import { inspectWorktreeRetirement } from "../server/worktree-retirement";

const scope = { repository: "repo-1", workspace: "workspace-1", worktree: "tree-1" };
const observed = {
  ...scope,
  kind: "managed",
  ownership: "verified",
  changes: "clear",
  untracked: "clear",
  ignored: "clear",
  operations: "clear",
  activeReferences: "clear",
  pendingValidations: "clear",
  commitsPreserved: "verified",
  nonForceRemoval: "verified",
} as const;

describe("inspectWorktreeRetirement", () => {
  it("requires exact scoped ownership and rejects the primary checkout", () => {
    expect(inspectWorktreeRetirement(scope, observed).status).toBe("retirement_candidate");
    expect(inspectWorktreeRetirement(scope, { ...observed, workspace: "workspace-2" }).status).toBe("scope_unverified");
    expect(inspectWorktreeRetirement(scope, { ...observed, kind: "primary" }).status).toBe("ownership_unverified");
    expect(inspectWorktreeRetirement(scope, { ...observed, ownership: "unknown" }).status).toBe("ownership_unverified");
  });

  it("protects content, operations, references and pending validation, including incomplete observations", () => {
    for (const key of ["changes", "untracked", "ignored", "operations", "activeReferences", "pendingValidations"] as const) {
      for (const value of ["present", "unknown"] as const) {
        expect(inspectWorktreeRetirement(scope, { ...observed, [key]: value }).status).not.toBe("retirement_candidate");
      }
    }
  });

  it("requires durable commit references and a verified non-force operation", () => {
    expect(inspectWorktreeRetirement(scope, { ...observed, commitsPreserved: "unknown" }).status).toBe("preservation_unverified");
    expect(inspectWorktreeRetirement(scope, { ...observed, nonForceRemoval: "unknown" }).status).toBe("removal_unverified");
  });
});
