import { z } from "zod";
import { defineZelqioRpc } from "./rpc";

const usageStatus = z.enum(["fresh", "stale", "unknown", "exhausted", "reset"]);
const sourceStatus = z.enum(["available", "unavailable", "error"]);

const usageSnapshot = z.object({
  status: z.enum(["available", "unavailable"]),
  reports: z.array(z.object({
    sourceId: z.string(),
    status: sourceStatus,
    fetchedAt: z.string().nullable(),
    windows: z.array(z.object({
      id: z.string(),
      status: usageStatus,
      remainingPct: z.number().min(0).max(100).nullable(),
      resetsAt: z.string().nullable(),
      durationSeconds: z.number().positive().nullable(),
    })),
  })),
});

export type UsageSnapshot = z.infer<typeof usageSnapshot>;
export type UsageStatus = z.infer<typeof usageStatus>;
export const MAX_USAGE_AGE_MS = 5 * 60_000;

/** Cached percentages stop being current when their report expires, resets or can no longer be read. */
export function displayedUsageStatus(
  window: Pick<UsageSnapshot["reports"][number]["windows"][number], "status" | "resetsAt">,
  fetchedAt: string | null,
  available: boolean,
  now: number,
): UsageStatus {
  if (window.status !== "fresh" && window.status !== "exhausted" && window.status !== "stale") return window.status;
  if (window.resetsAt !== null && Date.parse(window.resetsAt) <= now) return "reset";
  const observed = fetchedAt === null ? NaN : Date.parse(fetchedAt);
  if (!available || !Number.isFinite(observed) || now - observed >= MAX_USAGE_AGE_MS) return "stale";
  return window.status;
}

export const usageListRpc = defineZelqioRpc({
  name: "usage.list",
  input: z.object({}),
  data: usageSnapshot,
});
