import { describe, expect, it } from "vitest";
import { z } from "zod";
import { handleZelqio } from "../server/rpc";
import { ZelqioError, normalizeError } from "../shared/errors";
import { defineZelqioRpc, unwrapResult } from "../shared/rpc";
import { createMockServer } from "./mock-sdk";

const echo = defineZelqioRpc({ name: "echo", input: z.object({ text: z.string() }), data: z.object({ text: z.string() }) });

describe("RPC contracts", () => {
  it("prefixes names and returns data in an envelope", async () => {
    const mock = createMockServer();
    handleZelqio(mock.server, echo, ({ text }) => ({ text }));
    expect(echo.name).toBe("zelqio.echo");
    expect(await mock.call(echo, { text: "hi" })).toEqual({ ok: true, data: { text: "hi" } });
  });

  it("normalizes a ZelqioError without losing its code or retry hint", async () => {
    const mock = createMockServer();
    handleZelqio(mock.server, echo, () => {
      throw new ZelqioError("unavailable", "Paseo did not answer.", { retryable: true });
    });
    expect(await mock.call(echo, { text: "x" })).toEqual({
      ok: false,
      error: { code: "unavailable", message: "Paseo did not answer.", retryable: true },
    });
  });

  it("hides internals of unexpected failures", async () => {
    const mock = createMockServer();
    handleZelqio(mock.server, echo, () => {
      throw new Error("ENOENT: C:/secret/path/token.txt");
    });
    const result = await mock.call(echo, { text: "x" });
    expect(result).toEqual({ ok: false, error: { code: "internal", message: "An unexpected error occurred.", retryable: false } });
    expect(JSON.stringify(result)).not.toContain("secret");
  });

  it("rejects input that violates the contract before reaching the handler", async () => {
    const mock = createMockServer();
    let called = false;
    handleZelqio(mock.server, echo, () => {
      called = true;
      return { text: "" };
    });
    await expect(mock.call(echo, { text: 1 } as never)).rejects.toBeDefined();
    expect(called).toBe(false);
  });

  it("rejects a duplicate registration of the same method", () => {
    const mock = createMockServer();
    handleZelqio(mock.server, echo, ({ text }) => ({ text }));
    expect(() => handleZelqio(mock.server, echo, ({ text }) => ({ text }))).toThrow(/duplicate/);
  });

  it("unwrapResult returns data or throws the normalized error", () => {
    expect(unwrapResult({ ok: true, data: 1 })).toBe(1);
    expect(() => unwrapResult({ ok: false, error: { code: "disabled", message: "Off.", retryable: false } })).toThrow(ZelqioError);
  });

  it("maps validation errors to invalid_input", () => {
    const parsed = z.object({ a: z.string() }).safeParse({});
    expect(parsed.success).toBe(false);
    if (!parsed.success) expect(normalizeError(parsed.error).code).toBe("invalid_input");
  });
});
