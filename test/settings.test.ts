import { describe, expect, it, vi } from "vitest";
import type { CatalogProvider, ProviderCatalogData } from "../shared/providers";
import {
  buildSummary,
  defaultSettings,
  elevatedChoices,
  hasErrors,
  migrateSettings,
  validateSettings,
  zelqioSettings,
  zelqioSettingsDefinition,
  type ZelqioSettings,
} from "../shared/settings";
import { registerZelqioSettings } from "../server/settings";

function provider(id: string, over: Partial<CatalogProvider> = {}): CatalogProvider {
  return { id, label: `Label ${id}`, status: "ready", enabled: true, models: [], modes: [], ...over };
}
const catalog = (...providers: CatalogProvider[]): ProviderCatalogData => ({ providers, generatedAt: "2026-01-01T00:00:00Z" });
const settings = (over: Partial<ZelqioSettings> = {}): ZelqioSettings => ({ ...defaultSettings(), onboardingCompleted: true, ...over });
const codes = (s: ZelqioSettings, c: ProviderCatalogData) => validateSettings(s, c).map((i) => `${i.code}${i.provider ? `:${i.provider}` : ""}`);

describe("defaults", () => {
  it("record no providers and deny remote authorization", () => {
    expect(defaultSettings()).toEqual({
      onboardingCompleted: false,
      providers: {},
      consumptionOptIn: false,
      strategy: "balanced",
      mode: "review_first",
      git: { workflow: "local_only" },
      remoteAuthorization: "denied",
    });
  });

  it("are what an empty stored document parses to", () => {
    expect(zelqioSettings.parse({})).toEqual(defaultSettings());
  });

  it("rejects unknown keys and unknown enum values", () => {
    expect(zelqioSettings.safeParse({ extra: 1 }).success).toBe(false);
    expect(zelqioSettings.safeParse({ mode: "yolo" }).success).toBe(false);
    expect(zelqioSettings.safeParse({ remoteAuthorization: "allowed" }).success).toBe(false);
  });
});

describe("validateSettings", () => {
  it("accepts exactly one usable provider", () => {
    const s = settings({ providers: { alpha: { use: "primary", funding: "subscription" } } });
    expect(hasErrors(validateSettings(s, catalog(provider("alpha"))))).toBe(false);
  });

  it("accepts several providers, primary and auxiliary", () => {
    const s = settings({
      providers: { a: { use: "primary", funding: "subscription" }, b: { use: "auxiliary", funding: "free" }, c: { use: "auxiliary", funding: "local" } },
    });
    expect(hasErrors(validateSettings(s, catalog(provider("a"), provider("b"), provider("c"))))).toBe(false);
  });

  it("requires a provider and a primary once onboarding is completed", () => {
    expect(codes(settings(), catalog(provider("a")))).toContain("no_provider");
    expect(codes(settings({ providers: { a: { use: "auxiliary", funding: "free" } } }), catalog(provider("a")))).toContain("no_primary");
    expect(codes({ ...defaultSettings() }, catalog(provider("a")))).not.toContain("no_provider");
  });

  it("rejects consumption funding without the explicit opt-in, and accepts it with one", () => {
    const s = settings({ providers: { a: { use: "primary", funding: "consumption" } } });
    expect(codes(s, catalog(provider("a")))).toEqual(["consumption_requires_opt_in:a"]);
    expect(zelqioSettings.safeParse(s).success).toBe(false);
    const optedIn = { ...s, consumptionOptIn: true };
    expect(hasErrors(validateSettings(optedIn, catalog(provider("a"))))).toBe(false);
    expect(zelqioSettings.safeParse(optedIn).success).toBe(true);
  });

  it("ignores consumption funding on a provider that is switched off", () => {
    const s = settings({ providers: { a: { use: "primary", funding: "subscription" }, b: { use: "off", funding: "consumption" } } });
    expect(hasErrors(validateSettings(s, catalog(provider("a"), provider("b"))))).toBe(false);
    expect(zelqioSettings.safeParse(s).success).toBe(true);
  });

  it("flags a provider that disappeared and keeps the selection untouched", () => {
    const s = settings({ providers: { gone: { use: "primary", funding: "subscription" } } });
    const c = catalog(provider("other"), provider("paid"));
    expect(codes(s, c)).toEqual(["provider_missing:gone"]);
    expect(s.providers).toEqual({ gone: { use: "primary", funding: "subscription" } });
    expect(buildSummary(s, c).providers.map((p) => p.id)).toEqual(["gone"]);
  });

  it("flags providers that are not ready or disabled, never swapping in another", () => {
    const s = settings({ providers: { a: { use: "primary", funding: "free" }, b: { use: "auxiliary", funding: "local" } } });
    const c = catalog(provider("a", { status: "error", error: "boom" }), provider("b", { enabled: false }), provider("ready"));
    expect(codes(s, c)).toEqual(["provider_not_ready:a", "provider_disabled:b"]);
  });

  it("warns, without blocking, when an elevated mode cannot take effect", () => {
    const base = { providers: { a: { use: "primary" as const, funding: "subscription" as const } } };
    const c = catalog(provider("a"));
    const local = validateSettings(settings({ ...base, mode: "auto_merge" }), c);
    expect(local.map((i) => i.code)).toEqual(["mode_effect_inactive"]);
    expect(hasErrors(local)).toBe(false);
    const denied = settings({ ...base, mode: "autopilot", git: { workflow: "pull_request" } });
    expect(codes(denied, c)).toEqual(["remote_denied", "mode_effect_inactive"]);
    const granted = settings({ ...base, mode: "autopilot", git: { workflow: "pull_request" }, remoteAuthorization: "per_project" });
    expect(codes(granted, c)).toEqual([]);
  });
});

