import { describe, expect, it } from "vitest";
import { deriveModelFacts } from "../server/model-facts";
import { route } from "../server/router";
import { resolveRoles } from "../server/roles";
import type { ProviderCatalogData } from "../shared/providers";
import { defaultSettings, type ZelqioSettings } from "../shared/settings";

const model = (id: string, isDefault = false) => ({ id, label: id, isDefault, selectable: true, thinkingOptions: [] });
const catalog: ProviderCatalogData = {
  generatedAt: "2026-11-27T12:00:00.000Z",
  providers: [
    { id: "alpha", label: "alpha", status: "ready", enabled: true, source: "builtin", modes: [], models: [model("a-big", true), model("a-mid"), model("a-small")] },
    { id: "beta", label: "beta", status: "ready", enabled: true, source: "builtin", modes: [], models: [model("b-one"), model("b-two")] },
  ],
};
const settings = (providers: ZelqioSettings["providers"]): ZelqioSettings => ({ ...defaultSettings(), providers });
const developer = resolveRoles({}).find(role => role.id === "developer")!;
const pick = (config: ZelqioSettings) => route({
  catalog, settings: config, role: developer, capability: "implement",
  models: deriveModelFacts({ catalog, settings: config, usage: null, now: 0 }), allowUnknownQuota: true,
});

describe("authorized models", () => {
  it("authorizes only the provider's default model when the user listed none", () => {
    const facts = deriveModelFacts({ catalog, settings: settings({ alpha: { use: "primary", funding: "subscription" } }), usage: null, now: 0 });
    const permitted = [...facts.get("alpha")!].filter(([, value]) => value.permitted).map(([id]) => id);
    expect(permitted).toEqual(["a-big"]);
  });

  it("authorizes nothing for a provider with no default and no list, instead of every model", () => {
    const decision = pick(settings({ beta: { use: "primary", funding: "subscription" } }));
    expect(decision.selected).toBeNull();
    expect(decision.excluded.filter(entry => entry.target.provider === "beta").map(entry => entry.reason)).toEqual(["not_permitted", "not_permitted"]);
  });

  it("uses exactly the listed models and prefers them in the order the user gave", () => {
    const config = settings({ alpha: { use: "primary", funding: "subscription", models: ["a-small", "a-mid"] } });
    const decision = pick(config);
    expect(decision.ranked.map(target => target.model)).toEqual(["a-small", "a-mid"]);
    expect(decision.excluded.find(entry => entry.target.model === "a-big")?.reason).toBe("not_permitted");
  });

  it("breaks ties in favour of a primary provider before an auxiliary one", () => {
    const config = settings({
      alpha: { use: "auxiliary", funding: "subscription", models: ["a-mid"] },
      beta: { use: "primary", funding: "subscription", models: ["b-two"] },
    });
    expect(pick(config).selected).toEqual({ provider: "beta", model: "b-two" });
  });
});
