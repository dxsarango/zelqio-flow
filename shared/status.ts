import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

/** Maturity levels from the G0 decision. Only `foundation` is authorized today. */
export const maturityLevel = z.enum(["foundation", "advanced", "complete"]);

export const statusRpc = defineRpc({
  name: "zelqio.status",
  input: z.object({}),
  output: z.object({
    name: z.literal("zelqio-flow"),
    version: z.string(),
    level: maturityLevel,
    effectsEnabled: z.boolean(),
  }),
});