describe("elevatedChoices", () => {
  it("lists elevated modes and consumption funding", () => {
    expect(elevatedChoices(settings())).toEqual([]);
    const s = settings({ mode: "autopilot", consumptionOptIn: true, providers: { a: { use: "primary", funding: "consumption" } } });
    expect(elevatedChoices(s)).toEqual(["autopilot", "consumption"]);
  });
});

describe("buildSummary", () => {
  it("describes selected providers, choices and the inactive effects", () => {
    const s = settings({
      strategy: "economy",
      mode: "smart_review",
      git: { workflow: "fork" },
      providers: { a: { use: "primary", funding: "subscription" }, b: { use: "auxiliary", funding: "local" }, c: { use: "off", funding: "free" } },
    });
    const summary = buildSummary(s, catalog(provider("a"), provider("b", { status: "loading" }), provider("c")));
    expect(summary.providers).toEqual([
      { id: "a", label: "Label a", use: "primary", funding: "subscription", usable: true },
      { id: "b", label: "Label b", use: "auxiliary", funding: "local", usable: false },
    ]);
    expect(summary).toMatchObject({ strategy: "economy", mode: "smart_review", workflow: "fork", remoteAuthorization: "denied", elevated: [], effectsActive: false });
    expect(summary.issues.map((i) => i.code)).toEqual(["provider_not_ready", "remote_denied"]);
  });
});

describe("migration stub", () => {
  it("passes a version 1 object through and falls back to defaults for unknown shapes", () => {
    const stored = { mode: "smart_review" };
    expect(migrateSettings(stored, 1)).toBe(stored);
    expect(migrateSettings("nope", 1)).toEqual(defaultSettings());
    expect(migrateSettings(stored, 0)).toEqual(defaultSettings());
    expect(zelqioSettingsDefinition).toMatchObject({ id: "general", scope: "host", version: 1 });
  });
});

describe("registerZelqioSettings", () => {
  it("registers the host-scoped definition with the SDK and nothing else", () => {
    const registerSettings = vi.fn();
    registerZelqioSettings({ registerSettings } as never);
    expect(registerSettings).toHaveBeenCalledExactlyOnceWith(zelqioSettingsDefinition);
  });
});
