export type FailureKind = "quota" | "rate_limit" | "other";

export interface FailureSignal {
  kind: FailureKind;
  /** Epoch milliseconds when the provider says it will work again, when the message says so. */
  resetsAt?: number;
  /** True when the limit was inferred from the wording of a normal reply instead of a structured error. */
  heuristic?: boolean;
}

// Limit wording only. Billing, context-size and authentication problems are deliberately not here: they are not a
// quota that recovers, so they are reported as ordinary failures.
const QUOTA = [
  /usage limit/i, /limit (reached|exceeded|hit)/i, /(out of|exceeded your|insufficient) (credits?|quota|usage)/i,
  /quota (exceeded|exhausted|reached)/i, /you'?ve (hit|reached) your/i, /monthly (usage )?limit/i, /weekly limit/i,
  /5[- ]hour limit/i, /session limit/i,
];
const RATE = [/rate[- ]?limit/i, /too many requests/i, /\b429\b/, /overloaded/i, /temporarily unavailable/i];
const NOT_A_LIMIT = [/context (window|length)/i, /\b(invalid|expired) (api )?key\b/i, /unauthori[sz]ed/i, /authentication/i, /payment (failed|required)/i];
const QUOTA_CODE = /^(usage_limit|quota|insufficient_quota)/i;
const RATE_CODE = /^(rate_limit|too_many_requests|overloaded)/i;

const UNIT_MS: Record<string, number> = { second: 1000, minute: 60_000, hour: 3_600_000, day: 86_400_000 };
const MAX_HORIZON_MS = 7 * 86_400_000;

/** Reads "in 2 hours 15 minutes", "in 45m" or an ISO timestamp near a reset hint, up to a week ahead. */
function resetTime(text: string, now: number): number | undefined {
  const iso = /(?:reset|resets|retry|available|until)[^0-9]{0,24}(\d{4}-\d{2}-\d{2}T[0-9:.]+(?:Z|[+-]\d{2}:?\d{2})?)/i.exec(text);
  if (iso) {
    const time = Date.parse(iso[1]);
    if (Number.isFinite(time) && time > now && time - now <= MAX_HORIZON_MS) return time;
  }
  const relative = /(?:in|after)\s+((?:\d+\s*(?:d|days?|h|hours?|hrs?|m|min|minutes?|s|sec|seconds?)\s*(?:and\s*)?)+)/i.exec(text);
  if (!relative) return undefined;
  let total = 0;
  for (const [, amount, unit] of relative[1].matchAll(/(\d+)\s*(d|days?|h|hours?|hrs?|m|min|minutes?|s|sec|seconds?)/gi)) {
    const lower = unit.toLowerCase();
    const key = lower.startsWith("d") ? "day" : lower.startsWith("h") ? "hour" : lower.startsWith("m") ? "minute" : "second";
    total += Number(amount) * UNIT_MS[key];
  }
  return total > 0 && total <= MAX_HORIZON_MS ? now + total : undefined;
}

/**
 * Classifies a failed turn from the structured error Paseo reports. Anything that does not clearly look like a limit
 * is "other", so an ordinary failure is never retried or reassigned as if it were a quota problem.
 */
export function classifyFailure(message: string | null | undefined, now: number, code?: string | null): FailureSignal {
  const text = (message ?? "").slice(0, 2000);
  if (NOT_A_LIMIT.some(pattern => pattern.test(text))) return { kind: "other" };
  if (code && QUOTA_CODE.test(code)) return { kind: "quota", resetsAt: resetTime(text, now) };
  if (code && RATE_CODE.test(code)) return { kind: "rate_limit", resetsAt: resetTime(text, now) };
  if (QUOTA.some(pattern => pattern.test(text))) return { kind: "quota", resetsAt: resetTime(text, now) };
  if (RATE.some(pattern => pattern.test(text))) return { kind: "rate_limit", resetsAt: resetTime(text, now) };
  return { kind: "other" };
}

const MAX_LIMIT_REPLY = 400;

/**
 * Some providers (notably Claude through ACP) end the turn normally and put the limit notice in the last message.
 * A short reply with strong limit wording and no code is read as a limit; a long answer that only mentions limits is
 * a normal result. Returns null when the reply is an ordinary answer.
 */
export function limitFromReply(reply: string | null | undefined, now: number): FailureSignal | null {
  const text = (reply ?? "").trim();
  if (!text || text.length > MAX_LIMIT_REPLY || text.includes("```")) return null;
  const signal = classifyFailure(text, now);
  return signal.kind === "quota" ? { ...signal, heuristic: true } : null;
}

/** Removes obvious credentials before conversation text is passed to another provider. */
export function redactSecrets(text: string): string {
  return text
    .replace(/\b(sk|pk|rk)-[A-Za-z0-9_-]{16,}\b/g, "[redacted]")
    .replace(/\bgh[pousr]_[A-Za-z0-9]{20,}\b/g, "[redacted]")
    .replace(/\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, "[redacted]")
    .replace(/\bAKIA[0-9A-Z]{16}\b/g, "[redacted]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/gi, "Bearer [redacted]")
    .replace(/\b(api[_-]?key|secret|token|password)\s*[:=]\s*["']?[^\s"']{8,}/gi, "$1=[redacted]")
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, "[redacted]");
}
