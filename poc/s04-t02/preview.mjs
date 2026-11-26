import assert from "node:assert/strict";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

// Run with Electron-as-node against a disposable daemon. This writes fixture preferences only.
const [, , install, endpoint] = process.argv;
assert(install);
assert.equal(endpoint, "127.0.0.1:16893");
const clientRoot = join(resolve(install), "resources", "app.asar", "node_modules", "@getpaseo", "client", "dist");
const { createHostClient } = await import(pathToFileURL(join(clientRoot, "node", "index.js")).href);
const { createPaseoApi } = await import(pathToFileURL(join(clientRoot, "index.js")).href);

const client = createHostClient(endpoint, { clientId: "zelqio-routing-preview-fixture", clientType: "cli" });
try {
  await client.connect();
  const provider = "s00-t03-catalog";
  const catalog = await createPaseoApi(client).providers.waitForReady({ timeoutMs: 15_000 });
  assert(catalog.entries.some(entry => entry.provider === provider && entry.status === "ready"));

  const call = (method, input) => client.invokePluginRpc("zelqio-flow", method, input);
  const current = await call("settings.general.read", {});
  assert.equal(current.status, "ready");
  assert.deepEqual(current.values.providers, {}, "Expected fresh disposable settings");
  const saved = await call("settings.general.write", {
    revision: current.revision,
    values: { ...current.values, providers: { [provider]: { use: "primary", funding: "free" } } },
  });
  assert.equal(saved.status, "saved");

  const declaredAt = new Date(Date.now() - 60_000).toISOString();
  const expiresAt = new Date(Date.now() + 60_000).toISOString();
  const free = { provider, model: "fixture-model", funding: "free", declaredAt, expiresAt };
  const paid = { ...free, model: "fixture-manual", funding: "consumption" };
  const route = (models) => call("zelqio.routing.preview", { role: "developer", capability: "implement", models });
  const preview = await route([free, paid]);
  assert.equal(preview.ok, true);
  assert.equal(preview.data.status, "advisory");
  assert.equal(preview.data.quota, "unbound");
  assert.deepEqual(preview.data.recommended, { provider, model: free.model, declaredFunding: "free", quota: "unbound" });
  assert(preview.data.excluded.some(entry => entry.target.provider === provider
    && entry.target.model === paid.model && entry.reason === "funding_mismatch"));
  assert.deepEqual(await route([paid, free]), preview);
  assert.equal((await call("settings.general.read", {})).revision, saved.revision);
  console.log(JSON.stringify({ routingPreview: "passed", stableOrder: true, settingsUnchanged: true }));
} finally {
  await client.close();
}
