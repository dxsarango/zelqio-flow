// Thin RPC caller for the disposable approval plugin. Prints one JSON line: {ok,output} or {ok:false,error}.
// Usage (Electron in Node mode): call.mjs <paseo-install> <port> <rpc-name> <base64-json-input>
const [, , install, port, method, inputB64] = process.argv;
if (!/^168(2\d)$/.test(port)) throw new Error("Only loopback ports 16820-16829 are allowed.");
const base = `file:///${install.replaceAll("\\", "/")}/resources/app.asar/node_modules/@getpaseo/client/dist/`;
const { createHostClient } = await import(base + "node/index.js");
const client = createHostClient(`127.0.0.1:${port}`, { clientId: "zelqio-g0-approval", clientType: "cli" });
await client.connect();
try {
  const input = JSON.parse(Buffer.from(inputB64 ?? "e30=", "base64").toString("utf8"));
  const output = await client.invokePluginRpc("zelqio-poc-g0-approval", method, input);
  console.log(JSON.stringify({ ok: true, output }));
} catch (e) {
  console.log(JSON.stringify({ ok: false, error: String(e?.message ?? e).slice(0, 300) }));
} finally {
  await client.close();
}
