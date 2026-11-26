import { describe, expect, it } from "vitest";
import { evaluatePowerPolicy } from "../server/power-policy";

const snapshot = {
  project: "demo",
  execution: "epoch-1",
  now: 40,
  executionState: "working" as const,
  holdActive: false,
  holdEnabled: true,
  temporaryHoldSupported: true,
  suspendSupported: true,
  protectedActivity: { projects: "idle" as const, agents: "idle" as const, userProcesses: "idle" as const },
};
const grant = { project: "demo", execution: "epoch-1", cancelled: false, expiresAt: 50 };

describe("evaluatePowerPolicy", () => {
  it("uses temporary prevention only when enabled and supported, leaving the display policy to the OS", () => {
    expect(evaluatePowerPolicy(snapshot)).toEqual({ action: "acquire_hold", display: "unchanged" });
    expect(evaluatePowerPolicy({ ...snapshot, executionState: "recoverable" }).action).toBe("acquire_hold");
    expect(evaluatePowerPolicy({ ...snapshot, holdEnabled: false }).action).toBe("none");
    expect(evaluatePowerPolicy({ ...snapshot, temporaryHoldSupported: false }).action).toBe("none");
  });

  it("releases the hold when progress ends, becomes unverified, or prevention is disabled", () => {
    for (const executionState of ["finished", "blocked", "unknown"] as const) {
      expect(evaluatePowerPolicy({ ...snapshot, executionState, holdActive: true }, grant).action).toBe("release_hold");
    }
    expect(evaluatePowerPolicy({ ...snapshot, holdActive: true, holdEnabled: false }).action).toBe("release_hold");
  });

  it("requires an unexpired, uncancelled grant for the exact execution and confirmed idle activity", () => {
    const finished = { ...snapshot, executionState: "finished" as const };
    expect(evaluatePowerPolicy(finished, grant).action).toBe("suspend_candidate");
    expect(evaluatePowerPolicy(finished).action).toBe("none");
    for (const invalid of [{ ...grant, execution: "epoch-2" }, { ...grant, cancelled: true }, { ...grant, expiresAt: 40 }]) {
      expect(evaluatePowerPolicy(finished, invalid).action).toBe("none");
    }
    for (const kind of ["projects", "agents", "userProcesses"] as const) {
      for (const activity of ["active", "unknown"] as const) {
        expect(evaluatePowerPolicy({ ...finished, protectedActivity: { ...finished.protectedActivity, [kind]: activity } }, grant).action)
          .toBe("none");
      }
    }
  });
});
