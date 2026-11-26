import type { PluginServerContext } from "@getpaseo/plugin/server";

/** Disposable fixture. Install only in a dedicated local daemon with no real providers or projects. */
export default function contribute(server: PluginServerContext) {
  return server.addHook("agent.create.before", async ({ request }, context) => {
    console.log("S04T02 " + JSON.stringify({
      requestFields: Object.keys(request).sort(),
      contextFields: Object.keys(context).sort(),
      hasDraftMarker: Object.hasOwn(request.metadata ?? {}, "zelqio-flow.orchestration"),
    }));
    throw new Error("S04-T02 fixture stopped before opening a session");
  });
}
