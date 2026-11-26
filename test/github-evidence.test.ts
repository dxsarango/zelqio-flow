import { describe, expect, it } from "vitest";
import { inspectGitHubEvidence } from "../server/github-evidence";

const rule = { name: "check (macos-latest)", appId: 15368 };
const headSha = "a".repeat(40);
const target = { repository: "owner/repo", baseRef: "refs/heads/main", headSha, required: [rule] };
const run = { ...rule, headSha, status: "completed" as const, conclusion: "success" };
const snapshot = {
  ...target,
  complete: true,
  protections: { strict: true, enforceAdmins: true, linearHistory: true, bypassAllowed: false },
  runs: [run],
};

describe("inspectGitHubEvidence", () => {
  it("requires successful checks from the verified app on the exact candidate, including additional effective rules", () => {
    expect(inspectGitHubEvidence(target, snapshot).status).toBe("checks_verified");
    expect(inspectGitHubEvidence(target, { ...snapshot, runs: [{ ...run, headSha: "b".repeat(40) }, { ...run, appId: 1 }] }))
      .toMatchObject({ status: "checks_blocked", checks: [{ status: "missing" }] });
    expect(inspectGitHubEvidence(target, { ...snapshot, required: [rule, { ...rule, name: "planning-integrity" }] }))
      .toMatchObject({ status: "checks_blocked", checks: [{ status: "passed" }, { status: "missing" }] });
  });

  it("blocks pending, failed, skipped and ambiguous runs", () => {
    for (const runs of [[{ ...run, status: "in_progress" as const }], [{ ...run, conclusion: "failure" }],
      [{ ...run, conclusion: "skipped" }], [run, run]]) {
      expect(inspectGitHubEvidence(target, { ...snapshot, runs }).status).toBe("checks_blocked");
    }
  });

  it("fails closed when scope, rules or protections cannot be established", () => {
    expect(inspectGitHubEvidence(target, { ...snapshot, repository: "other/repo" }).status).toBe("target_unverified");
    expect(inspectGitHubEvidence(target, { ...snapshot, baseRef: "refs/heads/topic" }).status).toBe("target_unverified");
    expect(inspectGitHubEvidence(target, { ...snapshot, complete: false }).status).toBe("protection_unverified");
    expect(inspectGitHubEvidence(target, { ...snapshot, protections: { ...snapshot.protections, bypassAllowed: true } }).status)
      .toBe("protection_unverified");
    expect(inspectGitHubEvidence(target, { ...snapshot, required: [{ ...rule, appId: 1 }] }).status).toBe("requirements_unverified");
  });
});
