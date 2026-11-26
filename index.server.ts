import type { PluginServerContext } from "@getpaseo/plugin/server";
import { paseoSnapshotSource, readCatalog } from "./server/providers";
import { handleZelqio } from "./server/rpc";
import { resolveRoles } from "./server/roles";
import { registerZelqioSettings } from "./server/settings";
import { getStatus } from "./server/status";
import { providersListRpc } from "./shared/providers";
import { rolesListRpc } from "./shared/roles";
import { statusRpc } from "./shared/status";

export default function contribute(server: PluginServerContext) {
  registerZelqioSettings(server);
  handleZelqio(server, statusRpc, getStatus);
  handleZelqio(server, providersListRpc, (_input, { paseo }) => readCatalog(paseoSnapshotSource(paseo)));
  handleZelqio(server, rolesListRpc, () => ({ roles: resolveRoles({}) }));
  return () => {};
}
