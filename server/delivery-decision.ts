import {
  deliveryDecisionInput,
  deliveryTimestamp,
  type DeliveryDecision,
  type DeliveryDecisionInput,
  type DeliveryReason,
} from "../shared/delivery-decision";

type Scope = DeliveryDecisionInput["scope"];

function sameScope(left: Scope, right: Scope): boolean {
  return left.projectId === right.projectId && left.taskId === right.taskId &&
    left.destination === right.destination && left.candidateSha === right.candidateSha &&
    left.policyRevision === right.policyRevision;
}

/** Simulates a delivery decision from supplied evidence. The caller supplies the clock and all attestations. */
export function evaluateDeliveryDecision(input: unknown, clock: () => number): DeliveryDecision {
  const parsed = deliveryDecisionInput.safeParse(input);
  if (!parsed.success) {
    return { status: "blocked", next: "none", reasons: ["invalid_input"], publicationAllowed: false };
  }

  const { mode, scope, risk, restrictions, evidence, ownerReviewRequested, authorization, deferredReview } = parsed.data;
  const context = { mode, scope, restrictions, publicationAllowed: false } as const;
  const blocked = (reason: DeliveryReason, ...additional: DeliveryReason[]): DeliveryDecision => ({
    ...context, status: "blocked", next: "none", reasons: [reason, ...additional],
  });
  const waitForReview = (...additional: DeliveryReason[]): DeliveryDecision => ({
    ...context, status: "blocked", next: "human_review", reasons: ["human_approval_required", ...additional],
  });

  const time = deliveryTimestamp.safeParse(clock());
  if (!time.success) return blocked("invalid_clock");
  const now = time.data;

  const blockers: DeliveryReason[] = [];
  if (restrictions.integrationDenied) blockers.push("integration_denied");
  if (risk === "unknown") blockers.push("unknown_risk");
  if (!sameScope(scope, evidence.scope)) blockers.push("evidence_scope_mismatch");
  if (evidence.protections !== "verified") blockers.push("protections_unverified");
  if (evidence.checks !== "passed") blockers.push("checks_unverified");
  if (evidence.acceptance !== "met") blockers.push("acceptance_unverified");
  if (evidence.integration !== "ready") blockers.push("integration_unverified");
  if (restrictions.independentReviewRequired && evidence.independentReview !== "passed") {
    blockers.push("independent_review_required");
  }
  if (evidence.validationEnvironment !== "ready" && evidence.validationEnvironment !== "not_required") {
    blockers.push("validation_environment_required");
  }
  const [firstBlocker, ...otherBlockers] = blockers;
  if (firstBlocker) return blocked(firstBlocker, ...otherBlockers);

  const mandatoryReview = mode === "review_first" || restrictions.humanApprovalRequired ||
    ownerReviewRequested || risk === "sensitive";
  const smartReview = mode === "smart_review" && risk === "reversible_experience";
  if (!authorization) {
    return mandatoryReview || smartReview ? waitForReview("authorization_required") : blocked("authorization_required");
  }
  if (!sameScope(scope, authorization.scope)) return blocked("authorization_scope_mismatch");
  if (now >= authorization.expiresAt) return blocked("authorization_expired");

  if (authorization.kind === "human") {
    return {
      ...context, status: "allowed", next: "integrate", review: "approved",
      validUntil: authorization.expiresAt, reasons: ["human_approval_verified"],
    };
  }
  if (mandatoryReview) return waitForReview();
  if (!smartReview) {
    return {
      ...context, status: "allowed", next: "integrate", review: "not_required",
      validUntil: authorization.expiresAt, reasons: ["automatic_integration_authorized"],
    };
  }

  if (!deferredReview) return waitForReview("deferred_review_required");
  if (deferredReview.state === "ended") return waitForReview("deferred_review_ended");
  if (!sameScope(scope, deferredReview.scope)) return waitForReview("deferred_review_scope_mismatch");
  if (now >= deferredReview.expiresAt) return waitForReview("deferred_review_expired");
  if (evidence.independentReview !== "passed") return waitForReview("independent_review_required");
  return {
    ...context, status: "allowed", next: "integrate", review: "deferred",
    validUntil: Math.min(authorization.expiresAt, deferredReview.expiresAt),
    reasons: ["automatic_integration_authorized", "review_deferred"],
  };
}
