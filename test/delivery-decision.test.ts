import { describe, expect, it } from "vitest";
import type { DeliveryDecisionInput } from "../shared/delivery-decision";
import { MODES } from "../shared/settings";
import { evaluateDeliveryDecision } from "../server/delivery-decision";

const now = 100;
const scope = {
  projectId: "project",
  taskId: "task",
  destination: "repo#main",
  candidateSha: "a".repeat(40),
  policyRevision: "v1",
};
const restrictions = {
  integrationDenied: false,
  humanApprovalRequired: false,
  independentReviewRequired: false,
};
const evidence = {
  scope,
  protections: "verified",
  checks: "passed",
  acceptance: "met",
  integration: "ready",
  independentReview: "passed",
  validationEnvironment: "ready",
} as const;
const authorization = { scope, kind: "automatic", expiresAt: now + 20 } as const;
const humanApproval = { ...authorization, kind: "human" } as const;
const deferredReview = { scope, state: "active", expiresAt: now + 10 } as const;

function decide(overrides: Partial<DeliveryDecisionInput> = {}, at = now) {
  return evaluateDeliveryDecision({
    mode: "smart_review",
    scope,
    risk: "low",
    ownerReviewRequested: false,
    restrictions,
    evidence,
    authorization,
    deferredReview: null,
    ...overrides,
  }, () => at);
}

describe("delivery modes", () => {
  it("waits for an exact human approval in Review First", () => {
    expect(decide({ mode: "review_first" })).toMatchObject({
      status: "blocked", next: "human_review", reasons: ["human_approval_required"],
    });
    expect(decide({ mode: "review_first", authorization: humanApproval })).toMatchObject({
      status: "allowed", next: "integrate", review: "approved", publicationAllowed: false,
    });
  });

  it.each(["smart_review", "auto_merge", "autopilot"] as const)("permits authorized low-risk integration in %s", (mode) => {
    expect(decide({ mode })).toMatchObject({
      mode, scope, restrictions, status: "allowed", review: "not_required",
      validUntil: authorization.expiresAt, reasons: ["automatic_integration_authorized"], publicationAllowed: false,
    });
    expect(decide({ mode, authorization: null })).toMatchObject({ status: "blocked", reasons: ["authorization_required"] });
  });

  it.each(["auto_merge", "autopilot"] as const)("does not impose Smart Review's experience gate in %s", (mode) => {
    expect(decide({ mode, risk: "reversible_experience" })).toMatchObject({ status: "allowed", review: "not_required" });
  });

  it.each(MODES)("enforces policy, sensitive changes and owner review in %s", (mode) => {
    const restricted = { ...restrictions, humanApprovalRequired: true };
    expect(decide({ mode, restrictions: restricted })).toMatchObject({
      restrictions: restricted, status: "blocked", next: "human_review",
    });
    expect(decide({ mode, risk: "sensitive" })).toMatchObject({ status: "blocked", next: "human_review" });
    expect(decide({ mode, ownerReviewRequested: true })).toMatchObject({ status: "blocked", next: "human_review" });
    expect(decide({ mode, authorization: humanApproval, restrictions: { ...restrictions, integrationDenied: true } }))
      .toMatchObject({ status: "blocked", reasons: ["integration_denied"] });
  });
});

describe("required evidence", () => {
  it.each(MODES)("blocks missing, unknown and incomplete checks or protections in %s even with approval", (mode) => {
    for (const protections of ["missing", "unknown"] as const) {
      expect(decide({ mode, evidence: { ...evidence, protections }, authorization: humanApproval }))
        .toMatchObject({ status: "blocked", next: "none", reasons: ["protections_unverified"] });
    }
    for (const checks of ["unknown", "missing", "pending", "failed"] as const) {
      expect(decide({ mode, evidence: { ...evidence, checks }, authorization: humanApproval }))
        .toMatchObject({ status: "blocked", next: "none", reasons: ["checks_unverified"] });
    }
  });

  it("reports multiple independent blockers and rejects evidence for a different candidate", () => {
    expect(decide({
      risk: "unknown",
      restrictions: { ...restrictions, independentReviewRequired: true },
      evidence: {
        ...evidence, scope: { ...scope, candidateSha: "b".repeat(40) }, integration: "conflicted",
        independentReview: "missing", acceptance: "unmet", validationEnvironment: "unknown",
      },
    })).toMatchObject({
      status: "blocked",
      reasons: [
        "unknown_risk", "evidence_scope_mismatch", "acceptance_unverified", "integration_unverified",
        "independent_review_required", "validation_environment_required",
      ],
    });
  });
});

