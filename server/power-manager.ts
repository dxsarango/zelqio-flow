import { spawn, type ChildProcess } from "node:child_process";
import { evaluatePowerPolicy } from "./power-policy";

/** A running prevention of system sleep. Releasing it restores the normal behaviour of the computer. */
export interface PowerHold {
  release(): Promise<void>;
}

export interface PowerAdapter {
  /** False when this platform has no supported way to hold the system awake. */
  readonly supported: boolean;
  acquire(): Promise<PowerHold>;
}

const WINDOWS_SCRIPT = (parentPid: number) => `
Add-Type -Namespace Zelqio -Name Power -MemberDefinition '[DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint flags);'
# ES_CONTINUOUS | ES_SYSTEM_REQUIRED: the system stays awake, the display may still turn off, no power plan is changed.
[void][Zelqio.Power]::SetThreadExecutionState(0x80000001)
while (Get-Process -Id ${parentPid} -ErrorAction SilentlyContinue) { Start-Sleep -Seconds 5 }
`;

function holdOf(child: ChildProcess): Promise<PowerHold> {
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("spawn", () => {
      child.removeListener("error", reject);
      child.on("error", () => undefined);
      resolve({
        release: () => new Promise<void>(done => {
          if (child.exitCode !== null || child.killed) return done();
          child.once("exit", () => done());
          child.kill();
          setTimeout(done, 2000).unref?.();
        }),
      });
    });
  });
}

/**
 * Holds the system awake with a small helper process that lives only as long as the hold, or as long as this process.
 * The operating system clears the hold when the helper ends, so a crash never leaves the computer unable to sleep.
 * Nothing is written to the power plan and the display is not kept on.
 */
export function platformPowerAdapter(platform: NodeJS.Platform = process.platform, pid: number = process.pid): PowerAdapter {
  if (platform === "win32") {
    return {
      supported: true,
      acquire: () => holdOf(spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", WINDOWS_SCRIPT(pid)], { stdio: "ignore", windowsHide: true })),
    };
  }
  if (platform === "darwin") {
    return { supported: true, acquire: () => holdOf(spawn("caffeinate", ["-i", "-w", String(pid)], { stdio: "ignore" })) };
  }
  if (platform === "linux") {
    return {
      supported: true,
      acquire: () => holdOf(spawn("systemd-inhibit", [
        "--what=sleep", "--who=Zelqio Flow", "--why=Work in progress", "--mode=block",
        "sh", "-c", `while kill -0 ${pid} 2>/dev/null; do sleep 5; done`,
      ], { stdio: "ignore" })),
    };
  }
  return { supported: false, acquire: () => Promise.reject(new Error("unsupported platform")) };
}

export type PowerOutcome = "acquired" | "released" | "none" | "disabled" | "unavailable";

/**
 * Keeps the computer awake only while Zelqio Flow has work in progress and the user turned the option on, and lets go
 * as soon as the work ends, the option is switched off or the hold cannot be verified. It never suspends the system.
 */
export class PowerManager {
  private hold: PowerHold | null = null;
  private broken = false;

  constructor(private readonly deps: { adapter: PowerAdapter; enabled: () => Promise<boolean>; clock?: () => number }) {}

  get holding(): boolean {
    return this.hold !== null;
  }

  async sync(working: boolean): Promise<PowerOutcome> {
    const enabled = await this.deps.enabled().catch(() => false);
    const step = evaluatePowerPolicy({
      project: "zelqio-flow", execution: "runs", now: (this.deps.clock ?? Date.now)(),
      executionState: working ? "working" : "finished",
      holdActive: this.hold !== null, holdEnabled: enabled,
      temporaryHoldSupported: this.deps.adapter.supported && !this.broken, suspendSupported: false,
      protectedActivity: { projects: "unknown", agents: "unknown", userProcesses: "unknown" },
    });
    if (step.action === "acquire_hold") {
      try {
        this.hold = await this.deps.adapter.acquire();
        return "acquired";
      } catch {
        // Without a verifiable hold the computer simply behaves normally; do not retry on every pass.
        this.broken = true;
        return "unavailable";
      }
    }
    if (step.action === "release_hold" || (this.hold !== null && !enabled)) {
      await this.release();
      return enabled ? "released" : "disabled";
    }
    return enabled ? "none" : "disabled";
  }

  async release(): Promise<void> {
    const hold = this.hold;
    this.hold = null;
    await hold?.release().catch(() => undefined);
  }
}
