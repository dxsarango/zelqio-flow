import { z } from "zod";

const reference = z.string().regex(/^[A-Za-z0-9_.-]{1,128}$/);
const registration = z.discriminatedUnion("status", [
  z.strictObject({ status: z.literal("registered"), agentRef: reference, runRef: reference }),
  z.strictObject({ status: z.literal("unregistered"), agentRef: reference }),
  z.strictObject({ status: z.literal("unknown") }),
]);
const attemptReference = z.strictObject({ runRef: reference, taskRef: reference, attemptRef: reference });
const lifecycleState = z.enum(["starting", "running", "idle", "finished", "failed", "unknown"]);
const permissionState = z.enum(["pending", "granted", "denied", "unknown"]);

/** The registration field represents a lookup in the managed-agent registry supplied by the fixture. */
export const agentLifecycleSnapshot = z.strictObject({
  agentRef: reference,
  registration: registration.optional(),
  expectedAttempt: attemptReference.optional(),
  // Null is an explicit absence of a binding. Omission means the binding was not observed.
  observedAttempt: attemptReference.nullable().optional(),
  state: lifecycleState.optional(),
  permissions: permissionState.optional(),
  title: z.string().max(256).optional(),
  label: z.string().max(128).optional(),
  providerSessionRef: reference.optional(),
});

export type AgentLifecycleSnapshot = z.infer<typeof agentLifecycleSnapshot>;

export interface AgentLifecycleClassification {
  identity: "managed" | "unmanaged" | "unknown";
  attempt: "matched" | "mismatch" | "unbound" | "unknown";
  state: z.infer<typeof lifecycleState>;
  permissions: z.infer<typeof permissionState>;
}
