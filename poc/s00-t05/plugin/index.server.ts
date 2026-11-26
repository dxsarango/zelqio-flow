import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";
import type { PluginServerContext } from "@getpaseo/plugin/server";

const create = defineRpc({
  name: "poc.create",
  input: z.object({
    cwd: z.string(),
    workspaceId: z.string(),
    callerAgentId: z.string().optional(),
  }),
  output: z.object({ id: z.string() }),
});

export default function contribute(server: PluginServerContext) {
  server.handle(create, async ({ cwd, workspaceId, callerAgentId }, { paseo }) => {
    const agent = await paseo.agents.create({
      cwd,
      workspaceId,
      ...(callerAgentId ? { callerAgentId } : {}),
      title: "T05 plugin probe",
      config: { provider: "opencode/iceman-free", modeId: "plan" },
    });
    return { id: agent.id };
  });
  return () => {};
}
