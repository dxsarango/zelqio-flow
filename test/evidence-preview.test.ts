import { describe, expect, it } from "vitest";
import { projectEvidencePreview } from "../server/evidence-preview";
import type { EvidencePreviewInput } from "../shared/evidence-preview";

const sha = "a".repeat(40);
const otherSha = "b".repeat(40);
const observedAt = "2026-01-01T12:00:00.000Z";
const now = Date.parse(observedAt);
const clock = () => now;
const localPass = { kind: "local", command: "npm run check", result: "PASS", sha, date: "2026-01-01", limitations: [] } as const;
const ciPass = { ...localPass, kind: "ci" } as const;
const healthy = { health: "healthy", sha, observedAt } as const;

function input(overrides: Partial<EvidencePreviewInput> = {}): EvidencePreviewInput {
  return {
    candidateSha: sha,
    evidence: [{ ...localPass, limitations: [] }, { ...ciPass, limitations: [] }],
    preview: [healthy],
    policy: {
      checks: [
        { kind: "local", command: localPass.command, required: true },
        { kind: "ci", command: ciPass.command, required: true },
      ],
      requireHealthyPreview: true,
      previewMaxAgeMs: 60_000,
    },
    ...overrides,
  };
}

describe("projectEvidencePreview", () => {
  it("requires exact-SHA PASS for each configured source", () => {
    expect(projectEvidencePreview(input(), clock)).toMatchObject({ candidateSha: sha, ready: true });

    const data = input();
    data.evidence[1].sha = otherSha;
    expect(projectEvidencePreview(data, clock)).toMatchObject({
      evidence: { local: [{ status: "PASS" }], ci: [{ status: "stale", hasStaleEvidence: true }] },
      ready: false,
    });
    data.evidence.pop();
    expect(projectEvidencePreview(data, clock)).toMatchObject({ evidence: { ci: [{ status: "unknown" }] }, ready: false });
  });

  it("collapses duplicates and keeps a FAIL visible even after a newer PASS", () => {
    const data = input();
    const [pass] = data.evidence;
    data.evidence.push({ ...pass }, { ...pass, sha: otherSha, result: "PASS" });
    expect(projectEvidencePreview(data, clock).evidence.local).toMatchObject([{ status: "PASS", hasStaleEvidence: true }]);

    const fail = { ...pass, result: "FAIL", date: "2025-12-31", limitations: ["partial_coverage"] } as const;
    data.evidence.unshift({ ...fail, limitations: [...fail.limitations] });
    expect(projectEvidencePreview(data, clock)).toMatchObject({
      evidence: { local: [{ status: "FAIL", limitations: ["partial_coverage"] }], ci: [{ status: "PASS" }] },
      ready: false,
    });
  });

  it.each(["NOT_RUN", "BLOCKED"] as const)("does not count %s as a pass", result => {
    const data = input();
    data.evidence.push({ ...data.evidence[0], result });
    expect(projectEvidencePreview(data, clock)).toMatchObject({ evidence: { local: [{ status: result }] }, ready: false });
  });

  it("leaves readiness false when required evidence is unspecified", () => {
    const data = input();
    data.policy.checks.forEach(check => { check.required = false; });
    expect(projectEvidencePreview(data, clock).ready).toBe(false);
  });

  it("expires preview health at the freshness boundary", () => {
    const data = input();
    expect(projectEvidencePreview(data, () => now + data.policy.previewMaxAgeMs - 1).preview.health).toBe("healthy");
    expect(projectEvidencePreview(data, () => now + data.policy.previewMaxAgeMs)).toMatchObject({
      preview: { health: "stale", observedAt }, ready: false,
    });
  });

  it("marks the preview stale when a newer observation belongs to another SHA", () => {
    const newer = { ...healthy, sha: otherSha, observedAt: "2026-01-01T12:00:01.000Z" };
    expect(projectEvidencePreview(input({ preview: [newer, healthy] }), () => now + 1000)).toMatchObject({
      preview: { health: "stale", observedAt: newer.observedAt }, ready: false,
    });
  });

  it("handles absent, future, and conflicting observations conservatively", () => {
    expect(projectEvidencePreview(input({ preview: [] }), clock)).toMatchObject({
      preview: { health: "unknown", observedAt: null }, ready: false,
    });
    expect(projectEvidencePreview(input(), () => now - 1).preview.health).toBe("unknown");
    const unhealthy = { ...healthy, health: "unhealthy" } as const;
    expect(projectEvidencePreview(input({ preview: [unhealthy, healthy] }), clock)).toMatchObject({
      preview: { health: "unhealthy" }, ready: false,
    });
  });

  it("permits evidence-only readiness when policy does not require a preview", () => {
    const data = input({ preview: [] });
    data.policy.requireHealthyPreview = false;
    expect(projectEvidencePreview(data, clock)).toMatchObject({ preview: { health: "unknown" }, ready: true });
  });

  it.each(["a".repeat(7), "A".repeat(40), "0".repeat(40), `${sha}\n`])("rejects invalid SHA %j", candidateSha => {
    expect(() => projectEvidencePreview(input({ candidateSha }), clock)).toThrow(/^Invalid evidence preview input$/);
  });

  it("rejects disallowed fields and free text without reflecting their names or values", () => {
    const data = input();
    for (const invalid of [
      { ...data, preview: [{ ...healthy, url: "https://example.invalid" }] },
      { ...data, evidence: [{ ...data.evidence[0], notes: "sample conversation" }] },
      { ...data, evidence: [{ ...data.evidence[0], limitations: ["sample conversation"] }] },
      { ...data, evidence: [{ ...data.evidence[0], command: "C:/example/check" }] },
    ]) {
      expect(() => projectEvidencePreview(invalid, clock)).toThrow(/^Invalid evidence preview input$/);
    }
    const unregistered = { ...data.evidence[0], command: "sample conversation" };
    expect(() => projectEvidencePreview(input({ evidence: [unregistered] }), clock)).toThrow(/^Unregistered evidence preview check$/);
  });
});
