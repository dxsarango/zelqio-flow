import { describe, expect, it } from "vitest";
import contribute from "../index.server";
import { getStatus } from "../server/status";
import { statusRpc } from "../shared/status";
import { createMockServer } from "./mock-sdk";

describe("status", () => {
  it("reports the advanced level with the run loop enabled", () => {
    const status = getStatus();
    expect(status.level).toBe("advanced");
    expect(status.effectsEnabled).toBe(true);
  });

  it("is served through the plugin entry as a successful envelope", async () => {
    const mock = createMockServer();
    contribute(mock.server);
    expect(mock.methods()).toEqual(["zelqio.providers.list", "zelqio.roles.list", "zelqio.routing.preview", "zelqio.runs.cancel", "zelqio.runs.list", "zelqio.runs.submit", "zelqio.status", "zelqio.usage.list"]);
    const result = await mock.call(statusRpc, {});
    expect(result).toEqual({ ok: true, data: getStatus() });
  });
});
