import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import { describe, expect, it, vi } from "vitest";
import contribute from "../index.server";
import { routingPreviewRpc } from "../shared/routing-preview";
import { defaultSettings } from "../shared/settings";
import { createMockServer } from "./mock-sdk";

const claim = {
  provider: "fixture",
  model: "reviewed",
  funding: "free" as const,
  reviewedAt: "2020-01-01T00:00:00Z",
  expiresAt: "2099-01-01T00:00:00Z",
};
const request = { role: "developer", capability: "implement", models: [claim] } as const;

function fixture(funding: "free" | "consumption" = "free") {
  const create = vi.fn();
  const listUsage = vi.fn();
  const snapshot = vi.fn(async () => ({
    generatedAt: "2026-11-26T00:00:00Z",
    entries: [{
      provider: "fixture", enabled: true, status: "ready",
      models: [
        { id: "looks-free", label: "Free", isDefault: true },
        { id: "reviewed" },
        { id: "paid" },
        { id: "expired" },
        { id: "future" },
      ],
    }],
  }));
  const settings = {
    ...defaultSettings(),
    providers: { fixture: { use: "primary" as const, funding } },
    consumptionOptIn: true,
  };
  const mock = createMockServer({
    paseo: { providers: { snapshot, listUsage }, agents: { create } } as unknown as PluginHandlerContext["paseo"],
  }, () => ({ status: "ready", revision: "fixture", values: settings }));
  contribute(mock.server);
  return { mock, create, listUsage, snapshot };
}

describe("routing preview", () => {
  it("uses current catalog and preferences, excludes unknown and expired declarations and launches nothing", async () => {
    const { mock, create, listUsage } = fixture();
    const result = await mock.call(routingPreviewRpc, {
      ...request,
      models: [
        claim,
        { ...claim, model: "expired", expiresAt: "2021-01-01T00:00:00Z" },
        { ...claim, model: "future", reviewedAt: "2098-01-01T00:00:00Z" },
        { ...claim, model: "paid", funding: "consumption" },
        { ...claim, model: "absent" },
      ],
    });
    expect(result).toMatchObject({ ok: true, data: {
      status: "advisory", quota: "unbound", recommended: { provider: "fixture", model: "reviewed", declaredFunding: "free" },
      excluded: [
        { target: { model: "expired" }, reason: "funding_unknown" },
        { target: { model: "future" }, reason: "funding_unknown" },
        { target: { model: "looks-free" }, reason: "not_permitted" },
        { target: { model: "paid" }, reason: "funding_mismatch" },
      ],
    } });
    expect(create).not.toHaveBeenCalled();
    expect(listUsage).not.toHaveBeenCalled();
  });

  it("rejects contradictory duplicate declarations and unrecognized authority fields", async () => {
    const { mock, snapshot } = fixture();
    await expect(mock.call(routingPreviewRpc, { ...request, models: [claim, { ...claim, funding: "consumption" }] })).rejects.toBeDefined();
    await expect(mock.call(routingPreviewRpc, { ...request, models: [{ ...claim, spendPermitted: true }] } as never)).rejects.toBeDefined();
    expect(snapshot).not.toHaveBeenCalled();
  });

  it("returns no recommendation when a previously reviewed target is no longer available", async () => {
    const { mock, snapshot } = fixture();
    snapshot.mockResolvedValueOnce({ generatedAt: "2026-11-26T00:00:00Z", entries: [] });
    expect(await mock.call(routingPreviewRpc, { ...request, models: [claim] })).toMatchObject({ ok: true, data: { recommended: null } });
  });

  it("cannot recommend consumption even when host preferences opt in", async () => {
    const { mock } = fixture("consumption");
    expect(await mock.call(routingPreviewRpc, {
      ...request,
      models: [{ ...claim, funding: "consumption" }],
    })).toMatchObject({ ok: true, data: {
      recommended: null,
      excluded: expect.arrayContaining([{ target: { provider: "fixture", model: "reviewed" }, reason: "explicit_consumption_required" }]),
    } });
  });
});
