import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import { ZelqioError } from "../shared/errors";
import type { CatalogProvider, ProviderCatalogData } from "../shared/providers";

/** The subset of Paseo's provider snapshot this adapter reads. Everything optional is treated as possibly absent. */
export interface RawModel {
  id: string;
  label?: string;
  isDefault?: boolean;
  isSelectable?: boolean;
  thinkingOptions?: Array<{ id: string; label?: string; isDefault?: boolean }>;
  defaultThinkingOptionId?: string;
}
export interface RawEntry {
  provider: string;
  label?: string;
  status: "ready" | "loading" | "error" | "unavailable";
  enabled: boolean;
  source?: "builtin" | "custom";
  error?: string;
  fetchedAt?: string;
  models?: RawModel[];
  modes?: Array<{ id: string; label?: string }>;
  defaultModeId?: string | null;
}
export interface RawSnapshot {
  entries: RawEntry[];
  generatedAt: string;
  snapshotHash?: string;
}

export interface SnapshotSource {
  snapshot(): Promise<RawSnapshot>;
}

/** Adapter over the Paseo SDK. Kept thin so the rest of the plugin never touches `paseo` directly. */
export function paseoSnapshotSource(paseo: PluginHandlerContext["paseo"]): SnapshotSource {
  return {
    snapshot: () => paseo.providers.snapshot() as unknown as Promise<RawSnapshot>,
  };
}

function normalizeEntry(entry: RawEntry): CatalogProvider {
  const seen = new Set<string>();
  const models = (entry.models ?? []).filter((m) => (seen.has(m.id) ? false : (seen.add(m.id), true)));
  return {
    id: entry.provider,
    label: entry.label ?? entry.provider,
    status: entry.status,
    enabled: entry.enabled,
    ...(entry.source ? { source: entry.source } : {}),
    ...(entry.error ? { error: entry.error } : {}),
    ...(entry.fetchedAt ? { fetchedAt: entry.fetchedAt } : {}),
    models: models.map((m) => ({
      id: m.id,
      label: m.label ?? m.id,
      isDefault: m.isDefault === true,
      selectable: m.isSelectable !== false,
      thinkingOptions: (m.thinkingOptions ?? []).map((o) => ({ id: o.id, label: o.label ?? o.id, isDefault: o.isDefault === true })),
      ...(m.defaultThinkingOptionId ? { defaultThinkingOptionId: m.defaultThinkingOptionId } : {}),
    })),
    modes: (entry.modes ?? []).map((m) => ({ id: m.id, label: m.label ?? m.id })),
    ...(entry.defaultModeId ? { defaultModeId: entry.defaultModeId } : {}),
  };
}

/** Pure normalization of a Paseo snapshot into the catalog Zelqio uses. Preserves provider errors and statuses. */
export function normalizeSnapshot(raw: RawSnapshot): ProviderCatalogData {
  return {
    providers: raw.entries.map(normalizeEntry),
    generatedAt: raw.generatedAt,
    ...(raw.snapshotHash ? { snapshotHash: raw.snapshotHash } : {}),
  };
}

/**
 * Reads the provider catalog through a snapshot source. A failed read is reported as a retryable `unavailable`
 * error, never as an empty catalog, so the UI can tell "no providers" from "could not read".
 */
export async function readCatalog(source: SnapshotSource): Promise<ProviderCatalogData> {
  let raw: RawSnapshot;
  try {
    raw = await source.snapshot();
  } catch {
    throw new ZelqioError("unavailable", "The provider catalog could not be read from Paseo.", { retryable: true });
  }
  return normalizeSnapshot(raw);
}
