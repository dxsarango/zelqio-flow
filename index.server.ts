import { homedir } from "node:os";
import { join } from "node:path";
import type { PaseoApi } from "@getpaseo/client";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import { AttemptJournal } from "./server/attempt-journal";
import { automaticRouting } from "./server/automatic-routing";
import { delegationTools, type ChildSummary } from "./server/delegation-tools";
import { draftOrchestration } from "./shared/orchestration";
import { paseoAgentPort } from "./server/paseo-agent-port";
import { platformPowerAdapter, PowerManager } from "./server/power-manager";
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

/** How often waiting and running runs are looked at. Overridable only through the environment, for tests. */
const DELEGATION_GUIDANCE = "Zelqio Flow can run parts of this work on other agents. Use zelqio_delegate for a self-contained task (name its role; Zelqio Flow picks the authorized model), zelqio_wait to wait for results and zelqio_status to review them. Delegated agents cannot delegate again. Do not delegate trivial work.";

const TICK_MS = Math.max(250, Number(process.env.ZELQIO_TICK_MS) || 30_000);

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
    // Test-only overrides; production keeps the defaults.
    recheckMs: Number(process.env.ZELQIO_RECHECK_MS) || undefined,
    defaultWaitMs: Number(process.env.ZELQIO_DEFAULT_WAIT_MS) || undefined,
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

  const power = new PowerManager({
    adapter: platformPowerAdapter(),
    enabled: async () => {
      const saved = await settings.read();
      return saved.status === "ready" && saved.values.power.preventSleep;
    },
  });
  const syncPower = async () => { await power.sync(await runs.hasWork()); };

  let recovered: Promise<void> | undefined;
  const ready = (paseo: PaseoApi) => {
    remember(paseo);
    recovered ??= runs.recoverAfterRestart().catch(() => undefined);
    return recovered;
  };

  const summarize = (run: Awaited<ReturnType<typeof runs.list>>[number]): ChildSummary => ({
    id: run.id,
    title: run.title ?? run.prompt.slice(0, 80),
    status: run.status,
    provider: run.current?.provider,
    model: run.current?.model,
    result: run.result,
    error: run.error,
  });
  const delegation = delegationTools({
    delegate: async (agentId, input) => summarize(await runs.delegate(agentId, input)),
    children: async agentId => (await runs.children(agentId)).map(summarize),
    cancel: async (agentId, childId) => summarize(await runs.cancelChild(agentId, childId)),
  });

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
    await syncPower().catch(() => undefined);
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

  // Only a coordinator gets the delegation tools: a submitted run or an Automatic agent, never a delegated one.
  const removeOpen = server.addHook("agent.open.before", async ({ request }, { paseo }) => {
    remember(paseo);
    const delegated = Object.hasOwn(request.metadata, "zelqio.parent");
    const coordinator = !delegated && (Object.hasOwn(request.metadata, "zelqio.run") || draftOrchestration(request.metadata) === "automatic");
    if (!coordinator) return request;
    return { ...request, tools: [...request.tools, ...delegation], appendSystemPrompt: [...(request.appendSystemPrompt ?? []), DELEGATION_GUIDANCE] };
  });

  // A finished or failed turn is the moment a limit shows up, so react to it right away.
  const removeHook = server.addHook("agent.turn.after", async ({ agent, outcome }, { paseo }) => {
    await ready(paseo);
    await runs.onAgentUpdate(agent.id, outcome.kind === "failed" ? { error: outcome.error } : undefined);
  });
  const timer = setInterval(() => {
    if (latest) void runs.tick().then(syncPower).catch(() => undefined);
  }, TICK_MS);
  timer.unref?.();

  return () => {
    clearInterval(timer);
    void power.release();
    removeHook();
    removeCreateBefore();
    removeCreateAfter();
    removeOpen();
  };
}
