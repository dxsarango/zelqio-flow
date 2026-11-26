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
    const input = request({ requestedFunding: "consumption" });
    input.settings.providers.mixed = { use: "primary", funding: "consumption" };
    expect(route(input).selected).toBeNull();
    input.settings.consumptionOptIn = true;
    const denied = { ...verified, funding: "consumption" as const };
    input.models = new Map([["mixed", new Map([["paid-default", denied]])]]);
    expect(route(input).excluded).toContainEqual({
      target: { provider: "mixed", model: "paid-default" }, reason: "spend_not_authorized",
    });
    input.models = new Map([["mixed", new Map([["paid-default", { ...denied, spendPermitted: true }]])]]);
    expect(route(input).selected).toEqual({ provider: "mixed", model: "paid-default" });
  });

  it("keeps a free retry within its original funding even if an auxiliary paid provider is authorized", () => {
    const input = request({
      catalog: { providers: [provider("free", "model"), provider("paid", "model")], generatedAt: "2026-11-26" },
      models: new Map([
      ["free", new Map<string, RoutingModelFacts>([["model", { ...verified, quota: { status: "exhausted", remainingPct: 0 } }]])],
      ["paid", new Map<string, RoutingModelFacts>([["model", { ...verified, funding: "consumption", spendPermitted: true }]])],
      ]),
      settings: {
        ...defaultSettings(), consumptionOptIn: true,
        providers: { free: { use: "primary", funding: "free" }, paid: { use: "auxiliary", funding: "consumption" } },
      },
      continuity: { provider: "free", model: "model" },
    });
    expect(route(input).selected).toBeNull();
    expect(route({ ...input, requestedFunding: "free" }).selected).toBeNull();
    expect(route({ ...input, requestedFunding: "consumption" }).selected).toEqual({ provider: "paid", model: "model" });
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
      "quota_exhausted", "quota_reserved", "quota_reset_unconfirmed", "quota_unknown",
    ]);
    expect(route(input).selected).toBeNull();
    input.allowUnknownQuota = true;
    expect(route(input).selected?.model).toBe("unknown");
  });

  it("requires fresh evidence newer than the suspension before re-entry", () => {
    const input = request({ allowUnknownQuota: true });
    const setReport = (quota: RoutingModelFacts["quota"]) => {
      input.models = new Map([["mixed", new Map([["free", { ...verified, suspendedSince: 50, quota }]])]]);
    };
    setReport({ status: "reset", remainingPct: 0, observedAt: 45 });
    expect(route(input).selected).toBeNull();
    setReport(undefined);
    expect(route(input).selected).toBeNull();
    setReport({ status: "fresh", remainingPct: 100, observedAt: 50 });
    expect(route(input).selected).toBeNull();
    setReport({ status: "fresh", remainingPct: 100, observedAt: 51 });
    expect(route(input).selected?.model).toBe("free");
  });

  it("ranks fresh evidence ahead of unknown and distinguishes stale zero from confirmed exhaustion", () => {
    const input = request({
      allowUnknownQuota: true,
      catalog: { providers: [provider("a", "unknown", "stale"), provider("b", "fresh")], generatedAt: "2026-11-26" },
      settings: { ...defaultSettings(), providers: { a: { use: "primary", funding: "free" }, b: { use: "auxiliary", funding: "free" } } },
      models: new Map([
      ["a", new Map<string, RoutingModelFacts>([["unknown", { ...verified, quota: undefined }], ["stale", { ...verified, quota: { status: "stale", remainingPct: 0 } }]])],
        ["b", new Map([["fresh", verified]])],
      ]),
    });
    expect(route(input).selected?.model).toBe("fresh");
    expect(route(input).excluded).toContainEqual({ target: { provider: "a", model: "stale" }, reason: "quota_unknown" });
  });

  it("requires compatible role capability and permission on the exact model", () => {
    const input = request({ capability: "review" });
    expect(route(input).excluded.every(({ reason }) => reason === "outside_role")).toBe(true);
    input.capability = "implement";
    input.models = new Map([["mixed", new Map([["free", { ...verified, permitted: false }]])]]);
    expect(route(input).excluded.every(({ reason }) => reason === "not_permitted")).toBe(true);
  });

  it("rejects ambiguous catalog entries and produces the same trace when they are reordered", () => {
    const input = request();
    const duplicate = { ...provider("mixed", "free"), enabled: false };
    input.catalog.providers.push(duplicate);
    const first = route(input);
    expect(first.selected).toBeNull();
    expect(first.excluded.every(({ reason }) => reason === "ambiguous_catalog")).toBe(true);
    input.catalog.providers.reverse();
    expect(route(input)).toEqual(first);
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
