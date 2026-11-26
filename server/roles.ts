import {
  BUILTIN_ROLE_IDS,
  rolesConfig,
  roleDefinition,
  type BuiltinRoleId,
  type Candidate,
  type RoleDefinition,
  type RolesConfig,
} from "../shared/roles";
import type { ProviderCatalogData } from "../shared/providers";

/**
 * Built-in roles. An empty candidate list means "no restriction": any provider and model the catalog reports as
 * usable may be considered. No provider or model name is baked in.
 */
const BUILTIN: Record<BuiltinRoleId, Omit<RoleDefinition, "candidates" | "kind">> = {
  orchestrator: { id: "orchestrator", label: "Orchestrator", capabilities: ["plan", "coordinate"] },
  senior_developer: { id: "senior_developer", label: "Senior Developer", capabilities: ["architecture", "implement", "review"] },
  developer: { id: "developer", label: "Developer", capabilities: ["implement"] },
  ui_developer: { id: "ui_developer", label: "UI Developer", capabilities: ["ui", "implement"] },
  reviewer: { id: "reviewer", label: "Reviewer", capabilities: ["review"] },
  qa: { id: "qa", label: "QA", capabilities: ["test"] },
  assistant: { id: "assistant", label: "Assistant", capabilities: ["docs"] },
};

const isBuiltin = (id: string): id is BuiltinRoleId => (BUILTIN_ROLE_IDS as readonly string[]).includes(id);

export interface RoleIssue {
  severity: "error" | "warning";
  roleId?: string;
  message: string;
}

/** Built-ins first (editable only in candidates and instructions), then custom roles. Unknown override keys are ignored. */
export function resolveRoles(configInput: RolesConfig): RoleDefinition[] {
  const config = rolesConfig.parse(configInput);
  const builtin = BUILTIN_ROLE_IDS.map((id): RoleDefinition => {
    const override = Object.prototype.hasOwnProperty.call(config.overrides, id) ? config.overrides[id] : undefined;
    return {
      ...BUILTIN[id],
      kind: "builtin",
      candidates: override?.candidates ?? [],
      ...(override?.instructions ? { instructions: override.instructions } : {}),
    };
  });
  return [...builtin, ...config.custom];
}

function candidateIssues(roleId: string, candidates: Candidate[], catalog: ProviderCatalogData | undefined): RoleIssue[] {
  const issues: RoleIssue[] = [];
  const seen = new Set<string>();
  for (const c of candidates) {
    const key = `${c.provider}\u0000${c.model ?? ""}`;
    if (seen.has(key)) issues.push({ severity: "error", roleId, message: `Duplicate candidate ${c.provider}${c.model ? `/${c.model}` : ""}.` });
    seen.add(key);
    if (!catalog) continue;
    const provider = catalog.providers.find((p) => p.id === c.provider);
    if (!provider) {
      issues.push({ severity: "error", roleId, message: `Provider ${c.provider} is not in the catalog.` });
      continue;
    }
    if (!provider.enabled) issues.push({ severity: "error", roleId, message: `Provider ${c.provider} is disabled.` });
    else if (provider.status !== "ready") issues.push({ severity: "warning", roleId, message: `Provider ${c.provider} is ${provider.status}.` });
    if (c.model) {
      const model = provider.models.find((m) => m.id === c.model);
      if (!model) issues.push({ severity: "error", roleId, message: `Model ${c.model} is not offered by ${c.provider}.` });
      else if (!model.selectable) issues.push({ severity: "error", roleId, message: `Model ${c.model} of ${c.provider} is not selectable.` });
    }
  }
  return issues;
}

/**
 * Validates a stored config: shape, id rules (custom roles cannot reuse a built-in id or each other), overrides that
 * target unknown roles, and candidates against the provider catalog. With no catalog only structure is checked.
 */
export function validateRolesConfig(input: unknown, catalog?: ProviderCatalogData): { ok: boolean; issues: RoleIssue[]; roles: RoleDefinition[] } {
  const parsed = rolesConfig.safeParse(input);
  if (!parsed.success) return { ok: false, issues: [{ severity: "error", message: "The roles configuration does not match the schema." }], roles: resolveRoles({}) };
  const config = parsed.data;
  const issues: RoleIssue[] = [];

  const ids = new Set<string>();
  for (const role of config.custom) {
    if (isBuiltin(role.id)) issues.push({ severity: "error", roleId: role.id, message: `${role.id} is a built-in role id.` });
    if (ids.has(role.id)) issues.push({ severity: "error", roleId: role.id, message: `Duplicate custom role ${role.id}.` });
    ids.add(role.id);
    issues.push(...candidateIssues(role.id, role.candidates, catalog));
  }
  for (const [id, override] of Object.entries(config.overrides)) {
    if (!isBuiltin(id) && !ids.has(id)) issues.push({ severity: "error", roleId: id, message: `Override for unknown role ${id}.` });
    issues.push(...candidateIssues(id, override.candidates ?? [], catalog));
  }
  const usable: RolesConfig = {
    custom: config.custom.filter((r, i) => !isBuiltin(r.id) && config.custom.findIndex((x) => x.id === r.id) === i),
    overrides: Object.fromEntries(Object.entries(config.overrides).filter(([id]) => isBuiltin(id) || ids.has(id))),
  };
  return { ok: !issues.some((i) => i.severity === "error"), issues, roles: resolveRoles(usable) };
}

/** Immutable edits. Each returns a new config; callers validate before saving. */
export function setCandidates(config: RolesConfig, roleId: string, candidates: Candidate[]): RolesConfig {
  const base = rolesConfig.parse(config);
  if (!isBuiltin(roleId)) {
    return { ...base, custom: base.custom.map((r) => (r.id === roleId ? { ...r, candidates } : r)) };
  }
  return { ...base, overrides: { ...base.overrides, [roleId]: { ...base.overrides[roleId], candidates } } };
}

export function addCustomRole(config: RolesConfig, role: Omit<RoleDefinition, "kind">): RolesConfig {
  const base = rolesConfig.parse(config);
  const custom = roleDefinition.parse({ ...role, kind: "custom" });
  return { ...base, custom: [...base.custom, custom as (typeof base.custom)[number]] };
}

export function removeCustomRole(config: RolesConfig, roleId: string): RolesConfig {
  const base = rolesConfig.parse(config);
  const overrides = Object.fromEntries(Object.entries(base.overrides).filter(([id]) => id !== roleId));
  return { ...base, custom: base.custom.filter((r) => r.id !== roleId), overrides };
}
