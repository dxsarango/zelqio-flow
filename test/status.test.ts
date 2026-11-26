import { describe, expect, it } from "vitest";
import contribute from "../index.server";
import { getStatus } from "../server/status";
import { statusRpc } from "../shared/status";
import { createMockServer } from "./mock-sdk";

describe("status", () => {
  it("reports Foundation with no effects enabled", () => {
    const status = getStatus();
    expect(status.level).toBe("foundation");
    expect(status.effectsEnabled).toBe(false);
  });

  it("is served through the plugin entry as a successful envelope", async () => {
    const mock = createMockServer();
    contribute(mock.server);
    expect(mock.methods()).toEqual(["zelqio.status"]);
    const result = await mock.call(statusRpc, {});
    expect(result).toEqual({ ok: true, data: getStatus() });
  });
});
