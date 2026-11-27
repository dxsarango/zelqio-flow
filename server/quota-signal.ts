export type FailureKind = "quota" | "rate_limit" | "other";

export interface FailureSignal {
  kind: FailureKind;
  /** Epoch milliseconds when the provider says it will work again, when the message says so. */
  resetsAt?: number;
}

const QUOTA = [
  /usage limit/i, /limit (reached|exceeded|hit)/i, /(out of|exceeded your|insufficient) (credits?|quota|usage)/i,
  /quota (exceeded|exhausted|reached)/i, /you'?ve (hit|reached) your/i, /monthly (usage )?limit/i, /weekly limit/i,
  /5[- ]hour limit/i, /\bcredit balance\b/i, /billing/i,
];
const RATE = [/rate[- ]?limit/i, /too many requests/i, /\b429\b/, /overloaded/i, /temporarily unavailable/i];

const UNIT_MS: Record<string, number> = { second: 1000, minute: 60_000, hour: 3_600_000, day: 86_400_000 };

/** Reads "in 2 hours 15 minutes", "in 45m" or an ISO timestamp near a reset hint. */
function resetTime(text: string, now: number): number | undefined {
  const iso = /(?:reset|resets|retry|available|until)[^0-9]{0,24}(\d{4}-\d{2}-\d{2}T[0-9:.]+(?:Z|[+-]\d{2}:?\d{2})?)/i.exec(text);
  if (iso) {
    const time = Date.parse(iso[1]);
    if (Number.isFinite(time) && time > now) return time;
  }
  const relative = /(?:in|after)\s+((?:\d+\s*(?:d|days?|h|hours?|hrs?|m|min|minutes?|s|sec|seconds?)\s*(?:and\s*)?)+)/i.exec(text);
  if (!relative) return undefined;
  let total = 0;
  for (const [, amount, unit] of relative[1].matchAll(/(\d+)\s*(d|days?|h|hours?|hrs?|m|min|minutes?|s|sec|seconds?)/gi)) {
    const key = unit.toLowerCase().startsWith("d") ? "day" : unit.toLowerCase().startsWith("h") ? "hour"
      : unit.toLowerCase().startsWith("m") ? "minute" : "second";
    total += Number(amount) * UNIT_MS[key];
  }
  return total > 0 ? now + total : undefined;
}

/**
 * Classifies a failed agent from the error text Paseo reports. Anything that does not clearly look like a limit is
 * "other", so an ordinary failure is never retried or reassigned as if it were a quota problem.
 */
export function classifyFailure(message: string | null | undefined, now: number): FailureSignal {
  const text = (message ?? "").slice(0, 2000);
  if (QUOTA.some(pattern => pattern.test(text))) return { kind: "quota", resetsAt: resetTime(text, now) };
  if (RATE.some(pattern => pattern.test(text))) return { kind: "rate_limit", resetsAt: resetTime(text, now) };
  return { kind: "other" };
}
