// Disposable POC (G0 approval persistence). Shared RPC contracts.
import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

const json = z.json();
const binding = z.object({
  taskId: z.string().min(1),
  action: z.string().min(1),
  workspaceId: z.string().min(1),
  sha: z.string().regex(/^[0-9a-f]{40}$/),
});
export const requestRpc = defineRpc({ name: "g0.approval.request", input: z.object({ taskId: z.string().min(1), action: z.string().min(1), workspaceId: z.string().min(1) }), output: json });
export const listRpc = defineRpc({ name: "g0.approval.list", input: z.object({}), output: json });
export const decideRpc = defineRpc({
  name: "g0.approval.decide",
  input: z.object({ id: z.string(), decision: z.enum(["approve", "request_changes"]), shown: binding.extend({ policyVersion: z.string() }) }),
  output: json,
});
/** Verify-and-mark-used. It performs no effect: no code path in this plugin mutates Git or the workspace. */
export const consumeRpc = defineRpc({ name: "g0.approval.consume", input: z.object({ id: z.string(), shown: binding.extend({ policyVersion: z.string() }) }), output: json });
export const stateRpc = defineRpc({ name: "g0.state", input: z.object({}), output: json });
