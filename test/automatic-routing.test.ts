import { describe, expect, it } from "vitest";
import { automaticRouting, ROUTING_METADATA_KEY, type CreationRequest } from "../server/automatic-routing";
import { orchestrationMetadataPatch } from "../shared/orchestration";
import type { ProviderCatalogData } from "../shared/providers";
import { defaultSettings, type ZelqioSettings } from "../shared/settings";

const catalog: ProviderCatalogData = {
  generatedAt: "2026-11-27T12:00:00.000Z",
  providers: ["alpha", "beta"].map(id => ({
    id, label: id, status: "ready" as const, enabled: true, source: "builtin" as const, modes: [],
    models: [{ id: `${id}-model`, label: id, isDefault: true, selectable: true, thinkingOptions: [{ id: "high", label: "High", isDefault: false }] }],
  })),
};
const settings = (providers: ZelqioSettings["providers"], extra: Partial<ZelqioSettings> = {}): ZelqioSettings => ({ ...defaultSettings(), providers, ...extra });
const automatic = orchestrationMetadataPatch("automatic");
const request = (overrides: Partial<CreationRequest> = {}): CreationRequest => ({
  config: { provider: "beta", model: "beta-model", modeId: "plan", thinkingOptionId: "high", providerOptions: { fast: true } },
  metadata: { ...automatic },
  ...overrides,
});
const make = (saved: ZelqioSettings | null) => automaticRouting({
  readCatalog: async () => catalog, readUsage: async () => null, readSettings: async () => saved, clock: () => 42,
});

describe("automatic routing at creation", () => {
  it("never touches a request when Automatic is off, so an explicit choice stays", async () => {
    const original = request({ metadata: {} });
    const result = await make(settings({ alpha: { use: "primary", funding: "subscription" } }))(original);
    expect(result).toBe(original);
  });

  it("chooses an authorized model when Automatic is on and resets provider-specific settings", async () => {
    const result = await make(settings({ alpha: { use: "primary", funding: "subscription" }, beta: { use: "off", funding: "subscription" } }))(request());
    expect(result.config).toMatchObject({ provider: "alpha", model: "alpha-model", thinkingOptionId: "high" });
    expect(result.config.modeId).toBeUndefined();
    expect(result.config.providerOptions).toBeUndefined();
    expect(result.metadata?.[ROUTING_METADATA_KEY]).toEqual({ status: "routed", provider: "alpha", model: "alpha-model", at: 42 });
  });

  it("keeps mode and options when the provider does not change", async () => {
    const result = await make(settings({ beta: { use: "primary", funding: "subscription" } }))(request());
    expect(result.config).toMatchObject({ provider: "beta", model: "beta-model", modeId: "plan", providerOptions: { fast: true } });
  });

  it("leaves the request and says why when no authorized model exists", async () => {
    const result = await make(settings({ alpha: { use: "off", funding: "subscription" } }))(request());
    expect(result.config).toMatchObject({ provider: "beta", model: "beta-model" });
    expect(result.metadata?.[ROUTING_METADATA_KEY]).toMatchObject({ status: "unrouted", reason: "no_authorized_model" });
  });

  it("never blocks creation when something fails", async () => {
    const original = request();
    const failing = automaticRouting({
      readCatalog: async () => { throw new Error("paseo down"); }, readUsage: async () => null,
      readSettings: async () => settings({}), clock: () => 1,
    });
    expect(await failing(original)).toBe(original);
    expect((await make(null)(request())).metadata?.[ROUTING_METADATA_KEY]).toMatchObject({ reason: "settings_unavailable" });
  });

  it("does not pick pay-per-use models by default", async () => {
    const result = await make(settings({ alpha: { use: "primary", funding: "consumption" } }, { consumptionOptIn: true }))(request());
    expect(result.metadata?.[ROUTING_METADATA_KEY]).toMatchObject({ status: "unrouted" });
    expect(result.config.provider).toBe("beta");
  });
});
