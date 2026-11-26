// Disposable POC (S00-T07): generic daemon client (no UI, no agent identity) against the ISOLATED daemon.
//   ELECTRON_RUN_AS_NODE=1 <paseo-install>/Paseo.exe rpc.mjs <paseo-install> <host:port> <command> [json]
// commands: rpc <method> <json-input> | scripts <workspaceId> | start <workspaceId> <name> | stop <workspaceId> <name>
const [, , install, host, cmd, a1, a2, a3] = process.argv;
const base = "file:///" + install.replaceAll(String.fromCharCode(92), "/") + "/resources/app.asar/node_modules/@getpaseo/client/dist/";
const { createHostClient } = await import(base + "node/index.js");
const client = createHostClient(host, { clientId: "zelqio-poc-t07-generic-client", clientType: "cli" });
await client.connect();
try {
  let out;
  if (cmd === "rpc") out = await client.invokePluginRpc("zelqio-poc-t07", a1, JSON.parse(a2 ?? "{}"));
  else if (cmd === "scripts") out = await client.listWorkspaceScripts(a1);
  else if (cmd === "start") out = await client.startWorkspaceScriptWithStatus(a1, a2);
  else if (cmd === "stop") out = await client.stopWorkspaceScript(a1, a2);
  else if (cmd === "perms") out = { methods: Object.getOwnPropertyNames(Object.getPrototypeOf(client)).filter((n) => /perm|auth|server|info/i.test(n)), serverInfo: client.getLastServerInfoMessage?.() ?? null };
  console.log(JSON.stringify(out, null, 1));
} catch (e) { console.log("ERR " + (e?.message ?? e)); process.exitCode = 1; }
finally { await client.close(); }
