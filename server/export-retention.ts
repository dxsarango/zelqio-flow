import { z } from "zod";

const reference = z.string().regex(/^[A-Za-z0-9_.-]{1,128}$/);
const sha = z.string().regex(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/);
const timestamp = z.number().int().nonnegative();

/** Fields a manual export may carry. Anything else is dropped; an invalid value in an allowed field rejects the record. */
const exportable = z.strictObject({
  id: reference,
  verdict: z.enum(["PASS", "FAIL", "BLOCKED", "NOT_RUN"]),
  sha,
});
const EXPORT_VERSION = 1;

export type ExportResult = {
  version: typeof EXPORT_VERSION;
  records: Array<z.infer<typeof exportable>>;
  rejected: number;
};

/**
 * Builds a minimal manual export from fixtures. Locations, notes, messages and credentials never reach the output
 * because only the allowed fields are copied. This function writes nothing and sends nothing.
 */
export function exportFixtures(records: readonly unknown[]): ExportResult {
  const out: ExportResult = { version: EXPORT_VERSION, records: [], rejected: 0 };
  const seen = new Set<string>();
  for (const raw of records) {
    const candidate = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
    const parsed = exportable.safeParse({ id: candidate.id, verdict: candidate.verdict, sha: candidate.sha });
    if (!parsed.success || seen.has(parsed.data.id)) {
      out.rejected++;
      continue;
    }
    seen.add(parsed.data.id);
    out.records.push(parsed.data);
  }
  return out;
}

const retentionRecord = z.strictObject({
  id: reference,
  kind: reference,
  createdAt: timestamp,
  refs: z.array(reference).default([]),
});
const retentionInput = z.strictObject({
  records: z.array(retentionRecord),
  /** Records that active tasks, attempts, approvals or reviews still point to. */
  activeRefs: z.array(reference),
  maxAgeMs: z.record(reference, z.number().int().positive()),
  now: timestamp,
});

export type RetentionDecision = "keep_recent" | "keep_referenced" | "keep_unknown_kind" | "keep_future" | "eligible";
export type RetentionResult =
  | { status: "evaluated"; decisions: Array<{ id: string; decision: RetentionDecision }> }
  | { status: "blocked"; reason: "invalid" | "duplicate_id" };

/**
 * Simulates retention without deleting anything. A record is eligible only when its kind has a limit, it is older
 * than that limit and no active reference reaches it, directly or through other records. Cycles and dangling
 * references are tolerated. Doubt always keeps the record.
 */
export function evaluateRetention(input: z.input<typeof retentionInput>): RetentionResult {
  const parsed = retentionInput.safeParse(input);
  if (!parsed.success) return { status: "blocked", reason: "invalid" };
  const { records, activeRefs, maxAgeMs, now } = parsed.data;
  const byId = new Map(records.map(record => [record.id, record]));
  if (byId.size !== records.length) return { status: "blocked", reason: "duplicate_id" };

  const protectedIds = new Set<string>();
  const pending = [...activeRefs];
  for (let id = pending.pop(); id !== undefined; id = pending.pop()) {
    if (protectedIds.has(id)) continue;
    protectedIds.add(id);
    pending.push(...(byId.get(id)?.refs ?? []));
  }

  return {
    status: "evaluated",
    decisions: records.map(({ id, kind, createdAt }) => {
      const limit = maxAgeMs[kind];
      const decision: RetentionDecision = protectedIds.has(id) ? "keep_referenced"
        : limit === undefined ? "keep_unknown_kind"
        : createdAt > now ? "keep_future"
        : now - createdAt < limit ? "keep_recent"
        : "eligible";
      return { id, decision };
    }),
  };
}
