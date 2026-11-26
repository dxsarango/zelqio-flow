import type { PluginServerContext } from "@getpaseo/plugin/server";
import { handleZelqio } from "./server/rpc";
import { getStatus } from "./server/status";
import { statusRpc } from "./shared/status";

export default function contribute(server: PluginServerContext) {
  handleZelqio(server, statusRpc, getStatus);
  return () => {};
}
