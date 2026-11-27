import { homedir } from "node:os";
import { join } from "node:path";
import type { PaseoApi } from "@getpaseo/client";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import { AttemptJournal } from "./server/attempt-journal";
import { automaticRouting } from "./server/automatic-routing";
import { draftOrchestration } from "./shared/orchestration";
import { paseoAgentPort } from "./server/paseo-agent-port";
import { paseoSnapshotSource, readCatalog } from "./server/providers";
import { handleZelqio } from "./server/rpc";
import { RunManager } from "./server/run-manager";
import { previewRouting } from "./server/routing-preview";
import { resolveRoles } from "./server/roles";
import { registerZelqioSettings } from "./server/settings";
import { getStatus } from "./server/status";
import { VersionedStore } from "./server/store";
import { UsageCache } from "./server/usage";
import { providersListRpc } from "./shared/providers";
import { draftPreference } from "./shared/orchestration";
import { rolesListRpc } from "./shared/roles";
import { runsCancelRpc, runsListRpc, runsState, runsSubmitRpc } from "./shared/runs";
import { statusRpc } from "./shared/status";
import { usageListRpc } from "./shared/usage";
import { routingPreviewRpc } from "./shared/routing-preview";
import { ZelqioError } from "./shared/errors";

const TICK_MS = 30_000;

/** Where the plugin keeps its own run state. Local only, never sent anywhere. */
function stateDirectory(): string {
  return process.env.ZELQIO_FLOW_HOME ?? join(homedir(), ".zelqio-flow");
}

export default function contribute(server: PluginServerContext) {
  let usage = new UsageCache();
  let catalogHash: string | undefined;
  let latest: PaseoApi | undefined;
  const remember = (paseo: PaseoApi) => {
    latest = paseo;
    return paseo;
  };
  const api = (): PaseoApi => {
    if (!latest) throw new ZelqioError("unavailable", "Paseo is not connected yet.");
    return latest;
  };

  const settings = registerZelqioSettings(server);
  server.registerSettings(draftPreference);

  const directory = stateDirectory();
  const runs = new RunManager({
    port: paseoAgentPort(api),
    store: new VersionedStore({ dir: directory, name: "runs", version: 1, schema: runsState, defaults: () => ({ runs: [] }) }),
    attempts: new AttemptJournal(directory),
    readCatalog: async () => {
      const catalog = await readCatalog(paseoSnapshotSource(api()));
      if (catalog.snapshotHash !== catalogHash) {
        catalogHash = catalog.snapshotHash;
        usage = new UsageCache();
      }
      return catalog;
    },
    readUsage: () => usage.read(() => api().providers.listUsage()).catch(() => null),
    readSettings: async () => {
      const saved = await settings.read();
      return saved.status === "ready" ? saved.values : null;
    },
  });

  const routeAutomatically = automaticRouting({
    readCatalog: async () => readCatalog(paseoSnapshotSource(api())),
    readUsage: () => usage.read(() => api().providers.listUsage()).catch(() => null),
    readSettings: async () => {
      const saved = await settings.read();
      return saved.status === "ready" ? saved.values : null;
    },
  });

  let recovered: Promise<void> | undefined;
  const ready = (paseo: PaseoApi) => {
    remember(paseo);
    recovered ??= runs.recoverAfterRestart().catch(() => undefined);
    return recovered;
  };

  handleZelqio(server, statusRpc, getStatus);
  handleZelqio(server, providersListRpc, async (_input, { paseo }) => {
    remember(paseo);
    const catalog = await readCatalog(paseoSnapshotSource(paseo));
    if (catalog.snapshotHash !== catalogHash) {
      catalogHash = catalog.snapshotHash;
      usage = new UsageCache();
    }
    return catalog;
  });
  handleZelqio(server, usageListRpc, (_input, { paseo }) => usage.read(() => remember(paseo).providers.listUsage()));
  handleZelqio(server, routingPreviewRpc, async (input, { paseo }) => {
    remember(paseo);
    const saved = await settings.read();
    if (saved.status !== "ready") throw new ZelqioError("unavailable", "Routing preferences are unavailable.");
    const catalog = await readCatalog(paseoSnapshotSource(paseo));
    return previewRouting(input, catalog, saved.values, Date.now());
  });
  handleZelqio(server, rolesListRpc, () => ({ roles: resolveRoles({}) }));

  handleZelqio(server, runsSubmitRpc, async (input, { paseo }) => {
    await ready(paseo);
    return runs.submit(input);
  });
  handleZelqio(server, runsListRpc, async (_input, { paseo }) => {
    await ready(paseo);
    await runs.tick();
    return { runs: await runs.list() };
  });
  handleZelqio(server, runsCancelRpc, async (input, { paseo }) => {
    await ready(paseo);
    return runs.cancel(input.id);
  });

  // With Automatic on in the native New Agent / New Workspace screens, Zelqio chooses the model at creation.
  const removeCreateBefore = server.addHook("agent.create.before", async (payload, { paseo }) => {
    remember(paseo);
    const routed = await routeAutomatically(payload.request as never);
    return routed as typeof payload.request;
  });
  // ... and keeps looking after that agent: limits are handled and the answer is delivered, like a submitted request.
  const removeCreateAfter = server.addHook("agent.create.after", async ({ agent }, { paseo }) => {
    await ready(paseo);
    if (draftOrchestration(agent.metadata) !== "automatic" || Object.hasOwn(agent.metadata, "zelqio.run")) return;
    const routing = agent.metadata["zelqio-flow.routing"] as { provider?: string; model?: string } | undefined;
    const provider = routing?.provider ?? agent.provider;
    await runs.adopt({ agentId: agent.id, provider, model: routing?.model ?? "", cwd: agent.cwd }).catch(() => undefined);
  });

  // A finished or failed turn is the moment a limit shows up, so react to it right away.
  const removeHook = server.addHook("agent.turn.after", async ({ agent }, { paseo }) => {
    await ready(paseo);
    await runs.onAgentUpdate(agent.id);
  });
  const timer = setInterval(() => {
    if (latest) void runs.tick().catch(() => undefined);
  }, TICK_MS);
  timer.unref?.();

  return () => {
    clearInterval(timer);
    removeHook();
    removeCreateBefore();
    removeCreateAfter();
  };
}
