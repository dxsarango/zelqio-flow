import { describe, expect, it } from "vitest";
import { addCustomRole, removeCustomRole, resolveRoles, setCandidates, validateRolesConfig } from "../server/roles";
import { normalizeSnapshot } from "../server/providers";
import { BUILTIN_ROLE_IDS, roleDefinition } from "../shared/roles";

const catalog = normalizeSnapshot({
  generatedAt: "t",
  entries: [
    { provider: "alpha", status: "ready", enabled: true, models: [{ id: "m1" }, { id: "m2", isSelectable: false }] },
    { provider: "beta", status: "error", enabled: true, error: "down", models: [] },
    { provider: "gamma", status: "ready", enabled: false, models: [{ id: "g1" }] },
  ],
});
const errors = (input: unknown, withCatalog = true) =>
  validateRolesConfig(input, withCatalog ? catalog : undefined).issues.filter((i) => i.severity === "error").map((i) => i.message);

describe("built-in roles", () => {
  it("resolves exactly the seven roles with capabilities and no baked-in candidates", () => {
    const roles = resolveRoles({});
    expect(roles.map((r) => r.id)).toEqual([...BUILTIN_ROLE_IDS]);
    expect(roles).toHaveLength(7);
    for (const role of roles) {
      expect(role.kind).toBe("builtin");
      expect(role.candidates).toEqual([]);
      expect(roleDefinition.safeParse(role).success).toBe(true);
    }
  });

  it("lets candidates and instructions be edited but not identity or capabilities", () => {
    const config = setCandidates({}, "developer", [{ provider: "alpha", model: "m1" }]);
    const roles = resolveRoles({ ...config, overrides: { ...config.overrides, developer: { ...config.overrides?.developer, instructions: "Keep diffs small." } } });
    const developer = roles.find((r) => r.id === "developer");
    expect(developer).toMatchObject({ label: "Developer", capabilities: ["implement"], candidates: [{ provider: "alpha", model: "m1" }], instructions: "Keep diffs small." });
    const smuggled = resolveRoles({ overrides: { developer: { capabilities: ["coordinate"], label: "Root", kind: "custom" } } as never });
    expect(smuggled.find((r) => r.id === "developer")).toMatchObject({ label: "Developer", capabilities: ["implement"], kind: "builtin" });
  });

  it("does not read inherited object keys as overrides", () => {
    expect(resolveRoles({ overrides: JSON.parse('{"__proto__":{"candidates":[{"provider":"x"}]}}') }).every((r) => r.candidates.length === 0)).toBe(true);
  });
});

describe("custom roles", () => {
  const reviewer2 = { id: "security_reviewer", label: "Security reviewer", capabilities: ["review" as const], candidates: [{ provider: "alpha" }] };

  it("adds, lists and removes a custom role", () => {
    const config = addCustomRole({}, reviewer2);
    expect(resolveRoles(config).at(-1)).toMatchObject({ id: "security_reviewer", kind: "custom" });
    expect(resolveRoles(removeCustomRole(config, "security_reviewer"))).toHaveLength(7);
  });

  it("rejects ids that reuse a built-in id or another custom role", () => {
    expect(errors(addCustomRole({}, { ...reviewer2, id: "developer" }))).toEqual(["developer is a built-in role id."]);
    expect(errors({ custom: [{ ...reviewer2, kind: "custom" }, { ...reviewer2, kind: "custom" }] })).toEqual(["Duplicate custom role security_reviewer."]);
  });

  it("rejects malformed ids, empty capabilities and oversized text", () => {
    expect(() => addCustomRole({}, { ...reviewer2, id: "Bad Id!" })).toThrow();
    expect(() => addCustomRole({}, { ...reviewer2, capabilities: [] })).toThrow();
    expect(() => addCustomRole({}, { ...reviewer2, instructions: "x".repeat(2001) })).toThrow();
    expect(validateRolesConfig({ custom: [{ ...reviewer2, kind: "custom", capabilities: ["admin"] }] }).ok).toBe(false);
  });

  it("carries no permission or tool fields: unknown keys are dropped", () => {
    const role = resolveRoles({ custom: [{ ...reviewer2, kind: "custom", permissions: ["pr.merge"], tools: ["shell"] }] as never }).at(-1);
    expect(role).not.toHaveProperty("permissions");
    expect(role).not.toHaveProperty("tools");
  });

  it("edits candidates of a custom role", () => {
    const config = setCandidates(addCustomRole({}, reviewer2), "security_reviewer", [{ provider: "beta" }]);
    expect(resolveRoles(config).at(-1)?.candidates).toEqual([{ provider: "beta" }]);
  });
});

