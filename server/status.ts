export const PLUGIN_VERSION = "0.0.0";

/** Read-only status. Foundation enables no effects (no routing, no Git, no delegation). */
export function getStatus() {
  return { name: "zelqio-flow" as const, version: PLUGIN_VERSION, level: "foundation" as const, effectsEnabled: false };
}
