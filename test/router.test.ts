import { describe, expect, it } from "vitest";
import { resolveRoles } from "../server/roles";
import { route, type RoutingModelFacts, type RoutingRequest } from "../server/router";
import type { CatalogProvider } from "../shared/providers";
import { defaultSettings } from "../shared/settings";

const developer = resolveRoles({}).find(({ id }) => id === "developer")!;
const provider = (id: string, ...models: string[]): CatalogProvider => ({
  id, label: id, enabled: true, status: "ready", modes: [],
  models: models.map((model, index) => ({ id: model, label: model, selectable: true, isDefault: index === 0, thinkingOptions: [] })),
});
const verified: RoutingModelFacts = {
  funding: "free", permitted: true, quota: { status: "fresh", remainingPct: 70 },
};

function request(overrides: Partial<RoutingRequest> = {}): RoutingRequest {
  return {
    catalog: { providers: [provider("mixed", "paid-default", "unknown", "free")], generatedAt: "2026-11-26" },
    settings: { ...defaultSettings(), providers: { mixed: { use: "primary", funding: "free" } } },
    role: developer,
    capability: "implement",
    models: new Map([["mixed", new Map([
      ["paid-default", { ...verified, funding: "consumption", spendPermitted: true, quality: 100 }],
      ["unknown", { ...verified, funding: undefined }],
      ["free", { ...verified }],
    ])]]),
    ...overrides,
  };
}

describe("deterministic routing", () => {
  it("never admits paid or unverified models for a free provider, including its default", () => {
    const input = request();
    input.settings.strategy = "quality_first";
    input.settings.consumptionOptIn = true;
    input.role = { ...developer, candidates: [{ provider: "mixed" }] };
    expect(route(input)).toEqual({
      selected: { provider: "mixed", model: "free" },
      ranked: [{ provider: "mixed", model: "free" }],
      excluded: [
        { target: { provider: "mixed", model: "paid-default" }, reason: "funding_mismatch" },
        { target: { provider: "mixed", model: "unknown" }, reason: "funding_unknown" },
      ],
      strategy: "quality_first",
    });
    input.role = { ...developer, candidates: [{ provider: "mixed", model: "paid-default" }] };
    expect(route(input).selected).toBeNull();
  });

  it("requires both an opt-in and verified spend permission for consumption", () => {
    const input = request();
    input.settings.providers.mixed = { use: "primary", funding: "consumption" };
    expect(route(input).selected).toBeNull();
    input.settings.consumptionOptIn = true;
    const denied = { ...verified, funding: "consumption" as const };
    input.models = new Map([["mixed", new Map([["paid-default", denied]])]]);
    expect(route(input).excluded[0]?.reason).toBe("spend_not_authorized");
    input.models = new Map([["mixed", new Map([["paid-default", { ...denied, spendPermitted: true }]])]]);
    expect(route(input).selected).toEqual({ provider: "mixed", model: "paid-default" });
  });

  it("excludes exhausted, unconfirmed reset and reserved quota and uses an explicit unknown policy", () => {
    const input = request();
    input.catalog.providers = [provider("mixed", "reserve", "exhausted", "reset", "unknown")];
    input.models = new Map([["mixed", new Map([
      ["reserve", { ...verified, reservePct: 70 }],
      ["exhausted", { ...verified, quota: { status: "exhausted", remainingPct: 0 } }],
      ["reset", { ...verified, quota: { status: "reset", remainingPct: 0 } }],
      ["unknown", { ...verified, quota: undefined }],
    ])]]);
    expect(route(input).excluded.map(({ reason }) => reason)).toEqual([
      "quota_reserved", "quota_exhausted", "quota_reset_unconfirmed", "quota_unknown",
    ]);
    expect(route(input).selected).toBeNull();
    input.allowUnknownQuota = true;
    expect(route(input).selected?.model).toBe("unknown");
  });

  it("applies strategy order and stable ties without comparing raw cross-provider quotas", () => {
    const input = request({
      catalog: { providers: [provider("b", "model"), provider("a", "model")], generatedAt: "2026-11-26" },
      models: new Map([
        ["a", new Map([["model", { ...verified, quota: { status: "fresh", remainingPct: 50 } }]])],
        ["b", new Map([["model", { ...verified, quota: { status: "fresh", remainingPct: 90 }, quality: 2 }]])],
      ]),
      settings: { ...defaultSettings(), providers: { a: { use: "primary", funding: "free" }, b: { use: "primary", funding: "free" } } },
    });
    expect(route(input).selected?.provider).toBe("a");
    input.catalog.providers.reverse();
    expect(route(input).selected?.provider).toBe("a");
    input.settings.strategy = "quality_first";
    expect(route(input).selected?.provider).toBe("b");
    input.settings.strategy = "custom";
    input.role = { ...developer, candidates: [{ provider: "b" }, { provider: "a" }] };
    expect(route(input).selected?.provider).toBe("b");
    input.settings.providers.b = { use: "auxiliary", funding: "free" };
    expect(route(input).selected?.provider).toBe("a");
  });
});
