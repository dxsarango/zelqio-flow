import type { PluginServerContext } from "@getpaseo/plugin/server";
import { paseoSnapshotSource, readCatalog } from "./server/providers";
import { handleZelqio } from "./server/rpc";
import { getStatus } from "./server/status";
import { providersListRpc } from "./shared/providers";
import { statusRpc } from "./shared/status";

export default function contribute(server: PluginServerContext) {
  handleZelqio(server, statusRpc, getStatus);
  handleZelqio(server, providersListRpc, (_input, { paseo }) => readCatalog(paseoSnapshotSource(paseo)));
  return () => {};
}
