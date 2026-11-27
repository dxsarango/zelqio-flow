import { evidencePreviewInput, type EvidencePreviewInput, type EvidencePreviewProjection } from "../shared/evidence-preview";

type EvidenceItem = EvidencePreviewInput["evidence"][number];
type Check = EvidencePreviewInput["policy"]["checks"][number];

const resultPriority = { PASS: 0, NOT_RUN: 1, BLOCKED: 2, FAIL: 3 } satisfies Record<EvidenceItem["result"], number>;
const healthPriority = { healthy: 0, unknown: 1, unhealthy: 2 };

function checkKey(check: Pick<Check, "kind" | "command">): string {
  return `${check.kind}:${check.command}`;
}

function projectCheck(check: Check, items: EvidenceItem[], candidateSha: string, now: number): EvidencePreviewProjection["evidence"]["local"][number] {
  const current = items.filter(item => item.sha === candidateSha && Date.parse(item.date) <= now);
  const hasStaleEvidence = items.some(item => item.sha !== candidateSha);
  const strongest = current.reduce<EvidenceItem | undefined>((strongest, item) =>
    !strongest || resultPriority[item.result] > resultPriority[strongest.result] ? item : strongest,
  undefined);

  return {
    command: check.command,
    required: check.required,
    status: strongest?.result ?? (hasStaleEvidence ? "stale" : "unknown"),
    hasStaleEvidence,
    limitations: [...new Set(current.flatMap(item => item.limitations))].sort(),
  };
}

function projectPreview(input: EvidencePreviewInput, now: number): EvidencePreviewProjection["preview"] {
  let latest: { time: number; health: EvidencePreviewProjection["preview"]["health"] } | undefined;
  for (const observation of input.preview) {
    const time = Date.parse(observation.observedAt);
    if (time > now || (latest && time < latest.time)) continue;

    const health = observation.sha !== input.candidateSha || now - time >= input.policy.previewMaxAgeMs
      ? "stale" : observation.health;
    // The latest observation describes the current preview. Ties must never hide stale or adverse health.
    if (!latest || time > latest.time || health === "stale" ||
        (latest.health !== "stale" && healthPriority[health] > healthPriority[latest.health])) {
      latest = { time, health };
    }
  }

  return latest ? { health: latest.health, observedAt: new Date(latest.time).toISOString() }
    : { health: "unknown", observedAt: null };
}

/** Projects supplied observations only. The result describes readiness under the supplied policy. */
export function projectEvidencePreview(rawInput: unknown, clock: () => number): EvidencePreviewProjection {
  const parsed = evidencePreviewInput.safeParse(rawInput);
  if (!parsed.success) throw new Error("Invalid evidence preview input");

  const input = parsed.data;
  const now = clock();
  if (!Number.isFinite(now)) throw new Error("Invalid evidence preview clock");

  const byCheck = new Map<string, EvidenceItem[]>();
  for (const check of input.policy.checks) {
    const key = checkKey(check);
    if (byCheck.has(key)) throw new Error("Duplicate evidence preview check");
    byCheck.set(key, []);
  }
  for (const item of input.evidence) {
    const entries = byCheck.get(checkKey(item));
    if (!entries) throw new Error("Unregistered evidence preview check");
    entries.push(item);
  }

  const evidence: EvidencePreviewProjection["evidence"] = { local: [], ci: [] };
  for (const check of input.policy.checks) {
    evidence[check.kind].push(projectCheck(check, byCheck.get(checkKey(check)) ?? [], input.candidateSha, now));
  }
  const required = [...evidence.local, ...evidence.ci].filter(check => check.required);
  const preview = projectPreview(input, now);
  return {
    candidateSha: input.candidateSha,
    evidence,
    preview,
    ready: required.length > 0 && required.every(check => check.status === "PASS") &&
      (!input.policy.requireHealthyPreview || preview.health === "healthy"),
  };
}
