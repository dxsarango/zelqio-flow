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

export const usageListRpc = defineZelqioRpc({
  name: "usage.list",
  input: z.object({}),
  data: usageSnapshot,
});
