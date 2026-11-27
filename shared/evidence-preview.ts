import { z } from "zod";

const sha = z.string().refine(value =>
  (value.length === 40 || value.length === 64) && !/[^0-9a-f]/.test(value) && /[1-9a-f]/.test(value),
);
const timestamp = z.iso.datetime({ offset: true }).refine(value => Number.isFinite(Date.parse(value)));
const result = z.enum(["PASS", "FAIL", "BLOCKED", "NOT_RUN"]);
const limitation = z.enum(["synthetic", "partial_coverage", "environment_unavailable"]);
const checkIdentity = {
  kind: z.enum(["local", "ci"]),
  command: z.string().trim().min(1).max(120).regex(/^[\w .()-]+$/),
};
const evidenceItem = z.strictObject({
  ...checkIdentity,
  result,
  sha,
  date: z.union([z.iso.date(), timestamp]),
  limitations: z.array(limitation),
});
const observedHealth = z.enum(["healthy", "unhealthy", "unknown"]);
const previewObservation = z.strictObject({ health: observedHealth, sha, observedAt: timestamp });

export const evidencePreviewInput = z.strictObject({
  candidateSha: sha,
  evidence: z.array(evidenceItem),
  preview: z.array(previewObservation),
  policy: z.strictObject({
    // Use caller-approved display labels. Evidence readers map raw commands to these labels.
    checks: z.array(z.strictObject({ ...checkIdentity, required: z.boolean() })),
    requireHealthyPreview: z.boolean(),
    previewMaxAgeMs: z.int().positive(),
  }),
});

export type EvidencePreviewInput = z.infer<typeof evidencePreviewInput>;

interface ProjectedCheck {
  command: string;
  required: boolean;
  status: z.infer<typeof result> | "stale" | "unknown";
  hasStaleEvidence: boolean;
  limitations: z.infer<typeof limitation>[];
}

export interface EvidencePreviewProjection {
  candidateSha: string;
  evidence: { local: ProjectedCheck[]; ci: ProjectedCheck[] };
  preview: {
    health: z.infer<typeof observedHealth> | "stale";
    observedAt: string | null;
  };
  ready: boolean;
}
