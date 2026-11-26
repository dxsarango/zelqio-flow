import { isFullGitObjectId } from "./git-preflight";

interface RequiredCheck {
  name: string;
  appId: number;
}

interface CheckRun extends RequiredCheck {
  headSha: string;
  status: "queued" | "in_progress" | "completed";
  conclusion: string | null;
}

interface GitHubEvidence {
  repository: string;
  baseRef: string;
  headSha: string;
  /** A trusted reader must establish complete, effective rules and check-run coverage. */
  complete: boolean;
  protections: { strict: boolean; enforceAdmins: boolean; linearHistory: boolean; bypassAllowed: boolean };
  required: readonly RequiredCheck[];
  runs: readonly CheckRun[];
}

/** Evaluates GitHub snapshots. The result is evidence and carries no authority to merge. */
export function inspectGitHubEvidence(
  target: Pick<GitHubEvidence, "repository" | "baseRef" | "headSha" | "required">,
  snapshot: GitHubEvidence,
) {
  if (!target.repository || !target.baseRef.startsWith("refs/heads/") || !isFullGitObjectId(target.headSha) ||
      snapshot.repository !== target.repository || snapshot.baseRef !== target.baseRef || snapshot.headSha !== target.headSha) {
    return { status: "target_unverified" } as const;
  }

  const { strict, enforceAdmins, linearHistory, bypassAllowed } = snapshot.protections;
  if (snapshot.complete !== true || strict !== true || enforceAdmins !== true || linearHistory !== true || bypassAllowed !== false) {
    return { status: "protection_unverified" } as const;
  }

  const matches = (left: RequiredCheck, right: RequiredCheck) => left.name === right.name && left.appId === right.appId;
  if (!target.required.length || !snapshot.required.length ||
      [...target.required, ...snapshot.required].some(check => !check.name.trim() || !Number.isSafeInteger(check.appId) || check.appId <= 0) ||
      target.required.some(check => snapshot.required.filter(rule => matches(check, rule)).length !== 1)) {
    return { status: "requirements_unverified" } as const;
  }

  const checks = snapshot.required.map(rule => {
    const runs = snapshot.runs.filter(run => run.headSha === target.headSha && matches(rule, run));
    const [run] = runs;
    const duplicate = snapshot.required.filter(other => other.name === rule.name).length !== 1;
    const status = duplicate || runs.length > 1 ? "ambiguous" : !run ? "missing" :
      run.status !== "completed" ? "pending" : run.conclusion === "success" ? "passed" : "failed";
    return { ...rule, status };
  });

  return { status: checks.every(check => check.status === "passed") ? "checks_verified" : "checks_blocked", checks } as const;
}
