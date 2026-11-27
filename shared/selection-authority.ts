import { z } from "zod";
import { funding, type Funding } from "./settings";

// Model and provider IDs are opaque catalog values. Check for blanks without normalizing them.
const identity = z.string().refine(value => value.trim().length > 0);
const reference = z.string().regex(/^[A-Za-z0-9_.-]{1,128}$/);
const fundingRoute = z.strictObject({
  host: identity,
  project: identity,
  provider: identity,
  model: identity,
  binding: identity,
});
const selectionScope = z.strictObject({
  route: fundingRoute,
  policyRevision: identity,
  destination: reference,
  workspace: reference,
});
const effectiveSettings = z.strictObject({
  options: z.record(identity, z.json()),
  mode: identity.nullable(),
  permissions: z.record(identity, z.json()),
});
const availability = z.enum(["available", "unavailable", "quota_exhausted", "quota_reset_unconfirmed", "unknown"]);

/**
 * A fixture for one native draft and its resolved destination. The caller supplies opaque destination
 * and workspace references, a trusted standing grant, and complete, secret-free native snapshots.
 * The draft marker and the candidate's funding declaration are advisory inputs.
 */
export const selectionSnapshot = selectionScope.extend({
  intent: z.enum(["disabled", "automatic"]),
  nativeChoice: z.strictObject({
    provenance: z.enum(["explicit", "default", "unknown"]),
    provider: identity,
    model: identity,
    effective: effectiveSettings,
  }),
  candidate: z.strictObject({
    provider: identity,
    model: identity,
    declaredFunding: funding.nullable(),
    // Trusted projection for the exact route, including the effects of any model-dependent defaults.
    effective: effectiveSettings,
    // The caller must resolve current eligibility, including any unresolved quota suspension.
    availability,
  }),
  grant: z.strictObject({
    action: z.literal("select_model"),
    route: fundingRoute,
    policyRevision: identity,
    funding,
    expiresAt: z.number(),
  }).optional(),
  retry: z.strictObject({
    attempt: z.literal(1),
    failedRoute: fundingRoute,
    cause: z.enum(["unavailable", "model_quota_exhausted", "provider_quota_exhausted"]),
    // The verified funding of the original route is the exact funding restriction of the retry.
    originalFunding: funding,
  }).optional(),
});

export type SelectionSnapshot = z.infer<typeof selectionSnapshot>;

export type SelectionInvalidation =
  | "scope_changed" | "selection_changed" | "verification_expired" | "proposal_not_issued" | "invalid_clock";

/** Only the original in-memory object can be revalidated. Serialized proposals require a new evaluation. */
export type SelectionProposal = Readonly<{
  status: "apply_candidate";
  snapshot: SelectionSnapshot;
  verifiedFunding: Exclude<Funding, "consumption">;
  evidenceRef: string;
  checkedAt: number;
  validUntil: number;
}>;

export type SelectionDecision =
  | SelectionProposal
  | { status: "keep_user_choice"; reason: "automatic_disabled" | "explicit_choice" | "candidate_matches_choice"; validUntil: null }
  | {
    status: "blocked";
    reason: SelectionInvalidation
      | "invalid_snapshot" | "unknown_choice" | "candidate_route_mismatch" | "different_provider"
      | "effective_settings_changed" | "candidate_unavailable" | "quota_exhausted"
      | "quota_reset_unconfirmed" | "availability_unknown" | "retry_target_excluded" | "retry_funding_changed"
      | "policy_missing" | "consumption_excluded" | "funding_unverified" | "funding_mismatch"
      | "additional_charges_unverified";
    validUntil: null;
  };
