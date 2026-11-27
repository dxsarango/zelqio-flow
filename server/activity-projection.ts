import { z } from "zod";
import {
  displayedUsageStatus, MAX_USAGE_AGE_MS, type UsageSnapshot, type UsageStatus,
} from "../shared/usage";

const timestamp = z.int().nonnegative();
const providerObservation = z.strictObject({
  // Use a catalog provider identifier, which is also the usage source identifier for this view.
  providerId: z.string().min(1),
  activity: z.strictObject({
    state: z.enum(["active", "inactive", "interrupted", "obsolete", "unknown"]),
    observedAt: timestamp,
  }).optional(),
  suspendedSince: timestamp.optional(),
});

const activityMetadata = z.strictObject({
  providers: z.array(providerObservation),
  maxActivityAgeMs: z.int().positive(),
});
type ActivityMetadata = z.input<typeof activityMetadata>;

type Freshness = {
  status: "fresh" | "stale" | "unknown";
  ageMs: number | null;
  maxAgeMs: number;
};
type QuotaState = Exclude<UsageStatus, "fresh"> | "verified";
type UsageReport = UsageSnapshot["reports"][number];

const quotaBlocker = {
  unknown: "quota_unknown",
  stale: "quota_stale",
  exhausted: "quota_exhausted",
  reset: "quota_reset_unconfirmed",
} as const;

function freshness(observedAt: number | undefined, now: number, maxAgeMs: number): Freshness {
  if (observedAt === undefined || !Number.isSafeInteger(observedAt) || observedAt < 0 || observedAt > now) {
    return { status: "unknown", ageMs: null, maxAgeMs };
  }
  const ageMs = now - observedAt;
  return { status: ageMs < maxAgeMs ? "fresh" : "stale", ageMs, maxAgeMs };
}

function quotaState(report: UsageReport | undefined, available: boolean, observed: Freshness, now: number): QuotaState {
  if (!report?.windows.length || observed.status === "unknown") return "unknown";
  const states = report.windows.map((window): QuotaState => {
    const status = displayedUsageStatus(window, report.fetchedAt, available, now);
    if (status === "reset" || status === "unknown" || status === "stale") return status;
    // Reject incomplete or inconsistent observations before using a current quota signal.
    if (window.remainingPct === null || !Number.isFinite(window.remainingPct)
      || window.remainingPct < 0 || window.remainingPct > 100) return "unknown";
    if (status === "exhausted") return window.remainingPct === 0 ? "exhausted" : "unknown";
    return window.remainingPct > 0 ? "verified" : "unknown";
  });
  for (const state of ["exhausted", "reset", "stale", "unknown"] as const) {
    if (states.includes(state)) return state;
  }
  return "verified";
}

/**
 * Projects caller-normalized activity and adapter usage for the listed providers.
 * Re-entry describes source-level quota evidence. Account, model and authorization checks belong to the caller.
 */
export function projectActivity(metadata: ActivityMetadata, usage: UsageSnapshot, clock: () => number) {
  const { providers, maxActivityAgeMs } = activityMetadata.parse(metadata);
  const now = timestamp.parse(clock());
  const reports = new Map<string, UsageReport | null>();
  for (const report of usage.reports) {
    reports.set(report.sourceId, reports.has(report.sourceId) ? null : report);
  }

  return providers.map(({ providerId, activity, suspendedSince }) => {
    const activityFreshness = freshness(activity?.observedAt, now, maxActivityAgeMs);
    const activityState = activity && activityFreshness.status === "fresh" ? activity.state : "unknown";
    const report = reports.get(providerId) ?? undefined;
    const observedAt = report?.fetchedAt == null ? undefined : Date.parse(report.fetchedAt);
    const reportFreshness = freshness(observedAt, now, MAX_USAGE_AGE_MS);
    const available = usage.status === "available" && report?.status === "available";
    const quota = quotaState(report, available, reportFreshness, now);
    const quotaFreshness: Freshness = reportFreshness.status === "fresh" && (!available || quota === "stale")
      ? { ...reportFreshness, status: "stale" }
      : reportFreshness;
    const restored = quota === "verified" && observedAt !== undefined && suspendedSince !== undefined
      && observedAt > suspendedSince;
    const reentry = suspendedSince === undefined ? "not_suspended"
      : restored ? "eligible" : "waiting_for_quota";
    const blocker = quota !== "verified" ? quotaBlocker[quota]
      : reentry === "waiting_for_quota" ? "quota_reentry_unconfirmed" : null;

    return {
      providerId,
      activity: { state: activityState, freshness: activityFreshness },
      quota: { state: quota, freshness: quotaFreshness },
      blockers: blocker === null ? [] : [blocker],
      reentry,
    };
  });
}
