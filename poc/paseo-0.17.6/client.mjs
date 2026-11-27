import assert from "node:assert/strict";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { endpoint, version } from "./isolation.mjs";

export { eventually, model, print, provider } from "../paseo-0.17.5/client.mjs";
export const pluginId = "zelqio-probe-0176";

export async function connect(probe) {
  const root = join(probe.installed, "@getpaseo", "client", "dist");
  const { createHostClient } = await import(pathToFileURL(join(root, "node", "index.js")).href);
  const { createPaseoApi } = await import(pathToFileURL(join(root, "index.js")).href);
  const client = createHostClient(endpoint, { clientId: "zelqio-0176-fixture", clientType: "cli" });
  try {
    await client.connect();
    assert.equal(client.getLastServerInfoMessage().version, version);
    return { client, api: createPaseoApi(client) };
  } catch (error) {
    await client.close();
    throw error;
  }
}

export function observations(client) {
  return client.invokePluginRpc(pluginId, "probe.observations", {});
}
