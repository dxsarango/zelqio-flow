import { defineSettings } from "@getpaseo/plugin";
import { z } from "zod";
import { defineZelqioRpc } from "./rpc";

/** The seven built-in roles. They are plugin concepts and never create or modify Paseo Agent Profiles. */
export const BUILTIN_ROLE_IDS = ["orchestrator", "senior_developer", "developer", "ui_developer", "reviewer", "qa", "assistant"] as const;
export type BuiltinRoleId = (typeof BUILTIN_ROLE_IDS)[number];

/** What a role is good at. Used to match tasks and candidates; it grants no permission. */
export const capability = z.enum(["plan", "coordinate", "implement", "architecture", "ui", "review", "test", "docs"]);
export type Capability = z.infer<typeof capability>;

/**
 * A provider (and optionally a model) the role may run on. Both are opaque ids reported by the provider catalog;
 * the order is the preference order.
 */
export const candidate = z.object({
  provider: z.string().min(1),
  model: z.string().min(1).optional(),
});
export type Candidate = z.infer<typeof candidate>;

const roleId = z
  .string()
  .regex(/^[a-z][a-z0-9_]{1,31}$/, "Use lowercase letters, digits and underscores (2-32 characters, starting with a letter).");

export const roleDefinition = z.object({
  id: roleId,
  kind: z.enum(["builtin", "custom"]),
  label: z.string().min(1).max(60),
  capabilities: z.array(capability).min(1),
  candidates: z.array(candidate).max(20),
  /** Extra guidance for the role. Text only: it cannot change permissions, tools or policy. */
  instructions: z.string().max(2000).optional(),
});
export type RoleDefinition = z.infer<typeof roleDefinition>;

const customRoleDefinition = roleDefinition.extend({ kind: z.literal("custom") });

/** What the user stores: custom roles and candidate/instruction edits for built-in roles. Nothing else is editable. */
export const rolesConfig = z.object({
  custom: z.array(customRoleDefinition).max(30).default([]),
  overrides: z
    .record(
      z.string(),
      z.object({ candidates: z.array(candidate).max(20).optional(), instructions: z.string().max(2000).optional() }),
    )
    .default({}),
});
export type RolesConfig = z.input<typeof rolesConfig>;

export const isBuiltinRole = (id: string): id is BuiltinRoleId => (BUILTIN_ROLE_IDS as readonly string[]).includes(id);

/** Immutable edits. Each returns a new config; callers validate before saving. */
export function setCandidates(config: RolesConfig, roleId: string, candidates: Candidate[]): RolesConfig {
  const base = rolesConfig.parse(config);
  if (!isBuiltinRole(roleId)) {
    return { ...base, custom: base.custom.map((role) => (role.id === roleId ? { ...role, candidates } : role)) };
  }
  return { ...base, overrides: { ...base.overrides, [roleId]: { ...base.overrides[roleId], candidates } } };
}

export function addCustomRole(config: RolesConfig, role: Omit<RoleDefinition, "kind">): RolesConfig {
  const base = rolesConfig.parse(config);
  const custom = customRoleDefinition.parse({ ...role, kind: "custom" });
  return { ...base, custom: [...base.custom, custom] };
}

export function removeCustomRole(config: RolesConfig, roleId: string): RolesConfig {
  const base = rolesConfig.parse(config);
  const overrides = Object.fromEntries(Object.entries(base.overrides).filter(([id]) => id !== roleId));
  return { ...base, custom: base.custom.filter((role) => role.id !== roleId), overrides };
}

export const rolesListRpc = defineZelqioRpc({
  name: "roles.list",
  input: z.object({}),
  data: z.object({ roles: z.array(roleDefinition) }),
});

/** Where the user's role edits live. Host scope, like the general settings. */
export const rolesSettingsDefinition = defineSettings({ id: "roles", scope: "host", version: 1, schema: rolesConfig });
