import { describe, expect, it } from "vitest";
import { projectActivity } from "../server/activity-projection";
import { UsageCache } from "../server/usage";
import { MAX_USAGE_AGE_MS, type UsageSnapshot, type UsageStatus } from "../shared/usage";

const start = Date.parse("2026-11-26T12:00:00Z");
const iso = (time: number) => new Date(time).toISOString();
const maxActivityAgeMs = 30_000;
const activity = { state: "active", observedAt: start } as const;
const providers = [{ providerId: "fixture", activity, suspendedSince: start }];

function usage(status: UsageStatus, fetchedAt = start, resetsAt: string | null = null): UsageSnapshot {
  const remainingPct = status === "unknown" ? null : status === "exhausted" ? 0 : 75;
  return {
    status: "available",
    reports: [{
      sourceId: "fixture", status: "available", fetchedAt: iso(fetchedAt),
      windows: [{ id: "session", status, remainingPct, resetsAt, durationSeconds: null }],
    }],
  };
}

describe("local activity and quota projection", () => {
  it("shows observed activity and expires it independently of quota at the age limit", () => {
    const snapshot = usage("fresh");
    let now = start + maxActivityAgeMs - 1;
    const project = () => projectActivity({ providers, maxActivityAgeMs }, snapshot, () => now);
    expect(project()[0]?.activity).toEqual({
      state: "active", freshness: { status: "fresh", ageMs: maxActivityAgeMs - 1, maxAgeMs: maxActivityAgeMs },
    });
    now += 1;
    expect(project()[0]).toMatchObject({
      activity: { state: "unknown", freshness: { status: "stale", ageMs: maxActivityAgeMs } },
      quota: { state: "verified" },
    });
    now = start + MAX_USAGE_AGE_MS;
    expect(project()[0]).toMatchObject({
      quota: { state: "stale", freshness: { status: "stale", ageMs: MAX_USAGE_AGE_MS, maxAgeMs: MAX_USAGE_AGE_MS } },
      blockers: ["quota_stale"],
      reentry: "waiting_for_quota",
    });
  });

  it("preserves exhaustion and requires a new report after a window resets", () => {
    const resetsAt = start + 10_000;
    const snapshot = usage("exhausted", start, iso(resetsAt));
    const project = (now: number) => projectActivity({ providers, maxActivityAgeMs }, snapshot, () => now)[0];
    expect(project(resetsAt - 1)).toMatchObject({
      quota: { state: "exhausted" }, blockers: ["quota_exhausted"], reentry: "waiting_for_quota",
    });
    expect(project(resetsAt)).toMatchObject({
      quota: { state: "reset" }, blockers: ["quota_reset_unconfirmed"], reentry: "waiting_for_quota",
    });
  });

  it("projects a verified replenishment from a newer adapter observation", async () => {
    const now = start + 60_000;
    const snapshot = await new UsageCache(() => now).read(async () => ({
      fetchedAt: iso(now),
      providers: [{ providerId: "fixture", status: "available", windows: [{ id: "session", remainingPct: 75 }] }],
    }));
    expect(projectActivity({ providers, maxActivityAgeMs }, snapshot, () => now)[0]).toMatchObject({
      quota: { state: "verified", freshness: { status: "fresh", ageMs: 0 } },
      blockers: [],
      reentry: "eligible",
    });
    expect(projectActivity({ providers, maxActivityAgeMs }, usage("fresh"), () => now)[0]).toMatchObject({
      quota: { state: "verified" }, blockers: ["quota_reentry_unconfirmed"], reentry: "waiting_for_quota",
    });
  });

  it.each([
    ["an expired observation", usage("fresh", start + 1), start + 1 + MAX_USAGE_AGE_MS, "stale"],
    ["an unavailable snapshot", { ...usage("fresh", start + 1), status: "unavailable" }, start + 2, "stale"],
    ["a future observation", usage("fresh", start + 2), start + 1, "unknown"],
    ["an unreported window", usage("unknown", start + 1), start + 2, "unknown"],
    ["an explicitly stale window", usage("stale", start + 1), start + 2, "stale"],
    ["no matching source", { status: "available", reports: [] }, start + 2, "unknown"],
    ["duplicate sources", { status: "available", reports: [...usage("fresh", start + 1).reports, ...usage("fresh").reports] }, start + 2, "unknown"],
  ] satisfies Array<[string, UsageSnapshot, number, string]>)("keeps re-entry pending with %s", (_label, snapshot, now, state) => {
    expect(projectActivity({ providers, maxActivityAgeMs }, snapshot, () => now)[0]).toMatchObject({
      quota: { state }, blockers: [`quota_${state}`], reentry: "waiting_for_quota",
    });
  });

  it("requires every quota window to be current and positive", () => {
    const positive = usage("fresh", start + 1).reports[0];
    const exhausted = usage("exhausted", start + 1).reports[0].windows[0];
    const report = { ...positive, windows: [...positive.windows, { ...exhausted, id: "weekly" }] };
    const snapshot: UsageSnapshot = { status: "available", reports: [report] };
    expect(projectActivity({ providers, maxActivityAgeMs }, snapshot, () => start + 2)[0]).toMatchObject({
      quota: { state: "exhausted" }, reentry: "waiting_for_quota",
    });
  });

  it("keeps each provider's evidence separate", () => {
    const metadata = { providers: [...providers, { providerId: "other" }], maxActivityAgeMs };
    expect(projectActivity(metadata, usage("fresh", start + 1), () => start + 1)).toMatchObject([
      { providerId: "fixture", activity: { state: "active" }, quota: { state: "verified" }, reentry: "eligible" },
      { providerId: "other", activity: { state: "unknown" }, quota: { state: "unknown" }, reentry: "not_suspended" },
    ]);
  });

  it("returns only provider identifiers and projected status fields", () => {
    const [report] = usage("unknown").reports;
    const privateReport = { ...report, messages: ["private"], path: "private", token: "private" };
    const snapshot: UsageSnapshot = { status: "available", reports: [privateReport] };
    expect(projectActivity({ providers: [{ providerId: "fixture" }], maxActivityAgeMs }, snapshot, () => start)).toEqual([{
      providerId: "fixture",
      activity: {
        state: "unknown", freshness: { status: "unknown", ageMs: null, maxAgeMs: maxActivityAgeMs },
      },
      quota: { state: "unknown", freshness: { status: "fresh", ageMs: 0, maxAgeMs: MAX_USAGE_AGE_MS } },
      blockers: ["quota_unknown"],
      reentry: "not_suspended",
    }]);
    const privateActivity = { ...activity, conversation: "private" };
    expect(() => projectActivity({
      providers: [{ providerId: "fixture", activity: privateActivity }], maxActivityAgeMs,
    }, snapshot, () => start)).toThrow();
  });
});
