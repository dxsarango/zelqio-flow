import { z } from "zod";
import { BUILTIN_ROLE_IDS, capability } from "./roles";
import { defineZelqioRpc } from "./rpc";
import { funding, strategy } from "./settings";

const target = z.strictObject({ provider: z.string().min(1).max(256), model: z.string().min(1).max(256) });
const declaredModel = target.extend({
  funding,
  declaredAt: z.iso.datetime({ offset: true }),
  expiresAt: z.iso.datetime({ offset: true }),
}).refine((entry) => Date.parse(entry.declaredAt) < Date.parse(entry.expiresAt), {
  message: "A model declaration must expire after it was made.",
});

export const routingPreviewInput = z.strictObject({
  role: z.enum(BUILTIN_ROLE_IDS),
  capability,
  models: z.array(declaredModel).max(100).refine((entries) =>
    new Set(entries.map(({ provider, model }) => JSON.stringify([provider, model]))).size === entries.length,
  { message: "A model can be declared once per provider." }),
});

export type RoutingPreviewInput = z.infer<typeof routingPreviewInput>;

export const routingPreviewRpc = defineZelqioRpc({
  name: "routing.preview",
  input: routingPreviewInput,
  data: z.strictObject({
    status: z.literal("advisory"),
    quota: z.literal("unbound"),
    strategy,
    recommended: target.extend({ declaredFunding: funding, quota: z.literal("unbound") }).nullable(),
    excluded: z.array(z.strictObject({ target, reason: z.string() })),
  }),
});
