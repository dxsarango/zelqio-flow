import { defineAgentTool } from "@getpaseo/plugin/server";
import { z } from "zod";
import { log, registry } from "./state";

// Authorization is keyed on ctx.agent.id, which the daemon supplies from its own
// attach map (agentId -> tools). Nothing the model passes in is used as identity.
export const whoami = defineAgentTool({
  name: "zf_whoami",
  title: "ZF whoami",
  description: "Return the identity the Zelqio POC server resolved for this caller.",
  input: z.object({}),
  async execute(_input, ctx) {
    const binding = registry.get(ctx.agent.id);
    log("tool.zf_whoami", { callerAgentId: ctx.agent.id, bound: binding !== undefined });
    if (!binding) return { isError: true, text: "caller not registered" };
    return {
      text: JSON.stringify({ agentId: ctx.agent.id, role: binding.role, runId: binding.runId }),
    };
  },
});

export const action = defineAgentTool({
  name: "zf_action",
  title: "ZF action",
  description: "Perform a role-authorized action. Actions: report, delegate.",
  input: z.object({
    action: z.enum(["report", "delegate"]),
    runId: z.string().optional(), // self-declared by the model: must NOT be trusted
    note: z.string().optional(),
  }),
  async execute(input, ctx) {
    const binding = registry.get(ctx.agent.id);
    let decision = "deny:unregistered";
    if (binding) {
      if (input.runId !== undefined && input.runId !== binding.runId) decision = "deny:run-mismatch";
      else if (!binding.allowed.includes(input.action)) {
        decision = `deny:role-${binding.role}-cannot-${input.action}`;
      } else decision = "allow";
    }
    log("tool.zf_action", {
      callerAgentId: ctx.agent.id,
      role: binding?.role ?? null,
      action: input.action,
      declaredRunId: input.runId ?? null,
      decision,
    });
    return decision === "allow"
      ? { text: `ok:${input.action}` }
      : { isError: true, text: decision };
  },
});