describe("deferred Smart Review", () => {
  const reversible = { risk: "reversible_experience" } as const;

  it("waits without a window and keeps an authorized deferred review pending", () => {
    expect(decide(reversible)).toMatchObject({
      status: "blocked", next: "human_review", reasons: ["human_approval_required", "deferred_review_required"],
    });
    expect(decide({ ...reversible, deferredReview })).toMatchObject({
      status: "allowed", review: "deferred", validUntil: deferredReview.expiresAt, publicationAllowed: false,
    });
    expect(decide({ ...reversible, deferredReview, authorization: { ...authorization, expiresAt: now + 1 } }))
      .toMatchObject({ status: "allowed", review: "deferred", validUntil: now + 1 });
  });

  it("ends at expiry or on owner return", () => {
    expect(decide({ ...reversible, deferredReview }, deferredReview.expiresAt - 1)).toMatchObject({ status: "allowed" });
    expect(decide({ ...reversible, deferredReview }, deferredReview.expiresAt)).toMatchObject({
      status: "blocked", next: "human_review", reasons: ["human_approval_required", "deferred_review_expired"],
    });
    expect(decide({ ...reversible, deferredReview: { ...deferredReview, state: "ended" } })).toMatchObject({
      status: "blocked", next: "human_review", reasons: ["human_approval_required", "deferred_review_ended"],
    });
  });

  it("requires independent review and valid evidence, and preserves mandatory approval and integration authorization", () => {
    const input = { ...reversible, deferredReview };
    expect(decide({ ...input, evidence: { ...evidence, independentReview: "missing" } })).toMatchObject({
      status: "blocked", reasons: ["human_approval_required", "independent_review_required"],
    });
    expect(decide({ ...input, evidence: { ...evidence, checks: "missing", protections: "unknown" } })).toMatchObject({
      status: "blocked", reasons: ["protections_unverified", "checks_unverified"],
    });
    expect(decide({ ...input, restrictions: { ...restrictions, humanApprovalRequired: true } })).toMatchObject({
      status: "blocked", reasons: ["human_approval_required"],
    });
    expect(decide({ ...input, authorization: null })).toMatchObject({
      status: "blocked", reasons: ["human_approval_required", "authorization_required"], publicationAllowed: false,
    });
  });
});

describe("scope, expiry and input validation", () => {
  it.each([authorization, humanApproval])("expires $kind authorization at the boundary", (grant) => {
    expect(decide({ authorization: grant }, grant.expiresAt - 1)).toMatchObject({ status: "allowed" });
    expect(decide({ authorization: grant }, grant.expiresAt))
      .toMatchObject({ status: "blocked", reasons: ["authorization_expired"] });
  });

  it.each([
    { candidateSha: "b".repeat(40) }, { policyRevision: "V1" }, { destination: "other#main" },
    { projectId: "other-project" }, { taskId: "other-task" },
  ])("binds authorization and deferral to the exact scope (%j)", (change) => {
    const mismatchedScope = { ...scope, ...change };
    expect(decide({ authorization: { ...humanApproval, scope: mismatchedScope } })).toMatchObject({
      status: "blocked", reasons: ["authorization_scope_mismatch"],
    });
    expect(decide({ risk: "reversible_experience", deferredReview: { ...deferredReview, scope: mismatchedScope } })).toMatchObject({
      status: "blocked", reasons: ["human_approval_required", "deferred_review_scope_mismatch"],
    });
  });

  it.each(["A".repeat(40), "a".repeat(39), "a".repeat(39) + "\n", "g".repeat(40), "0".repeat(40)])("rejects invalid SHA %j", (candidateSha) => {
    const invalidScope = { ...scope, candidateSha };
    expect(decide({ scope: invalidScope })).toMatchObject({ status: "blocked", reasons: ["invalid_input"] });
    expect(decide({ authorization: { ...authorization, scope: invalidScope } })).toMatchObject({
      status: "blocked", reasons: ["invalid_input"],
    });
    expect(decide({ deferredReview: { ...deferredReview, scope: invalidScope } })).toMatchObject({
      status: "blocked", reasons: ["invalid_input"],
    });
  });

  it("accepts exact full lowercase SHA-256 IDs", () => {
    const longScope = { ...scope, candidateSha: "a".repeat(64) };
    expect(decide({ scope: longScope, evidence: { ...evidence, scope: longScope }, authorization: { ...authorization, scope: longScope } }))
      .toMatchObject({ status: "allowed" });
  });

  it("rejects extraneous permission fields, missing evidence fields and invalid clock readings", () => {
    const extra = { ...authorization, publicationAllowed: true };
    expect(decide({ authorization: extra })).toMatchObject({ status: "blocked", reasons: ["invalid_input"] });
    expect(decide({ evidence: { ...evidence, checks: undefined } as never })).toMatchObject({
      status: "blocked", reasons: ["invalid_input"],
    });
    expect(decide({}, NaN)).toMatchObject({ status: "blocked", reasons: ["invalid_clock"] });
  });
});
