import type { RpcOutput } from "@getpaseo/plugin";
import type { statusRpc } from "../shared/status";

export const PLUGIN_VERSION = "0.0.0";

/** Read-only status. Foundation enables no effects (no routing, no Git, no delegation). */
export function getStatus(): RpcOutput<typeof statusRpc> {
  return { name: "zelqio-flow", version: PLUGIN_VERSION, level: "foundation", effectsEnabled: false };
}
