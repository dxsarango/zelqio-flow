// Disposable POC (S00-T02) headless driver: creates agents/workspaces through the public
// @getpaseo/client API (same create path the app uses) against an ISOLATED daemon.
//
// Run with Electron-as-node so the client bundled in the installed app is used:
//   ELECTRON_RUN_AS_NODE=1 <paseo-install>/Paseo.exe driver.mjs <paseo-install> <host:port> <fixture-dir> <scenario>
import { createRequire } from "node:module";

const [, , install, host, fixture, scenario, extra] = process.argv;
const base = "file:///" + install.replace(/\\/g, "/") + "/resources/app.asar/node_modules/@getpaseo/client/dist/";
const { createHostClient } = await import(base + "node/index.js");
const { createPaseoApi } = await import(base + "index.js");

const META_KEY = "zelqioFlow";
const SELECTION = { provider: "opencode", model: "mimo-v2.6-flash-free", modeId: "plan" };

const client = createHostClient(host, { clientId: "zelqio-poc-driver", clientType: "cli" });
await client.connect();
const api = createPaseoApi(client);

const out = (label, value) => console.log("DRV " + label + " " + JSON.stringify(value));

async function createAgent(label, { provider, model, modeId, metadata, prompt }) {
  const before = (await client.fetchAgents?.({}).catch(() => null)) ?? null;
  try {
    const handle = await api.agents.create({
      cwd: fixture,
      config: { provider: model ? provider + "/" + model : provider, ...(modeId ? { modeId } : {}) },
      ...(metadata ? { metadata } : {}),
      ...(prompt ? { prompt } : {}),
    });
    const snap = (await handle.refresh?.()) ?? null;
    const agent = snap?.agent ?? snap ?? null;
    out(label, {
      result: "created",
      id: handle.id,
      provider: agent?.provider,
      model: agent?.model ?? agent?.runtimeInfo?.model ?? null,
      modeId: agent?.currentModeId ?? null,
      metadata: agent?.metadata ?? null,
    });
    return handle;
  } catch (error) {
    out(label, { result: "rejected", message: String(error?.message ?? error).slice(0, 300) });
    return null;
  }
}

const scenarios = {
  // Normal session: no opt-in metadata. Hook must leave everything alone.
  async normal() {
    await createAgent("normal", { provider: "opencode", model: "beam-free", modeId: "plan" });
  },
  // Opted in, plugin selection already applied to the draft and untouched by the user.
  async optin_applied() {
    await createAgent("optin-applied", {
      provider: SELECTION.provider, model: SELECTION.model, modeId: SELECTION.modeId,
      metadata: { [META_KEY]: { orchestration: "automatic", selection: SELECTION } },
    });
  },
  // Opted in, request names a DIFFERENT provider and no selection: the hook must rewrite it before the session exists.
  async optin_rewrite() {
    await createAgent("optin-rewrite", {
      provider: "codex", model: "gpt-5.5", metadata: { [META_KEY]: { orchestration: "automatic" } },
    });
  },
  // Opted in, user changed the model after the plugin selected: the manual choice must win.
  async optin_manual() {
    await createAgent("optin-manual", {
      provider: "opencode", model: "beam-free", modeId: "plan",
      metadata: { [META_KEY]: { orchestration: "automatic", selection: SELECTION } },
    });
  },
  // Selection failure: creation must be rejected and nothing may reach any provider.
  async fail_closed() {
    await createAgent("fail-closed", {
      provider: "codex", model: "gpt-5.5", prompt: "Reply OK",
      metadata: { [META_KEY]: { orchestration: "automatic", poc: { failSelection: true } } },
    });
  },
  // First prompt after rewrite: request names codex, hook must route to opencode/free BEFORE inference.
  async first_prompt() {
    const handle = await createAgent("first-prompt", {
      provider: "codex", model: "gpt-5.5", prompt: "Reply OK",
      metadata: { [META_KEY]: { orchestration: "automatic" } },
    });
    if (handle) { try { await handle.waitForFinish?.({ timeoutMs: 120000 }); } catch (e) { out("first-prompt-wait", String(e.message).slice(0, 200)); } }
  },
  // The hook's routing decision names a provider that is unavailable / unknown: creation must fail, never fall back.
  async bad_decision() {
    for (const forced of [{ provider: "pi", model: "none", modeId: "default" }, { provider: "no-such-provider", model: "x", modeId: "default" }]) {
      await createAgent("bad-decision:" + forced.provider, {
        provider: "opencode", model: "beam-free", prompt: "Reply OK",
        metadata: { [META_KEY]: { orchestration: "automatic", poc: { forceDecision: forced } } },
      });
    }
  },
  async workspace() {
    try {
      const ws = await api.workspaces.create({
        title: "poc-ws",
        source: { kind: "directory", path: fixture },
        metadata: { [META_KEY]: { orchestration: "automatic" } },
      });
      out("workspace", { result: "created", id: ws.id });
    } catch (error) {
      out("workspace", { result: "rejected", message: String(error?.message ?? error).slice(0, 400) });
    }
  },
  async list() {
    const res = await api.agents.list({});
    out("agents", (res.entries ?? res.agents ?? res).map?.((e) => ({ id: (e.agent ?? e).id, provider: (e.agent ?? e).provider })));
  },
};

if (!scenarios[scenario]) throw new Error("unknown scenario " + scenario + "; one of " + Object.keys(scenarios).join(","));
await scenarios[scenario](extra);
await client.close();
process.exit(0);
