import { defineRpc } from "@getpaseo/plugin";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import { z } from "zod";

export default function contribute(server: PluginServerContext) {
  server.handle(defineRpc({ name: "fixture.decide",
    input: z.object({ agentId: z.string(), requestId: z.string(), behavior: z.enum(["allow", "deny"]) }),
    output: z.boolean() }), async ({ agentId, requestId, behavior }, { paseo }) => {
      appendFileSync(join(process.env.ZF_T08_HOME!, "racer.ndjson"),
        JSON.stringify({ requestId, at: Date.now() }) + "\n", { flush: true });
      await paseo.agents.ref(agentId).respondToPermission({ requestId, response: { behavior } });
      return true;
    });
  return () => {};
}
import { appendFileSync } from "node:fs";
import { join } from "node:path";
