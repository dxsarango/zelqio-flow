import type { PluginServerContext } from "@getpaseo/plugin/server";

/** Disposable fixture. Install only in a dedicated local daemon with no real providers or projects. */
export default function contribute(server: PluginServerContext) {
  // A synthetic daemon-side allowlist. This fixture does not attest to any live funding or permission.
  const removeSelector = server.addHook("agent.create.before", async ({ request }) => {
    const marker = request.metadata?.["zelqio-flow.orchestration"];
    const optedIn = marker && typeof marker === "object" && "version" in marker && marker.version === 1
      && "mode" in marker && marker.mode === "automatic";
    if (!optedIn || request.config.provider !== "s00-t03-catalog" || request.config.model !== undefined) return;
    return { ...request, config: { ...request.config, model: "fixture-model" } };
  });
  const removeGuard = server.addHook("agent.create.before", async ({ request }, context) => {
    console.log("S04T02 " + JSON.stringify({
      requestFields: Object.keys(request).sort(),
      contextFields: Object.keys(context).sort(),
      hasDraftMarker: Object.hasOwn(request.metadata ?? {}, "zelqio-flow.orchestration"),
      model: request.config.model ?? null,
      modeId: request.config.modeId ?? null,
    }));
    throw new Error("S04-T02 fixture stopped before opening a session");
  });
  return () => {
    removeGuard();
    removeSelector();
  };
}
