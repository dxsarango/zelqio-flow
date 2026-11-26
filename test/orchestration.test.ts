import { describe, expect, it } from "vitest";
import contribute from "../index.server";
import { draftOrchestration, draftPreference, orchestrationMetadataPatch } from "../shared/orchestration";
import { createMockServer } from "./mock-sdk";

describe("draft orchestration intent", () => {
  it("persists a disabled-by-default host preference separately from draft intent", () => {
    const mock = createMockServer();
    contribute(mock.server);
    expect(mock.settings()).toContain(draftPreference.id);
    expect(draftPreference.schema.parse({})).toEqual({ remembered: "disabled" });
    expect(draftPreference.schema.parse({ remembered: "automatic" })).toEqual({ remembered: "automatic" });
    expect(draftOrchestration({})).toBe("disabled");
  });

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
