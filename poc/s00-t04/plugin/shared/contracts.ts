import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

export const createDirect = defineRpc({
  name: "poc.create_direct",
  input: z.object({
    role: z.string(),
    runId: z.string(),
    provider: z.string(), // "provider" or "provider/model"
    cwd: z.string(),
    modeId: z.string().optional(),
    thinkingOptionId: z.string().optional(),
    title: z.string().optional(),
    prompt: z.string().optional(),
    register: z.boolean().default(true),
    options: z.record(z.string(), z.unknown()).optional(), // provider options (per-session restrictions)
    toolPolicy: z.object({ preapproved: z.array(z.object({ kind: z.literal("mcp"), server: z.string(), tool: z.string() })) }).optional(),
  }),
  output: z.object({ agentId: z.string(), registered: z.boolean() }),
});

export const dump = defineRpc({
  name: "poc.dump",
  input: z.object({ clear: z.boolean().default(false) }),
  output: z.object({ events: z.array(z.unknown()), registry: z.array(z.unknown()) }),
});

export const control = defineRpc({
  name: "poc.control",
  input: z.object({
    // test-only: veto agent.create.before for a provider
    vetoCreateWhen: z.enum(["none", "provider"]).default("none"),
    vetoProvider: z.string().optional(),
    // test-only: refuse to open sessions whose parent label points at a managed agent
    denyChildrenOfManaged: z.boolean().default(false),
  }),
  output: z.object({ ok: z.boolean() }),
});
