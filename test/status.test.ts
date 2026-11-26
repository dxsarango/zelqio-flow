import { describe, expect, it } from "vitest";
import { getStatus } from "../server/status";
import { statusRpc } from "../shared/status";

describe("status", () => {
  it("reports Foundation with no effects enabled", () => {
    const status = getStatus();
    expect(status.level).toBe("foundation");
    expect(status.effectsEnabled).toBe(false);
  });

  it("matches the RPC output contract", () => {
    expect(statusRpc.output.safeParse(getStatus()).success).toBe(true);
  });
});
