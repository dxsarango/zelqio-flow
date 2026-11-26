import { z } from "zod";

/**
 * Every action the plugin can ask permission for. The class decides how strictly it is authorized:
 * - local: stays inside the workspace; a global or project allow is enough.
 * - remote: touches a remote (GitHub); needs an explicit project allow bound to a target.
 * - sensitive: spend, access outside the workspace, destructive commands, production; same rule as remote.
 */
export const ACTION_CLASS = {
  "workspace.read": "local",
  "agent.delegate": "local",
  "git.branch.create": "local",
  "git.commit": "local",
  "worktree.cleanup": "local",
  "git.fetch": "remote",
  "git.push": "remote",
  "repo.create": "remote",
  "repo.fork": "remote",
  "pr.create": "remote",
  "pr.merge": "remote",
  "spend.incur": "sensitive",
  "workspace.external_access": "sensitive",
  "command.destructive": "sensitive",
  "production.change": "sensitive",
} as const;

export type ActionId = keyof typeof ACTION_CLASS;
export type ActionClass = (typeof ACTION_CLASS)[ActionId];

export const actionId = z.enum(Object.keys(ACTION_CLASS) as [ActionId, ...ActionId[]]);
export const policyScope = z.enum(["global", "project", "session"]);
export type PolicyScope = z.infer<typeof policyScope>;

export const policyRule = z.object({
  effect: z.enum(["allow", "deny"]),
  action: actionId,
  /**
   * What the rule applies to, for example a canonical remote or branch. `*` inside a value matches any characters.
   * Required (and not a bare wildcard) for allow rules on remote and sensitive actions.
   */
  resource: z.string().min(1).optional(),
});
export type PolicyRule = z.infer<typeof policyRule>;

export const policyLayers = z.object({
  global: z.array(policyRule).default([]),
  project: z.array(policyRule).default([]),
  session: z.array(policyRule).default([]),
});
export type PolicyLayers = z.input<typeof policyLayers>;

export const policyRequest = z.object({ action: actionId, resource: z.string().min(1).optional() });
export type PolicyRequest = z.infer<typeof policyRequest>;

export const decisionReason = z.enum([
  "unknown_action",
  "invalid_policy",
  "denied_by_global",
  "denied_by_project",
  "denied_by_session",
  "allowed_by_global",
  "allowed_by_project",
  "project_authorization_required",
  "no_matching_allow",
]);
export type DecisionReason = z.infer<typeof decisionReason>;

export const policyDecision = z.object({
  effect: z.enum(["allow", "deny"]),
  reason: decisionReason,
  /** True when a session allow was present but ignored because sessions cannot grant permissions. */
  sessionElevationIgnored: z.boolean(),
});
export type PolicyDecision = z.infer<typeof policyDecision>;
