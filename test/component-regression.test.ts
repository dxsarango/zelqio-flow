import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ApprovalRequests } from "../server/approval-requests";
import { AttemptJournal } from "../server/attempt-journal";
import { CoordinationJournal } from "../server/coordination-journal";
import { evaluateDeliveryDecision } from "../server/delivery-decision";
import { projectEvidencePreview } from "../server/evidence-preview";
import { projectActivity } from "../server/activity-projection";

const sha = "a".repeat(40);
const movedSha = "b".repeat(40);
const scope = { project: "fixture-repo", task: "S09-T08", action: "pr.merge", target: "pr-1" };
const binding = { id: "review-1", scope, candidateSha: sha, policyRevision: "policy-1" };

describe("pure component regressions: restart, collision, stale data and failures", () => {
  let directory: string;
  let now: number;
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "zelqio-regression-"));
    now = 100;
  });
  afterEach(() => rm(directory, { recursive: true, force: true }));

  const approvals = () => new ApprovalRequests(directory, () => now);
  const attempts = () => new AttemptJournal(directory, () => now);
  const leases = () => new CoordinationJournal(directory, { maxLeaseMs: 60, retryLimits: { maxFailures: 3, initialDelayMs: 10, maxDelayMs: 30 } }, () => now);

  it("keeps every journal's decisions and ambiguity across a restart sharing one state directory", async () => {
    await approvals().create({ ...binding, requesterRef: "worker-1", expiresAt: 500 });
    await approvals().decide({ ...binding, outcome: "approved", approverRef: "reviewer-1", observation: { candidateSha: sha, policyRevision: "policy-1" } });
    await attempts().reserve({ key: "k1", task: "t1", attempt: 1, maxConcurrent: 1 });
    await leases().acquire({ agent: "root", expectedEpoch: 0, checkpoint: "start", durationMs: 20 });

    const reopenedAttempts = attempts();
    expect(await reopenedAttempts.recoverAfterRestart()).toBe(1);
    expect((await reopenedAttempts.read()).entries[0]).toMatchObject({ status: "ambiguous" });
    expect(await reopenedAttempts.reserve({ key: "k2", task: "t2", attempt: 1, maxConcurrent: 1 })).toEqual({ status: "blocked", reason: "no_slot" });
    expect(await approvals().reconcile({ ...binding, candidateSha: sha, policyRevision: "policy-1" })).toMatchObject({ decision: { outcome: "approved" }, closure: null });
    expect((await leases().read()).lease).toMatchObject({ agent: "root", epoch: 1 });
  });

  it("resolves colliding writers once and never lets a stale candidate stay approved", async () => {
    await approvals().create({ ...binding, requesterRef: "worker-1", expiresAt: 500 });
    const approve = { ...binding, outcome: "approved" as const, approverRef: "reviewer-1", observation: { candidateSha: sha, policyRevision: "policy-1" } };
    const results = await Promise.all([
      approvals().decide(approve),
      approvals().decide({ ...approve, approverRef: "reviewer-2" }),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
    const moved = await approvals().reconcile({ ...binding, candidateSha: movedSha, policyRevision: "policy-1" });
    expect(moved?.closure).toMatchObject({ reason: "invalidated" });

    const first = await Promise.all([
      leases().acquire({ agent: "a", expectedEpoch: 0, checkpoint: "c", durationMs: 20 }),
      leases().acquire({ agent: "b", expectedEpoch: 0, checkpoint: "c", durationMs: 20 }),
    ]);
    expect(first.map(result => result.status).sort()).toEqual(["blocked", "recorded"]);
  });

  it("treats stale quota, expired authorization and another SHA's evidence as not ready", () => {
    const hour = 3_600_000;
    const fetched = Date.parse("2026-11-26T12:00:00Z");
    const usage = {
      status: "available" as const,
      reports: [{
        sourceId: "fixture", status: "available" as const, fetchedAt: new Date(fetched).toISOString(),
        windows: [{ id: "session", status: "fresh" as const, remainingPct: 80, resetsAt: null, durationSeconds: null }],
      }],
    };
    expect(projectActivity({ providers: [{ providerId: "fixture" }], maxActivityAgeMs: 1000 }, usage, () => fetched + hour)[0])
      .toMatchObject({ quota: { state: "stale" }, blockers: ["quota_stale"] });

    const deliveryScope = { projectId: "p", taskId: "t", destination: "repo#main", candidateSha: sha, policyRevision: "v1" };
    const decision = evaluateDeliveryDecision({
      mode: "auto_merge", scope: deliveryScope, risk: "low", ownerReviewRequested: false,
      restrictions: { integrationDenied: false, humanApprovalRequired: false, independentReviewRequired: false },
      evidence: { scope: deliveryScope, protections: "verified", checks: "passed", acceptance: "met", integration: "ready", independentReview: "passed", validationEnvironment: "ready" },
      authorization: { scope: deliveryScope, kind: "automatic", expiresAt: 100 }, deferredReview: null,
    }, () => 100);
    expect(decision).toMatchObject({ status: "blocked", reasons: ["authorization_expired"], publicationAllowed: false });

    const projection = projectEvidencePreview({
      candidateSha: movedSha,
      evidence: [{ kind: "ci", command: "ci", result: "PASS", sha, date: "2026-11-26", limitations: [] }],
      preview: [],
      policy: { checks: [{ kind: "ci", command: "ci", required: true }], requireHealthyPreview: false, previewMaxAgeMs: 1000 },
    }, () => Date.parse("2026-11-26T13:00:00Z"));
    expect(projection).toMatchObject({ ready: false, evidence: { ci: [{ status: "stale", hasStaleEvidence: true }] } });
  });

  it("fails closed on a corrupt state file and keeps fixtures free of paths and credentials", async () => {
    await approvals().create({ ...binding, requesterRef: "worker-1", expiresAt: 500 });
    await attempts().reserve({ key: "k1", task: "t1", attempt: 1, maxConcurrent: 1 });
    for (const name of await readdir(directory)) {
      const text = await readFile(join(directory, name), "utf8");
      expect(text, name).not.toContain(directory);
      expect(text, name).not.toMatch(/token|secret|password|sk-/i);
    }

    await writeFile(join(directory, "approval-requests.json"), "{ not json", "utf8");
    await writeFile(join(directory, "approval-requests.json.bak"), "{ not json either", "utf8");
    await expect(approvals().create({ ...binding, id: "review-2", requesterRef: "worker-1", expiresAt: 500 })).rejects.toThrow();
    expect(await attempts().read()).toMatchObject({ entries: [{ key: "k1" }] });
  });
});
