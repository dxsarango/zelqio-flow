import type { ProviderCatalogData } from "../shared/providers";
import type { ZelqioSettings } from "../shared/settings";
import { displayedUsageStatus, type UsageSnapshot, type UsageStatus } from "../shared/usage";
import type { RoutingModelFacts } from "./router";

type Facts = ReadonlyMap<string, ReadonlyMap<string, RoutingModelFacts>>;

/**
 * Quota of one provider as Paseo reports it. Paseo reports usage per source (usually the provider id), not per
 * model, so every model of the provider shares it. Nothing here verifies billing or accounts: Paseo and the provider
 * own that.
 */
export interface ProviderQuota {
  status: UsageStatus;
  remainingPct: number | null;
  observedAt?: number;
  /** Earliest known reset among the exhausted windows, in epoch milliseconds. */
  resetsAt?: number;
}

export function providerQuotas(usage: UsageSnapshot | null, now: number): Map<string, ProviderQuota> {
  const out = new Map<string, ProviderQuota>();
  if (!usage) return out;
  for (const report of usage.reports) {
    if (report.status !== "available" || report.windows.length === 0) continue;
    const observedAt = report.fetchedAt === null ? undefined : Date.parse(report.fetchedAt);
    const states = report.windows.map(window => ({
      status: displayedUsageStatus(window, report.fetchedAt, usage.status === "available", now),
      remainingPct: window.remainingPct,
      resetsAt: window.resetsAt === null ? undefined : Date.parse(window.resetsAt),
    }));
    const exhausted = states.filter(state => state.status === "exhausted");
    const known = states.filter(state => state.remainingPct !== null);
    const status: UsageStatus = exhausted.length ? "exhausted"
      : states.some(state => state.status === "reset") ? "reset"
      : states.some(state => state.status === "stale") ? "stale"
      : states.every(state => state.status === "fresh") ? "fresh" : "unknown";
    const resets = exhausted.map(state => state.resetsAt).filter((value): value is number => value !== undefined && Number.isFinite(value));
    out.set(report.sourceId, {
      status,
      remainingPct: known.length ? Math.min(...known.map(state => state.remainingPct as number)) : null,
      observedAt: Number.isFinite(observedAt) ? observedAt : undefined,
      resetsAt: resets.length ? Math.max(...resets) : undefined,
    });
  }
  return out;
}

/**
 * Builds the routing facts from what the user configured and what Paseo reports. The user's own provider settings
 * are the authorization: a provider set to "off" is never selected, and consumption is only possible after the
 * explicit opt-in. The declared funding is not verified; callers should say so wherever they show it.
 */
export function deriveModelFacts(input: {
  catalog: ProviderCatalogData;
  settings: ZelqioSettings;
  usage: UsageSnapshot | null;
  now: number;
  /** Providers that returned a quota error, with the time it happened. They stay excluded until fresh quota shows up. */
  suspended?: Readonly<Record<string, number>>;
}): Facts {
  const quotas = providerQuotas(input.usage, input.now);
  const models = new Map<string, Map<string, RoutingModelFacts>>();
  for (const provider of input.catalog.providers) {
    const setting = Object.hasOwn(input.settings.providers, provider.id) ? input.settings.providers[provider.id] : undefined;
    if (!setting || setting.use === "off") continue;
    const quota = quotas.get(provider.id);
    const byModel = new Map<string, RoutingModelFacts>();
    for (const model of provider.models) {
      byModel.set(model.id, {
        permitted: true,
        funding: setting.funding,
        spendPermitted: input.settings.consumptionOptIn,
        quota: quota ? { status: quota.status, remainingPct: quota.remainingPct, observedAt: quota.observedAt } : undefined,
        suspendedSince: input.suspended?.[provider.id],
      });
    }
    models.set(provider.id, byModel);
  }
  return models;
}
