import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import { describe, expect, it, vi } from "vitest";
import contribute from "../index.server";
import { UsageCache } from "../server/usage";
import { providersListRpc } from "../shared/providers";
import { displayedUsageStatus, MAX_USAGE_AGE_MS, usageListRpc } from "../shared/usage";
import { createMockServer } from "./mock-sdk";

const start = Date.parse("2026-11-26T12:00:00Z");
const at = (offset = 0) => new Date(start + offset).toISOString();

function usageFixture(fetchedAt = at()) {
  return {
    fetchedAt,
    providers: [
      {
        providerId: "fixture",
        status: "available",
        windows: [
          { id: "session", remainingPct: 0, resetsAt: at(60_000), durationSeconds: 18_000 },
          { id: "weekly", remainingPct: 100 },
          { id: "unreported", remainingPct: null },
          { id: "out-of-range", remainingPct: 101 },
        ],
        details: [{ text: "private data" }],
      },
      { providerId: "fixture", status: "unavailable", windows: [], error: "private data" },
    ],
  };
}

describe("provider usage", () => {
  it("withdraws cached current percentages after a reset, stale report or failed refresh", () => {
    const cached = { status: "fresh", resetsAt: at(60_000) } as const;
    expect(displayedUsageStatus(cached, at(), true, start + 59_999)).toBe("fresh");
    expect(displayedUsageStatus(cached, at(), true, start + 60_000)).toBe("reset");
    expect(displayedUsageStatus(cached, at(), false, start + 10_000)).toBe("stale");
    expect(displayedUsageStatus({ status: "exhausted", resetsAt: null }, at(), true, start + MAX_USAGE_AGE_MS)).toBe("stale");
  });

  it("preserves source ambiguity and distinguishes exhausted, fresh and unknown windows", async () => {
    const cache = new UsageCache(() => start);
    const snapshot = await cache.read(async () => usageFixture());
    expect(snapshot.status).toBe("available");
    expect(snapshot.reports.map(({ sourceId }) => sourceId)).toEqual(["fixture", "fixture"]);
    expect(snapshot.reports[0]?.windows.map(({ status }) => status)).toEqual(["exhausted", "fresh", "unknown", "unknown"]);
    expect(snapshot.reports[0]?.windows[0]).toMatchObject({ remainingPct: 0, durationSeconds: 18_000 });
    expect(snapshot.reports[1]?.status).toBe("unavailable");
    expect(JSON.stringify(snapshot)).not.toContain("private data");
  });

  it("never infers replenishment from a reset and never refreshes the age of cached source data", async () => {
    let now = start;
    const cache = new UsageCache(() => now);
    const fetch = vi.fn(async () => usageFixture());
    await cache.read(fetch);
    now += 60_000;
    const afterReset = await cache.read(fetch);
    expect(afterReset.reports[0]?.windows[0]).toMatchObject({ status: "reset", remainingPct: 0 });
    now += 4 * 60_000;
    const old = await cache.read(fetch);
    expect(old.reports[0]?.windows[1]?.status).toBe("stale");
    const fresh = await new UsageCache(() => now).read(async () => usageFixture(at(now - start)));
    expect(fresh.reports[0]?.windows[1]?.status).toBe("fresh");
  });

  it("coalesces reads and backs off on failures while retaining stale data", async () => {
    let now = start;
    const cache = new UsageCache(() => now);
    const fetch = vi.fn<() => Promise<unknown>>()
      .mockResolvedValueOnce(usageFixture())
      .mockRejectedValueOnce(new Error("private error"))
      .mockRejectedValueOnce(new Error("private error"))
      .mockResolvedValue({ ...usageFixture(at(120_000)), providers: [] });
    await Promise.all([cache.read(fetch), cache.read(fetch)]);
    expect(fetch).toHaveBeenCalledTimes(1);
    now += 30_000;
    const failed = await cache.read(fetch);
    expect(failed.status).toBe("unavailable");
    expect(failed.reports[0]?.windows[1]?.status).toBe("stale");
    now += 30_000;
    await cache.read(fetch);
    now += 59_999;
    await cache.read(fetch);
    expect(fetch).toHaveBeenCalledTimes(3);
    now += 1;
    expect(await cache.read(fetch)).toEqual({ status: "available", reports: [] });
  });

  it("serves the public SDK projection and reloads the cache when a catalog hash changes", async () => {
    const listUsage = vi.fn(async () => usageFixture());
    const snapshot = vi.fn(async () => ({ entries: [], generatedAt: at(), snapshotHash: "changed" }));
    const mock = createMockServer({ paseo: { providers: { listUsage, snapshot } } as unknown as PluginHandlerContext["paseo"] });
    contribute(mock.server);
    expect(await mock.call(usageListRpc, {})).toMatchObject({ ok: true, data: { status: "available" } });
    await mock.call(usageListRpc, {});
    expect(listUsage).toHaveBeenCalledTimes(1);
    await mock.call(providersListRpc, {});
    await mock.call(usageListRpc, {});
    expect(listUsage).toHaveBeenCalledTimes(2);
  });
});
