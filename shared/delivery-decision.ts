import { z } from "zod";
import { workMode } from "./settings";

const identifier = z.string().min(1).refine((value) => value.trim() === value);
const candidateSha = z.string().refine((sha) =>
  (sha.length === 40 || sha.length === 64) && !/[^0-9a-f]/.test(sha) && /[1-9a-f]/.test(sha),
);
const scope = z.strictObject({
  projectId: identifier,
  taskId: identifier,
  destination: identifier,
  candidateSha,
  policyRevision: identifier,
});

// Unix time in milliseconds, shared with the injected clock.
export const deliveryTimestamp = z.int().nonnegative();
const timedScope = { scope, expiresAt: deliveryTimestamp };

const restrictions = z.strictObject({
  integrationDenied: z.boolean(),
  humanApprovalRequired: z.boolean(),
  independentReviewRequired: z.boolean(),
});
const evidence = z.strictObject({
  scope,
  protections: z.enum(["verified", "missing", "unknown"]),
  checks: z.enum(["passed", "missing", "pending", "failed", "unknown"]),
  acceptance: z.enum(["met", "unmet", "unknown"]),
  integration: z.enum(["ready", "conflicted", "unknown"]),
  independentReview: z.enum(["passed", "missing", "failed", "unknown"]),
  validationEnvironment: z.enum(["ready", "not_required", "missing", "unknown"]),
});

export const deliveryDecisionInput = z.strictObject({
  mode: workMode,
  scope,
  // Visual/experience review of reversible changes is the only deferrable risk.
  risk: z.enum(["low", "reversible_experience", "sensitive", "unknown"]),
  ownerReviewRequested: z.boolean(),
  restrictions,
  evidence,
  authorization: z.strictObject({
    ...timedScope,
    kind: z.enum(["automatic", "human"]),
  }).nullable(),
  deferredReview: z.strictObject({
    ...timedScope,
    state: z.enum(["active", "ended"]),
  }).nullable(),
});

export type DeliveryDecisionInput = z.infer<typeof deliveryDecisionInput>;

export type DeliveryReason =
  | "invalid_input"
  | "invalid_clock"
  | "unknown_risk"
  | "integration_denied"
  | "evidence_scope_mismatch"
  | "protections_unverified"
  | "checks_unverified"
  | "acceptance_unverified"
  | "integration_unverified"
  | "independent_review_required"
  | "validation_environment_required"
  | "human_approval_required"
  | "authorization_required"
  | "authorization_scope_mismatch"
  | "authorization_expired"
  | "deferred_review_required"
  | "deferred_review_scope_mismatch"
  | "deferred_review_expired"
  | "deferred_review_ended"
  | "human_approval_verified"
  | "automatic_integration_authorized"
  | "review_deferred";

interface DecisionContext {
  reasons: readonly [DeliveryReason, ...DeliveryReason[]];
  publicationAllowed: false;
}

interface CandidateContext extends DecisionContext {
  mode: DeliveryDecisionInput["mode"];
  scope: DeliveryDecisionInput["scope"];
  restrictions: DeliveryDecisionInput["restrictions"];
}

export type DeliveryDecision =
  | (DecisionContext & { status: "blocked"; next: "none" })
  | (CandidateContext & { status: "blocked"; next: "none" | "human_review" })
  | (CandidateContext & {
    status: "allowed";
    next: "integrate";
    review: "approved" | "not_required" | "deferred";
    validUntil: number;
  });
