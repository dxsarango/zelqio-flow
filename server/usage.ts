import { z } from "zod";
import type { UsageSnapshot, UsageStatus } from "../shared/usage";

const READ_INTERVAL_MS = 30_000;
const MAX_AGE_MS = 5 * 60_000;
const MAX_BACKOFF_MS = 2 * 60_000;

const sdkUsage = z.object({
  fetchedAt: z.string().nullish(),
  providers: z.array(z.object({
    providerId: z.string(),
    status: z.enum(["available", "unavailable", "error"]),
    fetchedAt: z.string().nullish(),
    windows: z.array(z.object({
      id: z.string(),
      remainingPct: z.number().nullish(),
      resetsAt: z.string().nullish(),
      durationSeconds: z.number().nullish(),
    })).nullish(),
  })),
});
type SdkUsage = z.infer<typeof sdkUsage>;

function timestamp(value: string | null | undefined): number | null {
  const time = value == null ? NaN : Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

function reportTime(value: number | null): string | null {
  return value === null ? null : new Date(value).toISOString();
}

function classifyWindow(remaining: number | null, observed: number | null, resets: number | null, now: number, available: boolean): UsageStatus {
  if (remaining === null || observed === null || observed > now) return "unknown";
  if (resets !== null && resets <= now) return "reset";
  if (!available || now - observed >= MAX_AGE_MS) return "stale";
  return remaining === 0 ? "exhausted" : "fresh";
}

function present(snapshot: SdkUsage | undefined, now: number, available: boolean): UsageSnapshot {
  return {
    status: available ? "available" : "unavailable",
    // In Paseo 0.17.4 providerId identifies the source. Preserve duplicates without assigning them to accounts.
    reports: snapshot?.providers.map((report) => {
      const observed = timestamp(report.fetchedAt ?? snapshot.fetchedAt);
      return {
        sourceId: report.providerId,
        status: report.status,
        fetchedAt: reportTime(observed),
        windows: (report.windows ?? []).map((window) => {
          const resets = timestamp(window.resetsAt);
          const pct = window.remainingPct;
          const remaining = report.status === "available" && pct != null && pct >= 0 && pct <= 100 ? pct : null;
          return {
            id: window.id,
            status: classifyWindow(remaining, observed, resets, now, available),
            remainingPct: remaining,
            resetsAt: reportTime(resets),
            durationSeconds: window.durationSeconds != null && window.durationSeconds > 0 ? window.durationSeconds : null,
          };
        }),
      };
    }) ?? [],
  };
}

/** Cache the public usage projection per plugin instance. A read never initiates a provider refresh. */
export class UsageCache {
  private snapshot: SdkUsage | undefined;
  private available = false;
  private nextReadAt = -Infinity;
  private delay = READ_INTERVAL_MS;
  private pending: Promise<void> | undefined;

  constructor(private readonly now: () => number = Date.now) {}

  async read(fetch: () => Promise<unknown>): Promise<UsageSnapshot> {
    if (!this.pending && this.now() >= this.nextReadAt) {
      this.pending = this.refresh(fetch).finally(() => { this.pending = undefined; });
    }
    await this.pending;
    return present(this.snapshot, this.now(), this.available);
  }

  private async refresh(fetch: () => Promise<unknown>): Promise<void> {
    try {
      this.snapshot = sdkUsage.parse(await fetch());
      this.available = true;
      this.delay = READ_INTERVAL_MS;
      this.nextReadAt = this.now() + READ_INTERVAL_MS;
    } catch {
      this.available = false;
      this.nextReadAt = this.now() + this.delay;
      this.delay = Math.min(this.delay * 2, MAX_BACKOFF_MS);
    }
  }
}
