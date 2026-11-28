import type { ProviderCatalogData } from "../shared/providers";
import type { Capability, RoleDefinition } from "../shared/roles";
import type { Funding, ZelqioSettings } from "../shared/settings";
import type { UsageStatus } from "../shared/usage";

export interface RoutingTarget {
  provider: string;
  model: string;
}

export interface RoutingModelFacts {
  // The caller supplies verified facts for the exact provider and model. Catalog labels and provider
  // preferences do not establish billing, account identity, permissions or model capabilities.
  funding?: Funding;
  permitted: boolean;
  spendPermitted?: boolean;
  quality?: number;
  quota?: { status: UsageStatus; remainingPct: number | null; observedAt?: number };
  suspendedSince?: number;
  reservePct?: number;
  lastSelectedAt?: number;
  /** Position in the user's list of authorized models for the provider; earlier is preferred when scores tie. */
  order?: number;
}

export interface RoutingRequest {
  catalog: ProviderCatalogData;
  settings: ZelqioSettings;
  role: RoleDefinition;
  capability: Capability;
  models: ReadonlyMap<string, ReadonlyMap<string, RoutingModelFacts>>;
  continuity?: RoutingTarget;
  /** An explicit funding choice or the original funding on a retry. Omission never permits consumption. */
  requestedFunding?: Funding;
  allowUnknownQuota?: boolean;
}

type Exclusion =
  | "ambiguous_catalog" | "provider_unavailable" | "provider_off" | "model_unselectable" | "outside_role"
  | "not_permitted" | "funding_unknown" | "funding_mismatch" | "explicit_consumption_required" | "spend_not_authorized"
  | "quota_exhausted" | "quota_reset_unconfirmed" | "quota_unknown" | "quota_reserved";

interface RankedTarget {
  target: RoutingTarget;
  score: number[];
}

export interface RoutingDecision {
  selected: RoutingTarget | null;
  ranked: RoutingTarget[];
  excluded: Array<{ target: RoutingTarget; reason: Exclusion }>;
  strategy: ZelqioSettings["strategy"];
}

const fundingRank: Record<Funding, number> = { free: 0, local: 0, subscription: 1, consumption: 2 };
const validPercent = (value: number | null | undefined): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100;

function prioritization(strategy: ZelqioSettings["strategy"], signals: {
  pressure: number; continuity: number; quality: number; funding: number; preference: number;
}): number[] {
  const { pressure, continuity, quality, funding, preference } = signals;
  switch (strategy) {
    case "economy": return [funding, pressure, continuity, preference];
    case "quality_first": return [quality, pressure, continuity, preference];
    case "custom": return [preference, pressure, continuity, funding];
    case "balanced": return [pressure, continuity, preference, funding];
  }
}

function compareIds(a: RoutingTarget, b: RoutingTarget): number {
  if (a.provider !== b.provider) return a.provider < b.provider ? -1 : 1;
  if (a.model !== b.model) return a.model < b.model ? -1 : 1;
  return 0;
}

function compareTargets(a: RankedTarget, b: RankedTarget): number {
  for (const [index, value] of a.score.entries()) {
    const other = b.score[index] ?? Infinity;
    if (value < other) return -1;
    if (value > other) return 1;
  }
  return compareIds(a.target, b.target);
}

