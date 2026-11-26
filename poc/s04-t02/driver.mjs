import assert from "node:assert/strict";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

// Run with Electron-as-node and a disposable daemon on this fixed loopback port.
const [, , install, endpoint, fixture] = process.argv;
assert.equal(endpoint, "127.0.0.1:16893");
assert(install && fixture, "Pass the Paseo install and disposable fixture directory");
const clientRoot = join(resolve(install), "resources", "app.asar", "node_modules", "@getpaseo", "client", "dist");
const { createHostClient } = await import(pathToFileURL(join(clientRoot, "node", "index.js")).href);
const { createPaseoApi } = await import(pathToFileURL(join(clientRoot, "index.js")).href);

const client = createHostClient(endpoint, { clientId: "zelqio-s04-t02-probe", clientType: "cli" });
try {
  await client.connect();
  const api = createPaseoApi(client);
  const provider = "s00-t03-catalog";
  const catalog = await api.providers.waitForReady({ timeoutMs: 15_000 });
  assert(catalog.entries.some(entry => entry.provider === provider && entry.status === "ready"), "Synthetic catalog expected");
  const automatic = { "zelqio-flow.orchestration": { version: 1, mode: "automatic" } };
  await assert.rejects(
    api.agents.create({ cwd: resolve(fixture), config: { provider }, metadata: automatic }),
    /Expected config.provider in "provider\/model" format/,
  );
  console.log(JSON.stringify({ scenario: "sdk-model-required", rejected: true }));
  const scenarios = [
    { id: "ordinary", config: { provider, model: "fixture-manual" } },
    { id: "eligible", config: { provider }, metadata: automatic },
    { id: "explicit", config: { provider, model: "fixture-manual" }, metadata: automatic },
  ];
  for (const { id, config, metadata } of scenarios) {
    await assert.rejects(
      client.createAgent({ config: { cwd: resolve(fixture), modeId: "review", ...config }, metadata }),
      /S04-T02 fixture stopped before opening a session/,
    );
    console.log(JSON.stringify({ scenario: id, guardRejected: true }));
  }
} finally {
  await client.close();
}
