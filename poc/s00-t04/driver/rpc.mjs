// Usage (Electron-as-node, read-only use of the installed Paseo bundle):
//   ELECTRON_RUN_AS_NODE=1 <paseo-install>/Paseo.exe rpc.mjs <home> <listen> <pluginId> <method> '<json-input>'
// Connects to the ISOLATED daemon only and invokes one plugin RPC.
import { pathToFileURL } from "node:url";

const [home, listen, pluginId, method, rawInput = "{}"] = process.argv.slice(2);
const asar = `${process.env.LOCALAPPDATA.split(String.fromCharCode(92)).join("/")}/Programs/Paseo/resources/app.asar/node_modules/@getpaseo`;
const { createHostClient } = await import(pathToFileURL(`${asar}/client/dist/node/index.js`).href);
const { readLocalCredentialForTarget } = await import(
  pathToFileURL(`${asar}/server/dist/server/server/daemon-instance.js`).href
);

const client = createHostClient(listen, {
  clientId: "zf-poc-t04-driver",
  clientType: "cli",
  appVersion: "0.17.4",
  localCredential: () => readLocalCredentialForTarget(home, listen) ?? undefined,
  connectTimeoutMs: 15000,
  reconnect: { enabled: false },
});
await client.connect();
try {
  const out = await client.invokePluginRpc(pluginId, method, JSON.parse(rawInput));
  console.log(JSON.stringify(out, null, 2));
} finally {
  await client.close();
}
