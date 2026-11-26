import { z } from "zod";
import { defineZelqioRpc } from "./rpc";

/** Maturity levels from the G0 decision. Only `foundation` is authorized today. */
export const maturityLevel = z.enum(["foundation", "advanced", "complete"]);

export const statusRpc = defineZelqioRpc({
  name: "status",
  input: z.object({}),
  data: z.object({
    name: z.literal("zelqio-flow"),
    version: z.string(),
    level: maturityLevel,
    effectsEnabled: z.boolean(),
  }),
});