/** Evaluates and ranks concrete targets without launching agents, choosing a provider-side default or spending. */
export function route(request: RoutingRequest): RoutingDecision {
  const { catalog, settings, role, capability, models, continuity, requestedFunding, allowUnknownQuota = false } = request;
  const ranked: RankedTarget[] = [];
  const excluded: RoutingDecision["excluded"] = [];
  const supportsTask = role.capabilities.includes(capability);
  const knownProviders = new Set<string>();
  const ambiguousProviders = new Set<string>();
  for (const { id } of catalog.providers) {
    if (knownProviders.has(id)) ambiguousProviders.add(id);
    knownProviders.add(id);
  }

  for (const provider of catalog.providers) {
    const setting = Object.hasOwn(settings.providers, provider.id) ? settings.providers[provider.id] : undefined;
    for (const model of provider.models) {
      const target = { provider: provider.id, model: model.id };
      const exclude = (reason: Exclusion) => { excluded.push({ target, reason }); };
      const preference = role.candidates.findIndex((entry) =>
        entry.provider === provider.id && (entry.model === undefined || entry.model === model.id)
      );
      if (ambiguousProviders.has(provider.id)) { exclude("ambiguous_catalog"); continue; }
      if (!provider.enabled || provider.status !== "ready") { exclude("provider_unavailable"); continue; }
      if (!setting || setting.use === "off") { exclude("provider_off"); continue; }
      if (!model.selectable) { exclude("model_unselectable"); continue; }
      if (!supportsTask || (role.candidates.length > 0 && preference < 0)) { exclude("outside_role"); continue; }

      const facts = models.get(provider.id)?.get(model.id);
      if (facts?.permitted !== true) { exclude("not_permitted"); continue; }
      if (facts.funding === undefined) { exclude("funding_unknown"); continue; }
      if (facts.funding !== setting.funding || (requestedFunding !== undefined && facts.funding !== requestedFunding)) {
        exclude("funding_mismatch"); continue;
      }
      if (facts.funding === "consumption") {
        if (requestedFunding !== "consumption") { exclude("explicit_consumption_required"); continue; }
        if (!settings.consumptionOptIn || facts.spendPermitted !== true) { exclude("spend_not_authorized"); continue; }
      }

      const reserve = facts.reservePct ?? 0;
      const remaining = facts.quota?.remainingPct;
      const fresh = facts.quota?.status === "fresh" && validPercent(remaining);
      const observedAt = facts.quota?.observedAt;
      const newObservation = observedAt !== undefined && Number.isFinite(observedAt) && observedAt > (facts.suspendedSince ?? -Infinity);
      if (facts.quota?.status === "reset" || (facts.suspendedSince !== undefined && !(fresh && newObservation && remaining > 0))) {
        exclude("quota_reset_unconfirmed"); continue;
      }
      if (facts.quota?.status === "exhausted" || (fresh && remaining === 0)) { exclude("quota_exhausted"); continue; }
      if (!fresh && (!allowUnknownQuota || reserve > 0 || remaining === 0)) { exclude("quota_unknown"); continue; }
      if (!validPercent(reserve) || (fresh && remaining <= reserve)) { exclude("quota_reserved"); continue; }

      const score = [...prioritization(settings.strategy, {
        // Compare coarse pressure levels, never raw percentages across providers.
        pressure: fresh ? (remaining <= 30 ? 1 : 0) : 2,
        continuity: continuity?.provider === provider.id && continuity.model === model.id ? 0 : 1,
        quality: facts.quality !== undefined && Number.isFinite(facts.quality) ? -facts.quality : Infinity,
        funding: fundingRank[facts.funding],
        preference: Math.max(0, preference),
      }),
        // Ties: a primary provider before an auxiliary one, then the user's own order of authorized models.
        setting.use === "primary" ? 0 : 1,
        facts.order ?? 0,
      ];
      ranked.push({
        target,
        score: [
          fresh ? 0 : 1,
          setting.use === "primary" ? 0 : 1,
          ...score,
          facts.lastSelectedAt !== undefined && Number.isFinite(facts.lastSelectedAt) ? facts.lastSelectedAt : -Infinity,
          model.isDefault ? 0 : 1,
        ],
      });
    }
  }

  const ordered = ranked.sort(compareTargets).map(({ target }) => target);
  return { selected: ordered[0] ?? null, ranked: ordered, excluded: excluded.sort((a, b) => compareIds(a.target, b.target)), strategy: settings.strategy };
}
