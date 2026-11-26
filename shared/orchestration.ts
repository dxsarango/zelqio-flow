import { defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

const metadataKey = "zelqio-flow.orchestration";
const optIn = z.strictObject({ version: z.literal(1), mode: z.literal("automatic") });

const draftMode = z.enum(["disabled", "automatic"]);
export type DraftOrchestration = z.infer<typeof draftMode>;

export const draftPreference = defineSettings({
  id: "draft-orchestration",
  scope: "host",
  version: 1,
  schema: z.strictObject({ remembered: draftMode.default("disabled") }),
});

/** Draft metadata records intent only. It does not authorize routing, spending or session management. */
export function draftOrchestration(metadata: Readonly<Record<string, unknown>>): DraftOrchestration {
  if (!Object.hasOwn(metadata, metadataKey)) return "disabled";
  const value = metadata[metadataKey];
  if (typeof value !== "object" || value === null || !Object.hasOwn(value, "version") || !Object.hasOwn(value, "mode")) {
    return "disabled";
  }
  return optIn.safeParse(value).success ? "automatic" : "disabled";
}

export function orchestrationMetadataPatch(mode: DraftOrchestration) {
  return { [metadataKey]: mode === "automatic" ? { version: 1, mode: "automatic" } as const : null };
}
