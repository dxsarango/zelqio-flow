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

/** What the user stores: custom roles and candidate/instruction edits for built-in roles. Nothing else is editable. */
export const rolesConfig = z.object({
  custom: z.array(roleDefinition.extend({ kind: z.literal("custom") })).max(30).default([]),
  overrides: z
    .record(
      z.string(),
      z.object({ candidates: z.array(candidate).max(20).optional(), instructions: z.string().max(2000).optional() }),
    )
    .default({}),
});
export type RolesConfig = z.input<typeof rolesConfig>;

export const rolesListRpc = defineZelqioRpc({
  name: "roles.list",
  input: z.object({}),
  data: z.object({ roles: z.array(roleDefinition) }),
});
