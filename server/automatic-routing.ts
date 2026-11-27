import { draftOrchestration } from "../shared/orchestration";
import type { ProviderCatalogData } from "../shared/providers";
import type { RolesConfig } from "../shared/roles";
import type { ZelqioSettings } from "../shared/settings";
import type { UsageSnapshot } from "../shared/usage";
import { chooseEffort } from "./effort";
import { deriveModelFacts, providerQuotas } from "./model-facts";
import { resolveRoles } from "./roles";
import { route } from "./router";

export const ROUTING_METADATA_KEY = "zelqio-flow.routing";

/** The part of the creation request this module reads and may change. */
export interface CreationRequest {
  config: {
    provider: string;
    model?: string;
    modeId?: string;
    thinkingOptionId?: string;
    providerOptions?: unknown;
    [key: string]: unknown;
  };
  metadata?: Record<string, unknown>;
}

export interface RoutingDeps {
  readCatalog(): Promise<ProviderCatalogData>;
  readUsage(): Promise<UsageSnapshot | null>;
  readSettings(): Promise<ZelqioSettings | null>;
  readRoles?(): Promise<RolesConfig>;
  clock?: () => number;
}

/**
 * With Automatic switched on for a draft, the user has asked Zelqio Flow to choose. This picks the best authorized
 * model for the role and rewrites the creation request. Without the marker nothing is touched, so an explicit
 * choice made with Automatic off is never overridden. Any failure leaves the request exactly as it came: routing
 * must never block the creation of an agent.
 */
export function automaticRouting(deps: RoutingDeps) {
  const clock = deps.clock ?? Date.now;
  return async function rewrite<Request extends CreationRequest>(request: Request, roleId = "developer"): Promise<Request> {
    const metadata = request.metadata ?? {};
    if (draftOrchestration(metadata) !== "automatic") return request;
    const note = (value: Record<string, unknown>): Request => ({
      ...request,
      metadata: { ...metadata, [ROUTING_METADATA_KEY]: { ...value, at: clock() } },
    });
    try {
      const [settings, catalog, usage, rolesConfig] = await Promise.all([deps.readSettings(), deps.readCatalog(), deps.readUsage(), deps.readRoles?.().catch(() => ({})) ?? Promise.resolve({})]);
      if (!settings) return note({ status: "unrouted", reason: "settings_unavailable" });
      const role = resolveRoles(rolesConfig).find(entry => entry.id === roleId);
      if (!role) return note({ status: "unrouted", reason: "unknown_role" });
      const decision = route({
        catalog, settings, role, capability: role.capabilities[0],
        models: deriveModelFacts({ catalog, settings, usage, now: clock() }),
        allowUnknownQuota: true,
        continuity: request.config.model ? { provider: request.config.provider, model: request.config.model } : undefined,
      });
      const selected = decision.selected;
      if (!selected) return note({ status: "unrouted", reason: "no_authorized_model" });

      const sameProvider = selected.provider === request.config.provider;
      const model = catalog.providers.find(provider => provider.id === selected.provider)?.models.find(entry => entry.id === selected.model);
      const thinking = request.config.thinkingOptionId;
      const thinkingValid = Boolean(thinking && model?.thinkingOptions.some(option => option.id === thinking));
      // The draft prompt is not part of the creation request, so the reasoning level follows the strategy and the quota.
      const remaining = providerQuotas(usage, clock()).get(selected.provider)?.remainingPct;
      const effort = thinkingValid ? thinking : chooseEffort(model?.thinkingOptions ?? [], {
        complexity: "medium", strategy: settings.strategy, quotaLow: remaining !== null && remaining !== undefined && remaining <= 30,
      });
      // A provider has its own modes, thinking levels and options. Keep them only where they still mean the same thing.
      const { modeId: _mode, thinkingOptionId: _thinking, providerOptions: _options, ...rest } = request.config;
      void _mode; void _thinking; void _options;
      const config = {
        ...rest,
        provider: selected.provider,
        model: selected.model,
        ...(sameProvider && request.config.modeId ? { modeId: request.config.modeId } : {}),
        ...(sameProvider && request.config.providerOptions !== undefined ? { providerOptions: request.config.providerOptions } : {}),
        ...(effort ? { thinkingOptionId: effort } : {}),
      };
      return {
        ...request,
        config,
        metadata: { ...metadata, [ROUTING_METADATA_KEY]: { status: "routed", provider: selected.provider, model: selected.model, at: clock() } },
      };
    } catch {
      return request;
    }
  };
}
