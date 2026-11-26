import { z } from "zod";

const metadataKey = "zelqio-flow.orchestration";
const optIn = z.strictObject({ version: z.literal(1), mode: z.literal("automatic") });
const marker = { version: 1, mode: "automatic" } as const;

export type DraftOrchestration = "disabled" | "automatic";

/** Draft metadata records intent only. It does not authorize routing, spending or session management. */
export function draftOrchestration(metadata: Readonly<Record<string, unknown>>): DraftOrchestration {
  return Object.hasOwn(metadata, metadataKey) && optIn.safeParse(metadata[metadataKey]).success ? "automatic" : "disabled";
}

export function orchestrationMetadataPatch(mode: DraftOrchestration) {
  return { [metadataKey]: mode === "automatic" ? marker : null };
}