describe("validation against the provider catalog", () => {
  it("accepts candidates that exist and are usable", () => {
    expect(errors({ overrides: { developer: { candidates: [{ provider: "alpha", model: "m1" }] } } })).toEqual([]);
  });

  it("rejects unknown providers, unknown models, unselectable models and disabled providers", () => {
    expect(errors({ overrides: { developer: { candidates: [{ provider: "nope" }] } } })).toEqual(["Provider nope is not in the catalog."]);
    expect(errors({ overrides: { developer: { candidates: [{ provider: "alpha", model: "zzz" }] } } })).toEqual(["Model zzz is not offered by alpha."]);
    expect(errors({ overrides: { developer: { candidates: [{ provider: "alpha", model: "m2" }] } } })).toEqual(["Model m2 of alpha is not selectable."]);
    expect(errors({ overrides: { developer: { candidates: [{ provider: "gamma" }] } } })).toEqual(["Provider gamma is disabled."]);
  });

  it("warns, without failing, when a provider is not ready", () => {
    const result = validateRolesConfig({ overrides: { qa: { candidates: [{ provider: "beta" }] } } }, catalog);
    expect(result.ok).toBe(true);
    expect(result.issues).toEqual([{ severity: "warning", roleId: "qa", message: "Provider beta is error." }]);
  });

  it("rejects duplicate candidates and overrides for unknown roles", () => {
    expect(errors({ overrides: { qa: { candidates: [{ provider: "alpha" }, { provider: "alpha" }] } } })).toEqual(["Duplicate candidate alpha."]);
    expect(errors({ overrides: { ghost: { instructions: "hi" } } })).toEqual(["Override for unknown role ghost."]);
  });

  it("checks structure only when there is no catalog", () => {
    expect(errors({ overrides: { qa: { candidates: [{ provider: "anything" }] } } }, false)).toEqual([]);
  });

  it("still resolves the seven built-ins when the config is invalid", () => {
    const result = validateRolesConfig("garbage");
    expect(result.ok).toBe(false);
    expect(result.roles).toHaveLength(7);
  });
});

describe("no Agent Profiles", () => {
  it("never touches Paseo Agent Profiles or provider config from the plugin sources", async () => {
    const { readdir, readFile } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const files: string[] = [];
    for (const dir of ["server", "shared", "client"]) for (const f of await readdir(dir)) files.push(join(dir, f));
    files.push("index.server.ts", "index.client.tsx");
    for (const file of files) {
      const text = await readFile(file, "utf8");
      expect(text, file).not.toMatch(/agentProfile|agent_profile|\.profiles\b|config\.(set|write|update)/i);
    }
  });

  it("serves the seven roles through the plugin entry", async () => {
    const { default: contribute } = await import("../index.server");
    const { createMockServer } = await import("./mock-sdk");
    const { rolesListRpc } = await import("../shared/roles");
    const mock = createMockServer();
    contribute(mock.server);
    const result = await mock.call(rolesListRpc, {});
    expect(result.ok && result.data.roles.map((r) => r.id)).toEqual([...BUILTIN_ROLE_IDS]);
  });
});
