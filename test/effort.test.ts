import { describe, expect, it } from "vitest";
import { chooseEffort, estimateComplexity } from "../server/effort";

const options = [
  { id: "low", label: "Low", isDefault: false },
  { id: "medium", label: "Medium", isDefault: true },
  { id: "high", label: "High", isDefault: false },
  { id: "xhigh", label: "Extra high", isDefault: false },
];

describe("reasoning effort", () => {
  it("follows the complexity of the request", () => {
    expect(chooseEffort(options, { complexity: "low", strategy: "balanced" })).toBe("low");
    expect(chooseEffort(options, { complexity: "medium", strategy: "balanced" })).toBe("medium");
    expect(chooseEffort(options, { complexity: "high", strategy: "balanced" })).toBe("high");
  });

  it("lowers the level under a tight quota or an economical strategy and raises it for quality first", () => {
    expect(chooseEffort(options, { complexity: "high", strategy: "balanced", quotaLow: true })).toBe("medium");
    expect(chooseEffort(options, { complexity: "high", strategy: "economy" })).toBe("medium");
    expect(chooseEffort(options, { complexity: "high", strategy: "quality_first" })).toBe("xhigh");
    expect(chooseEffort(options, { complexity: "low", strategy: "economy" })).toBe("low");
  });

  it("uses the closest level the model has and leaves unknown names to the provider", () => {
    expect(chooseEffort([{ id: "fast", label: "Fast", isDefault: false }, { id: "deep", label: "Deep", isDefault: false }], { complexity: "medium", strategy: "balanced" })).toBe("fast");
    expect(chooseEffort([{ id: "alpha", label: "Alpha", isDefault: true }], { complexity: "high", strategy: "balanced" })).toBeUndefined();
    expect(chooseEffort([], { complexity: "high", strategy: "balanced" })).toBeUndefined();
  });

  it("estimates complexity from the request", () => {
    expect(estimateComplexity("fix typo")).toBe("low");
    expect(estimateComplexity("x".repeat(400))).toBe("medium");
    expect(estimateComplexity("x".repeat(3000))).toBe("high");
  });
});
