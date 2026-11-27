import type { ProviderCatalogData } from "../shared/providers";
import type { RoutingPreviewInput } from "../shared/routing-preview";
import type { RolesConfig } from "../shared/roles";
import type { ZelqioSettings } from "../shared/settings";
import { resolveRoles } from "./roles";
import { route, type RoutingModelFacts } from "./router";

/** Evaluates caller declarations for advice. The resulting data never establishes selection or spending authority. */
export function previewRouting(input: RoutingPreviewInput, catalog: ProviderCatalogData, settings: ZelqioSettings, now: number, roles: RolesConfig = {}) {
  const models = new Map<string, Map<string, RoutingModelFacts>>();
  for (const entry of input.models) {
    const declared = Date.parse(entry.declaredAt);
    const expires = Date.parse(entry.expiresAt);
    const facts: RoutingModelFacts = {
      permitted: true,
      funding: declared <= now && now < expires ? entry.funding : undefined,
    };
    let provider = models.get(entry.provider);
    if (!provider) {
      provider = new Map();
      models.set(entry.provider, provider);
    }
    provider.set(entry.model, facts);
  }
  const role = resolveRoles(roles).find((entry) => entry.id === input.role)!;
  const decision = route({
    catalog, settings, role, models, capability: input.capability,
    // The usage projection cannot be bound to an exact model. Preview can rank unknown quota, without using it to grant an effect.
    allowUnknownQuota: true,
  });
  const selected = decision.selected;
  const declaredFunding = selected && models.get(selected.provider)?.get(selected.model)?.funding;
  return {
    status: "advisory" as const,
    quota: "unbound" as const,
    strategy: decision.strategy,
    recommended: selected && declaredFunding ? { ...selected, declaredFunding, quota: "unbound" as const } : null,
    excluded: decision.excluded,
  };
}
