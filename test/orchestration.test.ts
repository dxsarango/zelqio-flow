import { describe, expect, it } from "vitest";
import { draftOrchestration, orchestrationMetadataPatch } from "../shared/orchestration";

describe("draft orchestration intent", () => {
  it("persists the opt-in as serializable draft metadata and removes only its own key when disabled", () => {
    const initial = { otherPlugin: { keep: true } };
    const draft = { ...initial, ...orchestrationMetadataPatch("automatic") };
    expect(draftOrchestration(JSON.parse(JSON.stringify(draft)))).toBe("automatic");
    const disabled = { ...draft, ...orchestrationMetadataPatch("disabled") };
    expect(disabled.otherPlugin).toEqual(initial.otherPlugin);
    expect(draftOrchestration(disabled)).toBe("disabled");
  });

  it("fails closed on missing, malformed, inherited or incompatible intent", () => {
    const key = Object.keys(orchestrationMetadataPatch("automatic"))[0]!;
    expect(draftOrchestration({})).toBe("disabled");
    expect(draftOrchestration({ [key]: { mode: "automatic" } })).toBe("disabled");
    expect(draftOrchestration({ [key]: { version: 2, mode: "automatic" } })).toBe("disabled");
    expect(draftOrchestration({ [key]: { version: 1, mode: "automatic", allowSpend: true } })).toBe("disabled");
    expect(draftOrchestration(Object.create(orchestrationMetadataPatch("automatic")))).toBe("disabled");
    expect(draftOrchestration({ [key]: Object.create({ version: 1, mode: "automatic" }) })).toBe("disabled");
    expect(draftOrchestration({ [key]: Object.assign(Object.create({ mode: "automatic" }), { version: 1 }) })).toBe("disabled");
  });
});
