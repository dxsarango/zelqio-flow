import { describe, expect, it } from "vitest";
import { evaluateAgentLifecycle } from "../server/agent-lifecycle";
import { agentLifecycleSnapshot, type AgentLifecycleSnapshot } from "../shared/agent-lifecycle";

const attempt = { runRef: "run-1", taskRef: "task-1", attemptRef: "attempt-1" };
const managed = {
  agentRef: "Agent-A",
  registration: { status: "registered", agentRef: "agent-a", runRef: "RUN-1" },
  expectedAttempt: attempt,
  observedAttempt: { runRef: "RUN-1", taskRef: "Task-1", attemptRef: "ATTEMPT-1" },
} satisfies AgentLifecycleSnapshot;
const unknownClassification = {
  identity: "unknown", attempt: "unknown", state: "unknown", permissions: "unknown",
};

describe("evaluateAgentLifecycle", () => {
  it("leaves spoofed labels and provider sessions without registration evidence unknown", () => {
    expect(evaluateAgentLifecycle({
      agentRef: "agent-a",
      title: "Zelqio Flow worker",
      label: "zelqio-flow.managed",
      providerSessionRef: "agent-a",
      expectedAttempt: attempt,
      observedAttempt: attempt,
    })).toEqual(unknownClassification);
  });

  it("distinguishes agents with the same title by checking the registration subject", () => {
    const original = { ...managed, title: "Zelqio Flow worker" };
    const sameTitle = { ...original, agentRef: "agent-b" };

    expect(evaluateAgentLifecycle(original)).toMatchObject({ identity: "managed", attempt: "matched" });
    expect(evaluateAgentLifecycle(sameTitle)).toEqual(unknownClassification);
    expect(evaluateAgentLifecycle({
      ...sameTitle,
      registration: { status: "unregistered", agentRef: "AGENT-B" },
    })).toMatchObject({ identity: "unmanaged", attempt: "unknown" });
  });

  it.each([
    { ...attempt, attemptRef: "attempt-2" },
    { ...attempt, taskRef: "task-2" },
    { ...attempt, runRef: "run-2" },
  ])("detects a mismatched attempt without changing agent identity or state (%j)", observedAttempt => {
    expect(evaluateAgentLifecycle({ ...managed, observedAttempt, state: "idle" })).toEqual({
      identity: "managed", attempt: "mismatch", state: "idle", permissions: "unknown",
    });
  });

  it("checks the observed attempt against the registered run even when both attempt references agree", () => {
    const otherRun = { ...attempt, runRef: "run-2" };
    expect(evaluateAgentLifecycle({
      ...managed, expectedAttempt: otherRun, observedAttempt: otherRun,
    }).attempt).toBe("mismatch");
  });

  it("distinguishes explicit absence from incomplete attempt evidence", () => {
    expect(evaluateAgentLifecycle({ ...managed, observedAttempt: null }).attempt).toBe("unbound");
    expect(evaluateAgentLifecycle({ ...managed, observedAttempt: undefined }).attempt).toBe("unknown");
    expect(evaluateAgentLifecycle({ ...managed, expectedAttempt: undefined }).attempt).toBe("unknown");
  });

  it.each([undefined, "unknown"])("keeps unobserved or unknown state unknown with permissions pending (%s)", state => {
    expect(evaluateAgentLifecycle({ ...managed, state, permissions: "pending" })).toEqual({
      identity: "managed", attempt: "matched", state: "unknown", permissions: "pending",
    });
  });

  it.each(["starting", "running", "idle", "finished", "failed"])("preserves explicitly observed state %s", state => {
    expect(evaluateAgentLifecycle({
      agentRef: "agent-a", state, permissions: "denied",
    })).toEqual({ ...unknownClassification, state, permissions: "denied" });
  });

  it("rejects malformed evidence and unexpected fields without exposing raw values", () => {
    const malformed = [
      { ...managed, registration: { status: "registered", agentRef: "agent-a" } },
      { ...managed, registration: { status: "unregistered", agentRef: "agent-a", runRef: "run-1" } },
      { ...managed, observedAttempt: { ...attempt, path: "synthetic/path" } },
      { ...managed, conversation: "synthetic conversation" },
      { ...managed, state: "approved" },
    ];
    for (const snapshot of malformed) {
      expect(agentLifecycleSnapshot.safeParse(snapshot).success).toBe(false);
      expect(evaluateAgentLifecycle(snapshot)).toEqual(unknownClassification);
    }
  });
});
