import { mkdtemp, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ApprovalRequests } from "../server/approval-requests";

describe("persisted approval requests", () => {
  const binding = {
    id: "review-1",
    scope: { project: "fixture-repo", task: "S07-T09", action: "pr.merge", target: "pr-42" },
    candidateSha: "a".repeat(40),
    policyRevision: "policy-1",
  };
  const request = { ...binding, requesterRef: "worker-1", expiresAt: 120 };
  const observation = { candidateSha: binding.candidateSha, policyRevision: binding.policyRevision };
  const approval = { ...binding, outcome: "approved" as const, approverRef: "reviewer-1", observation };
  let directory: string;
  let now: number;
  let requests: ApprovalRequests;
  const reopen = () => new ApprovalRequests(directory, () => now);

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "zelqio-approvals-"));
    now = 100;
    requests = reopen();
  });
  afterEach(() => rm(directory, { recursive: true, force: true }));

  it("replays identical creates by ID and preserves the original binding across reopen", async () => {
    const created = await requests.create(request);
    expect(created).toEqual({ status: "created", entry: { ...request, createdAt: 100, decision: null, closure: null } });
    now = 105;
    const reopened = reopen();
    for (const conflict of [
      { ...request, scope: { ...binding.scope, target: "pr-43" } },
      { ...request, candidateSha: "b".repeat(40) },
      { ...request, policyRevision: "policy-2" },
      { ...request, requesterRef: "worker-2" },
      { ...request, expiresAt: 130 },
    ]) {
      expect(await reopened.create(conflict)).toEqual({ status: "blocked" });
    }
    expect(await reopened.create(request)).toEqual({ ...created, status: "existing" });
    expect(await reopened.reconcile(binding)).toMatchObject({ decision: null, closure: null });
  });

  it("accepts a decision only for the exact binding from a distinct approver reference", async () => {
    await requests.create(request);
    for (const mismatch of [
      { ...approval, id: "review-2" },
      { ...approval, scope: { ...binding.scope, project: "other-repo" } },
      { ...approval, scope: { ...binding.scope, task: "other-task" } },
      { ...approval, scope: { ...binding.scope, action: "pr.create" } },
      { ...approval, scope: { ...binding.scope, target: "pr-43" } },
      { ...approval, candidateSha: "b".repeat(40) },
      { ...approval, policyRevision: "policy-2" },
      { ...approval, approverRef: request.requesterRef },
      { ...approval, approverRef: "Worker-1" },
    ]) {
      expect(await requests.decide(mismatch)).toBeNull();
    }
    const decided = await requests.decide(approval);
    expect(decided).toMatchObject({ decision: { outcome: "approved", approverRef: "reviewer-1", decidedAt: 100 }, closure: null });
    expect(await reopen().reconcile(binding)).toEqual(decided);
  });

  it.each([
    { candidateSha: "b".repeat(40) },
    { policyRevision: "policy-2" },
  ])("invalidates instead of approving an original binding with a changed observation %j", async change => {
    await requests.create(request);
    const observed = { ...observation, ...change };
    expect(await requests.decide({ ...approval, observation: observed })).toBeNull();
    expect(await reopen().reconcile(binding)).toMatchObject({
      decision: null, closure: { reason: "invalidated", closedAt: 100, observation: observed },
    });
    expect(await reopen().decide(approval)).toBeNull();
  });

  it("persists a rejection and prevents a later approval or recreate from replacing it", async () => {
    await requests.create(request);
    expect(await requests.decide({ ...approval, outcome: "rejected", approverRef: request.requesterRef })).toBeNull();
    const rejected = await requests.decide({ ...approval, outcome: "rejected" });
    expect(rejected).toMatchObject({ decision: { outcome: "rejected", approverRef: "reviewer-1" } });
    const reopened = reopen();
    expect(await reopened.reconcile(binding)).toEqual(rejected);
    expect(await reopened.decide(approval)).toBeNull();
    expect(await reopened.create(request)).toEqual({ status: "existing", entry: rejected });
  });

  it.each([
    { candidateSha: "b".repeat(40) },
    { policyRevision: "policy-2" },
  ])("permanently invalidates an approval when the observation changes to %j", async change => {
    await requests.create(request);
    await requests.decide(approval);
    now = 110;
    expect(await requests.reconcile({ ...binding, ...change, scope: { ...binding.scope, target: "pr-43" } })).toBeNull();
    expect(await requests.reconcile(binding)).toMatchObject({ closure: null });
    const invalidated = await requests.reconcile({ ...binding, ...change });
    expect(invalidated).toMatchObject({
      ...binding,
      decision: { outcome: "approved" },
      closure: { reason: "invalidated", closedAt: 110, observation: { ...observation, ...change } },
    });
    expect(await reopen().reconcile(binding)).toEqual(invalidated);
    expect(await reopen().decide(approval)).toBeNull();
  });

  it.each([
    ["uppercase", binding.candidateSha.toUpperCase()],
    ["abbreviated", binding.candidateSha.slice(0, 7)],
    ["different hash length", "a".repeat(64)],
  ])("durably invalidates an existing approval on an observed %s SHA", async (_, candidateSha) => {
    await requests.create(request);
    await requests.decide(approval);
    const invalidated = await requests.reconcile({ ...binding, candidateSha });
    expect(invalidated).toMatchObject({
      decision: { outcome: "approved" },
      closure: { reason: "invalidated", observation: { candidateSha, policyRevision: binding.policyRevision } },
    });
    expect(await reopen().reconcile(binding)).toEqual(invalidated);
  });

  it("invalidates a pending request before a stale reviewer can settle it", async () => {
    await requests.create(request);
    expect(await requests.reconcile({ ...binding, policyRevision: "policy-2" })).toMatchObject({
      decision: null, closure: { reason: "invalidated" },
    });
    expect(await reopen().decide(approval)).toBeNull();
  });

  it.each([false, true])("persists expiry at the deadline even after a clock rollback (previously approved: %s)", async approved => {
    await requests.create(request);
    now = 119;
    if (approved) expect(await requests.decide(approval)).toMatchObject({ closure: null });
    now = 120;
    expect(await requests.decide(approval)).toBeNull();
    now = 119;
    expect(await reopen().reconcile(binding)).toMatchObject({ closure: { reason: "expired", closedAt: 120 } });
    expect(await reopen().decide(approval)).toBeNull();
  });

  it("records expiry when the SHA changes at the expiry deadline", async () => {
    await requests.create(request);
    now = request.expiresAt;
    const observed = { ...observation, candidateSha: "b".repeat(40) };
    expect(await requests.decide({ ...approval, observation: observed })).toBeNull();
    expect(await reopen().reconcile(binding)).toMatchObject({
      decision: null, closure: { reason: "expired", closedAt: request.expiresAt },
    });
  });

  it("records exactly one concurrent create and one competing decision across instances", async () => {
    const reopened = reopen();
    const creates = await Promise.all([requests.create(request), reopened.create(request)]);
    expect(creates.map(result => result.status).sort()).toEqual(["created", "existing"]);
    const decisions = await Promise.all([
      requests.decide(approval),
      reopened.decide({ ...approval, outcome: "rejected", approverRef: "reviewer-2" }),
    ]);
    const recorded = await reopen().reconcile(binding);
    expect(recorded?.decision).not.toBeNull();
    expect(decisions.filter(result => result !== null)).toEqual([recorded]);
  });

  it("rejects unsafe references, short hashes, invalid time and extra fields", async () => {
    const extraField = { ...request, notes: "unstructured" };
    for (const invalid of [
      extraField,
      { ...request, id: "../review" },
      { ...request, scope: { ...binding.scope, target: "repo/path" } },
      { ...request, requesterRef: "path\\worker" },
      { ...request, policyRevision: "" },
      { ...request, candidateSha: "abcdef1" },
      { ...request, expiresAt: now },
    ]) {
      expect(await requests.create(invalid)).toEqual({ status: "blocked" });
    }
    await requests.create(request);
    expect(await requests.decide({ ...approval, approverRef: "../reviewer" })).toBeNull();
    for (const invalidTime of [NaN, Infinity, 99]) {
      now = invalidTime;
      expect(await requests.decide(approval)).toBeNull();
      expect(await requests.reconcile(binding)).toBeNull();
    }
  });

  it("fails closed if the current file is missing and a backup could resurrect an approval", async () => {
    await requests.create(request);
    await requests.decide(approval);
    await requests.reconcile({ ...binding, policyRevision: "policy-2" });
    await unlink(join(directory, "approval-requests.json"));
    await expect(reopen().reconcile(binding)).rejects.toMatchObject({ code: "disabled" });
  });

  const pending = { ...request, createdAt: 100, decision: null, closure: null };
  it.each([
    { name: "duplicate IDs", entries: [pending, { ...pending, policyRevision: "policy-2" }] },
    {
      name: "a case-variant self-approval",
      entries: [{ ...pending, decision: { outcome: "approved", approverRef: "Worker-1", decidedAt: 100 } }],
    },
    {
      name: "a rejected request with a closure",
      entries: [{
        ...pending,
        decision: { outcome: "rejected", approverRef: "reviewer-1", decidedAt: 100 },
        closure: { reason: "expired", closedAt: 120 },
      }],
    },
  ])("fails closed on a hand-edited snapshot containing $name", async ({ entries }) => {
    await writeFile(join(directory, "approval-requests.json"), JSON.stringify({ schemaVersion: 1, data: { entries } }));
    await expect(reopen().reconcile(binding)).rejects.toMatchObject({ code: "disabled" });
  });
});
