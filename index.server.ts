import type { PluginServerContext } from "@getpaseo/plugin/server";
import { paseoSnapshotSource, readCatalog } from "./server/providers";
import { handleZelqio } from "./server/rpc";
import { resolveRoles } from "./server/roles";
import { registerZelqioSettings } from "./server/settings";
import { getStatus } from "./server/status";
import { UsageCache } from "./server/usage";
import { providersListRpc } from "./shared/providers";
import { draftPreference } from "./shared/orchestration";
import { rolesListRpc } from "./shared/roles";
import { statusRpc } from "./shared/status";
import { usageListRpc } from "./shared/usage";

export default function contribute(server: PluginServerContext) {
  let usage = new UsageCache();
  let catalogHash: string | undefined;
  registerZelqioSettings(server);
  server.registerSettings(draftPreference);
  handleZelqio(server, statusRpc, getStatus);
  handleZelqio(server, providersListRpc, async (_input, { paseo }) => {
    const catalog = await readCatalog(paseoSnapshotSource(paseo));
    if (catalog.snapshotHash !== catalogHash) {
      catalogHash = catalog.snapshotHash;
      usage = new UsageCache();
    }
    return catalog;
  });
  handleZelqio(server, usageListRpc, (_input, { paseo }) => usage.read(() => paseo.providers.listUsage()));
  handleZelqio(server, rolesListRpc, () => ({ roles: resolveRoles({}) }));
  return () => {};
}
