export const PLUGIN_VERSION = "0.0.0";

/** Read-only status. Automatic routing and the quota-aware run loop are on; Git, delivery modes and delegation are not yet. */
export function getStatus() {
  return { name: "zelqio-flow" as const, version: PLUGIN_VERSION, level: "advanced" as const, effectsEnabled: true };
}
