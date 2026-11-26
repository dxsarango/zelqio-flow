import type { PluginServerContext } from "@getpaseo/plugin/server";
import { getStatus } from "./server/status";
import { statusRpc } from "./shared/status";

export default function contribute(server: PluginServerContext) {
  server.handle(statusRpc, getStatus);
  return () => {};
}
