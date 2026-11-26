import { describe, expect, it } from "vitest";
import contribute from "../index.server";
import { normalizeSnapshot, readCatalog, type RawSnapshot } from "../server/providers";
import { providerCatalog, providersListRpc } from "../shared/providers";
import { createMockServer } from "./mock-sdk";

// Identifiers are arbitrary on purpose: the adapter must not depend on any specific provider or model name.
const snapshot: RawSnapshot = {
  generatedAt: "2026-01-01T00:00:00.000Z",
  snapshotHash: "h1",
  entries: [
    {
      provider: "alpha",
      label: "Alpha",
      status: "ready",
      enabled: true,
      source: "builtin",
      fetchedAt: "2026-01-01T00:00:00.000Z",
      defaultModeId: "m1",
      modes: [{ id: "m1", label: "Mode 1" }, { id: "m2" }],
      models: [
        { id: "x-1", label: "X One", isDefault: true, thinkingOptions: [{ id: "lo", label: "Low", isDefault: true }, { id: "hi" }], defaultThinkingOptionId: "lo" },
        { id: "x-1", label: "duplicate row" },
        { id: "x-2", isSelectable: false },
      ],
    },
    { provider: "beta", status: "error", enabled: true, error: "CLI not found" },
    { provider: "gamma", status: "unavailable", enabled: false },
    { provider: "delta", status: "loading", enabled: true, models: [] },
  ],
};

describe("provider catalog", () => {
  it("normalizes entries, defaults and optional fields", () => {
    const catalog = normalizeSnapshot(snapshot);
    const alpha = catalog.providers[0];
    expect(alpha).toMatchObject({ id: "alpha", label: "Alpha", status: "ready", enabled: true, source: "builtin", defaultModeId: "m1" });
    expect(alpha?.modes).toEqual([{ id: "m1", label: "Mode 1" }, { id: "m2", label: "m2" }]);
    expect(alpha?.models.map((m) => m.id)).toEqual(["x-1", "x-2"]);
    expect(alpha?.models[0]).toMatchObject({ label: "X One", isDefault: true, selectable: true, defaultThinkingOptionId: "lo" });
    expect(alpha?.models[0]?.thinkingOptions).toEqual([{ id: "lo", label: "Low", isDefault: true }, { id: "hi", label: "hi", isDefault: false }]);
    expect(alpha?.models[1]).toMatchObject({ label: "x-2", isDefault: false, selectable: false });
    expect(catalog.snapshotHash).toBe("h1");
    expect(providerCatalog.safeParse(catalog).success).toBe(true);
  });

  it("keeps provider errors and non-ready statuses visible", () => {
    const [, beta, gamma, delta] = normalizeSnapshot(snapshot).providers;
    expect(beta).toMatchObject({ status: "error", error: "CLI not found", models: [] });
    expect(gamma).toMatchObject({ status: "unavailable", enabled: false });
    expect(delta?.status).toBe("loading");
  });

  it("falls back to the provider id when there is no label", () => {
    expect(normalizeSnapshot(snapshot).providers[1]?.label).toBe("beta");
  });

  it("reports a failed read as a retryable unavailable error, not an empty catalog", async () => {
    await expect(
      readCatalog({
        snapshot: () => {
          throw new Error("socket closed C:/secret");
        },
      }),
    ).rejects.toMatchObject({ code: "unavailable", retryable: true, message: expect.not.stringContaining("secret") });
  });

  it("is served through the plugin entry using the Paseo snapshot", async () => {
    const paseo = { providers: { snapshot: async () => snapshot } } as never;
    const mock = createMockServer({ paseo });
    contribute(mock.server);
    const result = await mock.call(providersListRpc, {});
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.providers.map((p) => p.id)).toEqual(["alpha", "beta", "gamma", "delta"]);
  });

  it("returns a normalized error envelope when Paseo fails", async () => {
    const paseo = { providers: { snapshot: async () => Promise.reject(new Error("boom")) } } as never;
    const mock = createMockServer({ paseo });
    contribute(mock.server);
    expect(await mock.call(providersListRpc, {})).toEqual({
      ok: false,
      error: { code: "unavailable", message: "The provider catalog could not be read from Paseo.", retryable: true },
    });
  });
});
