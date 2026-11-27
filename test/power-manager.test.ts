import { describe, expect, it } from "vitest";
import { platformPowerAdapter, PowerManager, type PowerAdapter } from "../server/power-manager";

function fakeAdapter(options: { supported?: boolean; failAcquire?: boolean } = {}) {
  const state = { acquired: 0, released: 0 };
  const adapter: PowerAdapter = {
    supported: options.supported ?? true,
    async acquire() {
      if (options.failAcquire) throw new Error("no helper");
      state.acquired++;
      return { release: async () => { state.released++; } };
    },
  };
  return { adapter, state };
}

describe("power management", () => {
  it("holds the system awake only while work is in progress and the option is on", async () => {
    const { adapter, state } = fakeAdapter();
    let enabled = true;
    const power = new PowerManager({ adapter, enabled: async () => enabled });
    expect(await power.sync(false)).toBe("none");
    expect(state.acquired).toBe(0);
    expect(await power.sync(true)).toBe("acquired");
    expect(await power.sync(true)).toBe("none");
    expect(state.acquired).toBe(1);
    expect(power.holding).toBe(true);
    expect(await power.sync(false)).toBe("released");
    expect(state).toEqual({ acquired: 1, released: 1 });
    expect(power.holding).toBe(false);
    enabled = false;
    expect(await power.sync(true)).toBe("disabled");
    expect(state.acquired).toBe(1);
  });

  it("never holds when the option is off, and lets go when it is switched off during work", async () => {
    const { adapter, state } = fakeAdapter();
    let enabled = false;
    const power = new PowerManager({ adapter, enabled: async () => enabled });
    expect(await power.sync(true)).toBe("disabled");
    expect(state.acquired).toBe(0);
    enabled = true;
    await power.sync(true);
    enabled = false;
    expect(await power.sync(true)).toBe("disabled");
    expect(state.released).toBe(1);
  });

  it("falls back to normal behaviour when the hold cannot be taken, without retrying every pass", async () => {
    const { adapter } = fakeAdapter({ failAcquire: true });
    const power = new PowerManager({ adapter, enabled: async () => true });
    expect(await power.sync(true)).toBe("unavailable");
    expect(power.holding).toBe(false);
    expect(await power.sync(true)).toBe("none");
  });

  it("does nothing on a platform without a supported hold, and when settings cannot be read", async () => {
    const unsupported = new PowerManager({ adapter: fakeAdapter({ supported: false }).adapter, enabled: async () => true });
    expect(await unsupported.sync(true)).toBe("none");
    const unreadable = new PowerManager({ adapter: fakeAdapter().adapter, enabled: async () => { throw new Error("settings"); } });
    expect(await unreadable.sync(true)).toBe("disabled");
  });

  it("releases on demand", async () => {
    const { adapter, state } = fakeAdapter();
    const power = new PowerManager({ adapter, enabled: async () => true });
    await power.sync(true);
    await power.release();
    await power.release();
    expect(state.released).toBe(1);
  });

  it("offers an adapter for the supported platforms and none for others", () => {
    expect(platformPowerAdapter("win32", 1).supported).toBe(true);
    expect(platformPowerAdapter("darwin", 1).supported).toBe(true);
    expect(platformPowerAdapter("linux", 1).supported).toBe(true);
    expect(platformPowerAdapter("freebsd", 1).supported).toBe(false);
  });
});
