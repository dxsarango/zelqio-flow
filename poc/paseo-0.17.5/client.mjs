import assert from "node:assert/strict";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { setTimeout } from "node:timers/promises";
import { endpoint, version } from "./isolation.mjs";

export const provider = "zelqio-fixture";
export const model = "fixture-default";
export const pluginId = "zelqio-probe-0175";

export async function connect(probe) {
  const root = join(probe.installed, "@getpaseo", "client", "dist");
  const { createHostClient } = await import(pathToFileURL(join(root, "node", "index.js")).href);
  const { createPaseoApi } = await import(pathToFileURL(join(root, "index.js")).href);
  const client = createHostClient(endpoint, { clientId: "zelqio-0175-fixture", clientType: "cli" });
  await client.connect();
  assert.equal(client.getLastServerInfoMessage().version, version);
  return { client, api: createPaseoApi(client) };
}

export function observations(client) {
  return client.invokePluginRpc(pluginId, "probe.observations", {});
}

export function print(test, value) {
  console.log(JSON.stringify({ test, value }));
}

export async function eventually(read, predicate, timeout = 20_000) {
  const end = Date.now() + timeout;
  let value;
  do {
    value = await read();
    if (predicate(value)) return value;
    await setTimeout(150);
  } while (Date.now() < end);
  throw new Error(`Timed out waiting for fixture state: ${JSON.stringify(value)}`);
}
