// Disposable POC (S00-T02). Daemon side: creation hooks, opt-in persistence, trace.
import type { PluginServerContext } from "@getpaseo/plugin/server";
import { META_KEY, POC_SELECTION, optInSettings, traceRpc } from "./shared/contract";

// The native composer reports models as "provider/model"; the creation request may carry either form.
const bare = (model: string | null | undefined) => (model && model.includes("/") ? model.slice(model.indexOf("/") + 1) : model ?? null);

function trace(event: string, data: unknown) {
  // One JSON line per event; read back with `paseo plugin logs zelqio-poc-t02`.
  console.log("ZQT " + JSON.stringify({ t: Date.now(), event, data }));
}

export default function contribute(server: PluginServerContext) {
  server.registerSettings(optInSettings);
  server.handle(traceRpc, ({ event, data }) => {
    trace("ui:" + event, data ?? null);
    return { ok: true };
  });

  // POC-02: runs inside agent creation, before the provider session (and so any inference) exists.
  server.addHook("agent.create.before", ({ request }: any) => {
    const meta = request.metadata?.[META_KEY];
    const optedIn = meta?.orchestration === "automatic";
    const incoming = { provider: request.config.provider, model: request.config.model ?? null, modeId: request.config.modeId ?? null };
    if (!optedIn) {
      trace("agent.create.before", { optedIn: false, incoming, action: "untouched" });
      return undefined; // normal session: nothing returned, request unchanged
    }
    if (meta.poc?.failSelection) {
      trace("agent.create.before", { optedIn: true, incoming, action: "fail-closed" });
      throw new Error("zelqio-poc: routing selection failed; agent not created");
    }
    const decided = meta.poc?.forceDecision ?? meta.selection ?? POC_SELECTION; // forceDecision: test hook to simulate a bad routing decision
    const manual =
      meta.selection !== undefined &&
      (incoming.provider !== meta.selection.provider ||
        bare(incoming.model) !== bare(meta.selection.model) ||
        incoming.modeId !== meta.selection.modeId);
    if (manual) {
      // The user changed provider/model/mode in the composer after the plugin selected: respect it.
      trace("agent.create.before", { optedIn: true, incoming, action: "manual-override-respected", selection: meta.selection });
      return { ...request, metadata: { ...request.metadata, [META_KEY]: { ...meta, manualOverride: true } } };
    }
    const config = { ...request.config, provider: decided.provider, model: decided.model, modeId: decided.modeId };
    trace("agent.create.before", { optedIn: true, incoming, action: "applied", applied: decided });
    return { ...request, config, metadata: { ...request.metadata, [META_KEY]: { ...meta, selection: decided, appliedBy: "hook" } } };
  });

  server.addHook("workspace.create.before", ({ request }: any) => {
    const meta = request.metadata?.[META_KEY];
    trace("workspace.create.before", {
      hasMeta: meta !== undefined,
      orchestration: meta?.orchestration ?? null,
      agentMetaKeys: Object.keys(request.agent?.metadata ?? {}),
    });
    return undefined;
  });

  server.addHook("agent.turn.before", ({ agent, turnId }: any) => {
    trace("agent.turn.before", {
      agentId: agent.id,
      provider: agent.provider,
      turnId,
      metaOrchestration: agent.metadata?.[META_KEY]?.orchestration ?? null,
    });
  });
  server.addHook("agent.create.after", ({ agent }: any) => {
    trace("agent.create.after", { agentId: agent.id, provider: agent.provider });
  });

  return () => {};
}
