import { afterEach, describe, expect, it, vi } from "vitest";
import { dateFormatter } from "../client/format";

describe("date formatting on engines with partial Intl support", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("formats with the full options when the engine supports them", () => {
    expect(dateFormatter("en", "short").format(new Date("2026-11-28T10:30:00Z"))).toMatch(/2026|26/);
  });

  it("falls back to explicit fields when dateStyle is not supported, and to ISO text when nothing works", () => {
    const calls: unknown[] = [];
    class Limited {
      constructor(_locale: unknown, options: Record<string, unknown>) {
        calls.push(options);
        if ("dateStyle" in options) throw new RangeError("dateStyle is not supported");
      }
      format() { return "fallback"; }
    }
    vi.stubGlobal("Intl", { DateTimeFormat: Limited });
    expect(dateFormatter("es", "medium").format(new Date(0))).toBe("fallback");
    expect(calls).toHaveLength(2);

    class Broken { constructor() { throw new RangeError("no Intl"); } }
    vi.stubGlobal("Intl", { DateTimeFormat: Broken });
    expect(dateFormatter("es", "short").format(new Date("2026-11-28T10:30:00Z"))).toBe("2026-11-28 10:30");
  });
});
