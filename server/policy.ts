import {
  ACTION_CLASS,
  policyLayers,
  policyRequest,
  policyRule,
  type PolicyDecision,
  type PolicyLayers,
  type PolicyRequest,
  type PolicyRule,
  type PolicyScope,
} from "../shared/policy";

/** Glob where `*` matches any characters. Every other character is literal (no regular expressions are built). */
export function matchesResource(pattern: string, value: string): boolean {
  const parts = pattern.split("*");
  if (parts.length === 1) return pattern === value;
  const first = parts[0] ?? "";
  const last = parts[parts.length - 1] ?? "";
  if (!value.startsWith(first) || !value.endsWith(last)) return false;
  let position = first.length;
  const limit = value.length - last.length;
  for (const middle of parts.slice(1, -1)) {
    const found = value.indexOf(middle, position);
    if (found === -1 || found + middle.length > limit) return false;
    position = found + middle.length;
  }
  return position <= limit;
}

/** A remote or sensitive allow only counts when it names a specific resource (not absent, not a bare wildcard). */
function isBound(rule: PolicyRule): boolean {
  return rule.resource !== undefined && !/^\*+$/.test(rule.resource);
}

function matches(rule: PolicyRule, request: PolicyRequest): boolean {
  if (rule.action !== request.action) return false;
  if (rule.effect === "allow" && ACTION_CLASS[rule.action] !== "local" && !isBound(rule)) return false;
  if (rule.resource === undefined) return true; // a rule without a resource covers every resource
  // Without a resource to compare, a deny stays conservative (it applies) and an allow does not.
  if (request.resource === undefined) return rule.effect === "deny";
  return matchesResource(rule.resource, request.resource);
}

const SCOPES: PolicyScope[] = ["global", "project", "session"];

/**
 * Decides one request. Deny by default; any matching deny in any scope wins; allows never come from the session
 * scope; remote and sensitive actions need a project allow bound to a resource.
 */
export function evaluate(layersInput: PolicyLayers, requestInput: PolicyRequest): PolicyDecision {
  const parsedRequest = policyRequest.safeParse(requestInput);
  if (!parsedRequest.success) return { effect: "deny", reason: "unknown_action", sessionElevationIgnored: false };
  const request = parsedRequest.data;
  const actionClass = ACTION_CLASS[request.action];

  const parsedLayers = policyLayers.safeParse(layersInput);
  if (!parsedLayers.success) return { effect: "deny", reason: "invalid_policy", sessionElevationIgnored: false };
  const layers = parsedLayers.data;
  const hits = (scope: PolicyScope, effect: "allow" | "deny") => layers[scope].some((r) => r.effect === effect && matches(r, request));

  for (const scope of SCOPES) {
    if (hits(scope, "deny")) return { effect: "deny", reason: `denied_by_${scope}`, sessionElevationIgnored: false };
  }
  const sessionElevationIgnored = hits("session", "allow");

  if (actionClass === "local") {
    if (hits("project", "allow")) return { effect: "allow", reason: "allowed_by_project", sessionElevationIgnored };
    if (hits("global", "allow")) return { effect: "allow", reason: "allowed_by_global", sessionElevationIgnored };
    return { effect: "deny", reason: "no_matching_allow", sessionElevationIgnored };
  }
  if (hits("project", "allow")) return { effect: "allow", reason: "allowed_by_project", sessionElevationIgnored };
  if (hits("global", "allow")) return { effect: "deny", reason: "project_authorization_required", sessionElevationIgnored };
  return { effect: "deny", reason: "no_matching_allow", sessionElevationIgnored };
}

export interface PolicyIssue {
  scope: PolicyScope;
  index: number;
  message: string;
}

/** Static checks for stored policy: rejects rules that would be unsafe or meaningless. */
export function validateLayers(layersInput: unknown): { ok: true; layers: ReturnType<typeof policyLayers.parse> } | { ok: false; issues: PolicyIssue[] } {
  const parsed = policyLayers.safeParse(layersInput);
  if (!parsed.success) {
    return { ok: false, issues: [{ scope: "global", index: -1, message: "The policy does not match the schema." }] };
  }
  const issues: PolicyIssue[] = [];
  for (const scope of SCOPES) {
    parsed.data[scope].forEach((rule, index) => {
      policyRule.parse(rule);
      const actionClass = ACTION_CLASS[rule.action];
      if (rule.effect === "allow" && scope === "session") {
        issues.push({ scope, index, message: "A session cannot grant permissions." });
      }
      if (rule.effect === "allow" && actionClass !== "local") {
        if (scope === "global") issues.push({ scope, index, message: "Remote and sensitive actions are authorized per project, not globally." });
        if (rule.resource === undefined || /^\*+$/.test(rule.resource)) {
          issues.push({ scope, index, message: "Remote and sensitive allows need a specific resource, not a bare wildcard." });
        }
      }
    });
  }
  return issues.length > 0 ? { ok: false, issues } : { ok: true, layers: parsed.data };
}
