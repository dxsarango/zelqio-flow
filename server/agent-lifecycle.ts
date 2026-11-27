import {
  agentLifecycleSnapshot,
  type AgentLifecycleClassification,
  type AgentLifecycleSnapshot,
} from "../shared/agent-lifecycle";

const sameReference = (left: string, right: string) => left.toLowerCase() === right.toLowerCase();

function classifyAttempt(
  snapshot: AgentLifecycleSnapshot,
  runRef: string,
): AgentLifecycleClassification["attempt"] {
  const { observedAttempt, expectedAttempt } = snapshot;
  if (observedAttempt === null) return "unbound";
  if (!observedAttempt) return "unknown";
  if (!sameReference(observedAttempt.runRef, runRef)) return "mismatch";
  if (!expectedAttempt) return "unknown";
  return sameReference(observedAttempt.runRef, expectedAttempt.runRef)
    && sameReference(observedAttempt.taskRef, expectedAttempt.taskRef)
    && sameReference(observedAttempt.attemptRef, expectedAttempt.attemptRef)
    ? "matched"
    : "mismatch";
}

/** Classifies synthetic evidence. State and permissions describe the observed agent; neither grants authority. */
export function evaluateAgentLifecycle(input: unknown): AgentLifecycleClassification {
  const parsed = agentLifecycleSnapshot.safeParse(input);
  const result: AgentLifecycleClassification = {
    identity: "unknown",
    attempt: "unknown",
    state: "unknown",
    permissions: "unknown",
  };
  if (!parsed.success) return result;

  const snapshot = parsed.data;
  const { registration, agentRef, state, permissions } = snapshot;
  result.state = state ?? "unknown";
  result.permissions = permissions ?? "unknown";

  if (!registration || registration.status === "unknown" || !sameReference(registration.agentRef, agentRef)) {
    return result;
  }
  if (registration.status === "unregistered") {
    result.identity = "unmanaged";
  } else {
    result.identity = "managed";
    result.attempt = classifyAttempt(snapshot, registration.runRef);
  }
  return result;
}
