// Disposable POC (S00-T07). Shared RPC contracts.
import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

export const POLICY_VERSION = "policy-v1";
export const ACTION = "merge-preview-approval";

const json = z.json();
export const inspectRpc = defineRpc({ name: "poc.inspect", input: z.object({ workspaceId: z.string().optional() }), output: json });
export const requestRpc = defineRpc({
  name: "poc.approval.request",
  input: z.object({ workspaceId: z.string(), requestedBy: z.string().default("ui") }),
  output: json,
});
export const getRpc = defineRpc({ name: "poc.approval.get", input: z.object({ id: z.string() }), output: json });
export const listRpc = defineRpc({ name: "poc.approval.list", input: z.object({}), output: json });
/** `shown` is what the UI displayed to the human when they clicked; the server re-validates it. */
export const decideRpc = defineRpc({
  name: "poc.approval.decide",
  input: z.object({
    id: z.string(),
    decision: z.enum(["approve", "request_changes"]),
    shown: z.object({ action: z.string(), projectId: z.string(), target: z.string(), sha: z.string(), policyVersion: z.string() }),
  }),
  output: json,
});
export const traceRpc = defineRpc({ name: "poc.trace", input: z.object({ event: z.string(), data: z.json().optional() }), output: z.object({ ok: z.boolean() }) });
