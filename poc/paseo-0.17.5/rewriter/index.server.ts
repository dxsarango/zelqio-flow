import type { PluginServerContext } from "@getpaseo/plugin/server";

export default function contribute(server: PluginServerContext) {
  return server.addHook("agent.create.before", async ({ request }) => {
    const replacement = request.metadata?.fixtureReplacement;
    if (typeof replacement === "string") return { ...request, workspaceId: replacement };
  });
}
