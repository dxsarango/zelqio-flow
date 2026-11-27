/**
 * Evaluates synthetic selection evidence. This fixture is not connected to Paseo hooks, selection,
 * or session creation. Both snapshots must come from trusted resolution of the live draft,
 * effective route and standing policy. The marker grants no authority.
 *
 * The last scope read during evaluation happens inside assessFunding. A consumer must call
 * selectionInvalidation with a fresh snapshot immediately before any effect.
 */
import { isDeepStrictEqual } from "node:util";
import {
  selectionSnapshot,
  type SelectionDecision,
  type SelectionInvalidation,
  type SelectionProposal,
  type SelectionSnapshot,
} from "../shared/selection-authority";
import { assessFunding, type FundingAdapter } from "./funding-verification";

const issuedProposals = new WeakSet<SelectionProposal>();

const availabilityReasons = {
  unavailable: "candidate_unavailable",
  quota_exhausted: "quota_exhausted",
  quota_reset_unconfirmed: "quota_reset_unconfirmed",
  unknown: "availability_unknown",
} as const;

function blocked(reason: Extract<SelectionDecision, { status: "blocked" }>["reason"]): SelectionDecision {
  return { status: "blocked", reason, validUntil: null };
}

function readTime(clock: () => number): number {
  try {
    const now = clock();
    return Number.isFinite(now) ? now : NaN;
  } catch {
    return NaN;
  }
}

function parseSnapshot(input: unknown): SelectionSnapshot | null {
  try {
    const parsed = selectionSnapshot.safeParse(input);
    // Parsing must preserve every value in the effective settings, including record keys.
    return parsed.success && isDeepStrictEqual(input, parsed.data) ? parsed.data : null;
  } catch {
    return null;
  }
}

function freezeEvidence(value: unknown): void {
  if (typeof value !== "object" || value === null) return;
  for (const entry of Object.values(value)) freezeEvidence(entry);
  Object.freeze(value);
}

function snapshotChange(
  before: SelectionSnapshot,
  current: unknown,
): SelectionInvalidation | null {
  const after = parseSnapshot(current);
  if (!after || before.policyRevision !== after.policyRevision
    || before.workspace !== after.workspace || before.destination !== after.destination
    || !isDeepStrictEqual(before.route, after.route)) {
    return "scope_changed";
  }
  return isDeepStrictEqual(before, after) ? null : "selection_changed";
}

export async function evaluateSelection(
  adapters: ReadonlyMap<string, FundingAdapter>,
  input: unknown,
  currentScope: () => SelectionSnapshot | null,
  clock: () => number,
): Promise<SelectionDecision> {
  const snapshot = parseSnapshot(input);
  if (!snapshot) return blocked("invalid_snapshot");
  const { intent, nativeChoice, candidate, grant, route, policyRevision, retry } = snapshot;
  if (nativeChoice.provenance === "explicit") {
    return { status: "keep_user_choice", reason: "explicit_choice", validUntil: null };
  }
  if (intent !== "automatic") {
    return { status: "keep_user_choice", reason: "automatic_disabled", validUntil: null };
  }
  if (nativeChoice.provenance !== "default") return blocked("unknown_choice");
  if (candidate.provider !== route.provider || candidate.model !== route.model) return blocked("candidate_route_mismatch");
  // The S04 ADR limits first activation (including retries) to the native provider.
  if (nativeChoice.provider !== route.provider || (retry && retry.failedRoute.provider !== route.provider)) {
    return blocked("different_provider");
  }
  if (nativeChoice.model === route.model) {
    return { status: "keep_user_choice", reason: "candidate_matches_choice", validUntil: null };
  }
  if (!isDeepStrictEqual(nativeChoice.effective, candidate.effective)) return blocked("effective_settings_changed");
  if (candidate.availability !== "available") return blocked(availabilityReasons[candidate.availability]);
  if (candidate.declaredFunding === "consumption" || retry?.originalFunding === "consumption") {
    return blocked("consumption_excluded");
  }
  if (candidate.declaredFunding === null) return blocked("funding_unverified");

  if (retry) {
    const { failedRoute, cause, originalFunding } = retry;
    if (route.host !== failedRoute.host || route.project !== failedRoute.project || route.binding !== failedRoute.binding) {
      return blocked("scope_changed");
    }
    if (route.model === failedRoute.model || cause === "provider_quota_exhausted") return blocked("retry_target_excluded");
    // The funding verifier also requires the observation to match the candidate's own standing grant.
    if (grant && grant.funding !== "consumption" && grant.funding !== originalFunding) return blocked("retry_funding_changed");
  }

  const readChange = (): SelectionInvalidation | null => {
    try {
      return snapshotChange(snapshot, currentScope());
    } catch {
      return "scope_changed";
    }
  };

  const beforeRead = readChange();
  if (beforeRead) return blocked(beforeRead);
  let afterRead: SelectionInvalidation | null = null;
  let lastClockRead = -Infinity;
  const readMonotonicTime = () => {
    const now = readTime(clock);
    lastClockRead = now >= lastClockRead ? now : NaN;
    return lastClockRead;
  };
  const assessment = await assessFunding(adapters, {
    route,
    policyRevision,
    grant,
    declaredFunding: candidate.declaredFunding,
    currentScope: () => {
      afterRead = readChange();
      return afterRead ? null : { route, policyRevision };
    },
  }, readMonotonicTime);
  if (Number.isNaN(lastClockRead)) return blocked("invalid_clock");
  if (afterRead) return blocked(afterRead);
  if (assessment.reason !== "verified_no_additional_charges") return blocked(assessment.reason);
  // Narrow the verifier's funding facts to the classes eligible for automatic selection.
  const { verifiedFunding, verification: { validUntil, evidenceRef } } = assessment;
  if (verifiedFunding === null || verifiedFunding === "consumption") return blocked("funding_unverified");
  const checkedAt = readMonotonicTime();
  if (Number.isNaN(checkedAt)) return blocked("invalid_clock");
  if (checkedAt >= validUntil) return blocked("verification_expired");
  freezeEvidence(snapshot);
  const proposal: SelectionProposal = Object.freeze({
    status: "apply_candidate", snapshot, verifiedFunding, evidenceRef, checkedAt, validUntil,
  });
  issuedProposals.add(proposal);
  return proposal;
}

/** Checks current evidence immediately before using a proposal. Any invalidation requires a new evaluation. */
export function selectionInvalidation(
  proposal: SelectionProposal,
  current: unknown,
  clock: () => number,
): SelectionInvalidation | null {
  if (!issuedProposals.has(proposal)) return "proposal_not_issued";
  const now = readTime(clock);
  if (Number.isNaN(now)) return "invalid_clock";
  if (now < proposal.checkedAt || now >= proposal.validUntil) return "verification_expired";
  return snapshotChange(proposal.snapshot, current);
}
