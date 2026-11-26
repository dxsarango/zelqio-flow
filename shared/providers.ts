import { z } from "zod";
import { defineZelqioRpc } from "./rpc";

/** Provider and model identifiers are opaque strings reported by Paseo; nothing here enumerates them. */
export const providerStatus = z.enum(["ready", "loading", "error", "unavailable"]);

export const catalogModel = z.object({
  id: z.string(),
  label: z.string(),
  isDefault: z.boolean(),
  /** False when Paseo marks the model as not selectable for new agents. */
  selectable: z.boolean(),
  thinkingOptions: z.array(z.object({ id: z.string(), label: z.string(), isDefault: z.boolean() })),
  defaultThinkingOptionId: z.string().optional(),
});

export const catalogProvider = z.object({
  id: z.string(),
  label: z.string(),
  status: providerStatus,
  enabled: z.boolean(),
  source: z.enum(["builtin", "custom"]).optional(),
  /** Message reported by Paseo for this provider; shown to the user, never hidden. */
  error: z.string().optional(),
  fetchedAt: z.string().optional(),
  models: z.array(catalogModel),
  modes: z.array(z.object({ id: z.string(), label: z.string() })),
  defaultModeId: z.string().optional(),
});

export const providerCatalog = z.object({
  providers: z.array(catalogProvider),
  generatedAt: z.string(),
  snapshotHash: z.string().optional(),
});

export type CatalogProvider = z.infer<typeof catalogProvider>;
export type ProviderCatalogData = z.infer<typeof providerCatalog>;

export const providersListRpc = defineZelqioRpc({
  name: "providers.list",
  input: z.object({}),
  data: providerCatalog,
});
