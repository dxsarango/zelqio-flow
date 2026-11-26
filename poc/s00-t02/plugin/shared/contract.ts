// Disposable POC (S00-T02). Shared constants and contracts for client and server.
import { defineRpc, defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

/** Metadata key under which the draft opt-in and selection travel with the entity. */
export const META_KEY = "zelqioFlow";

export type Orchestration = "disabled" | "automatic";

/** The POC's fixed "routing decision". A real router would compute this; here it is a constant. */
export const POC_SELECTION = { provider: "opencode", model: "mimo-v2.6-flash-free", modeId: "plan" } as const;

/** Persistent opt-in default, stored by Paseo in the plugin's host settings directory. */
export const optInSettings = defineSettings({
  id: "optin",
  scope: "host",
  version: 1,
  schema: z.object({ orchestration: z.enum(["disabled", "automatic"]).default("disabled") }),
});

/** Client-to-daemon trace so UI events land in `paseo plugin logs`. */
export const traceRpc = defineRpc({
  name: "poc.trace",
  input: z.object({ event: z.string(), data: z.json().optional() }),
  output: z.object({ ok: z.boolean() }),
});
