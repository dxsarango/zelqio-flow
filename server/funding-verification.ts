import { funding, type Funding } from "../shared/settings";

/** The adapter binds the effective account or anonymous/local identity, endpoint and runtime configuration. */
export interface FundingRoute {
  host: string;
  project: string;
  provider: string;
  model: string;
  binding: string;
}

export interface FundingGrant {
  route: FundingRoute;
  policyRevision: string;
  funding: Funding;
  expiresAt: number;
}

interface FundingScope {
  route: FundingRoute;
  policyRevision: string;
}

export interface FundingObservation {
  route: FundingRoute;
  funding: Funding;
  source: "observed" | "attested";
  evidenceRef: string;
  additionalCharges: "blocked" | "possible" | "unknown";
  observedAt: number;
  expiresAt: number;
}

/** A daemon-side adapter reads its provider's supported signals and returns no observation for unbound data. */
export interface FundingAdapter {
  maxObservationAgeMs: number;
  timeoutMs: number;
  observe(route: Readonly<FundingRoute>, signal: AbortSignal): Promise<FundingObservation | null>;
}

function sameRoute(left: FundingRoute, right: FundingRoute | null | undefined): boolean {
  return !!right && [left.host, left.project, left.provider, left.model, left.binding].every(value => typeof value === "string" && value.trim().length > 0)
    && left.host === right.host && left.project === right.project
    && left.provider === right.provider && left.model === right.model && left.binding === right.binding;
}

type FundingFacts = {
  declaredFunding: Funding | null;
  authorizedFunding: Funding | null;
  verifiedFunding: Funding | null;
  declarationMatchesVerified: boolean | null;
};
type FundingAssessment = FundingFacts & (
  | { reason: "verified_no_additional_charges"; verification: FundingScope & { validUntil: number; evidenceRef: string } }
  | { reason: "policy_missing" | "scope_changed" | "consumption_excluded" | "funding_unverified" | "funding_mismatch" | "additional_charges_unverified" }
);

/**
 * Checks funding for the no-extra-cost selection path. Inputs for the route and standing grant must come
 * from trusted daemon-side resolution. A recommendation, draft marker or RPC declaration cannot supply them.
 * This contract is tested with fixtures and is not connected to selection or session creation.
 */
export async function assessFunding(
  adapters: ReadonlyMap<string, FundingAdapter>,
  request: FundingScope & { grant?: FundingGrant; declaredFunding?: Funding; currentScope: () => FundingScope | null },
  clock: () => number = Date.now,
): Promise<FundingAssessment> {
  const { policyRevision, grant, declaredFunding = null } = request;
  const route = { ...request.route };
  const assessment: FundingFacts = {
    declaredFunding: funding.safeParse(declaredFunding).data ?? null,
    authorizedFunding: null,
    verifiedFunding: null,
    declarationMatchesVerified: null,
  };
  const now = clock();
  if (!grant || typeof policyRevision !== "string" || !policyRevision.trim() || grant.policyRevision !== policyRevision || !sameRoute(route, grant.route)
    || !funding.safeParse(grant.funding).success
    || !Number.isFinite(now) || !Number.isFinite(grant.expiresAt) || grant.expiresAt <= now) {
    return { ...assessment, reason: "policy_missing" };
  }
  const authorized = { ...assessment, authorizedFunding: grant.funding };
  const grantExpiry = grant.expiresAt;
  if (grant.funding === "consumption") return { ...authorized, reason: "consumption_excluded" };

  const adapter = adapters.get(route.provider);
  const maxAge = adapter?.maxObservationAgeMs;
  const timeoutMs = adapter?.timeoutMs;
  if (!adapter || typeof maxAge !== "number" || !Number.isFinite(maxAge) || maxAge <= 0
    || typeof timeoutMs !== "number" || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 2_147_483_647) {
    return { ...authorized, reason: "funding_unverified" };
  }
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let observation: FundingObservation | null;
  try {
    const deadline = new Promise<null>(resolve => {
      timer = setTimeout(() => {
        resolve(null);
        controller.abort();
      }, timeoutMs);
    });
    observation = await Promise.race([deadline, adapter.observe({ ...route }, controller.signal)]);
  } catch {
    return { ...authorized, reason: "funding_unverified" };
  } finally {
    clearTimeout(timer);
  }
  let current: FundingScope | null;
  try {
    current = request.currentScope();
  } catch {
    current = null;
  }
  const checkedAt = clock();
  if (!Number.isFinite(checkedAt) || checkedAt < now || grantExpiry <= checkedAt) {
    return { ...assessment, reason: "policy_missing" };
  }
  if (!current || current.policyRevision !== policyRevision || !sameRoute(route, current.route)) {
    return { ...assessment, reason: "scope_changed" };
  }
  if (!observation || observation.source !== "observed" || typeof observation.evidenceRef !== "string"
    || !/^[A-Za-z0-9_.-]{1,128}$/.test(observation.evidenceRef)
    || !funding.safeParse(observation.funding).success || !sameRoute(route, observation.route)
    || !Number.isFinite(observation.observedAt) || observation.observedAt > checkedAt
    || checkedAt - observation.observedAt >= maxAge || !Number.isFinite(observation.expiresAt) || observation.expiresAt <= checkedAt) {
    return { ...authorized, reason: "funding_unverified" };
  }
  const verified = {
    ...authorized,
    verifiedFunding: observation.funding,
    declarationMatchesVerified: assessment.declaredFunding === null ? null : assessment.declaredFunding === observation.funding,
  };
  if (observation.funding !== authorized.authorizedFunding) return { ...verified, reason: "funding_mismatch" };
  if (observation.additionalCharges !== "blocked") return { ...verified, reason: "additional_charges_unverified" };
  return {
    ...verified,
    reason: "verified_no_additional_charges",
    verification: {
      route, policyRevision, evidenceRef: observation.evidenceRef,
      validUntil: Math.min(grantExpiry, observation.expiresAt, observation.observedAt + maxAge),
    },
  };
}
