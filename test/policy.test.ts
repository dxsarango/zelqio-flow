import { describe, expect, it } from "vitest";
import { evaluate, matchesResource, validateLayers } from "../server/policy";
import { ACTION_CLASS, type PolicyLayers, type PolicyRequest } from "../shared/policy";

const allow = (action: string, resource?: string) => ({ effect: "allow" as const, action: action as never, ...(resource ? { resource } : {}) });
const deny = (action: string, resource?: string) => ({ effect: "deny" as const, action: action as never, ...(resource ? { resource } : {}) });
const decide = (layers: PolicyLayers, action: string, resource?: string) =>
  evaluate(layers, { action, ...(resource ? { resource } : {}) } as PolicyRequest);

describe("deny by default", () => {
  it("denies every action with empty policy", () => {
    for (const action of Object.keys(ACTION_CLASS)) {
      expect(decide({}, action, "x")).toMatchObject({ effect: "deny", reason: "no_matching_allow" });
    }
  });

  it("denies an unknown action even if a rule names it", () => {
    expect(decide({ global: [allow("workspace.read")] }, "rm.everything")).toMatchObject({ effect: "deny", reason: "unknown_action" });
  });

  it("fails closed on a malformed policy instead of throwing", () => {
    expect(evaluate({ global: [{ effect: "maybe", action: "workspace.read" }] } as never, { action: "workspace.read" })).toMatchObject({
      effect: "deny",
      reason: "invalid_policy",
    });
  });
});

describe("precedence", () => {
  it("allows a local action granted globally", () => {
    expect(decide({ global: [allow("git.commit")] }, "git.commit")).toMatchObject({ effect: "allow", reason: "allowed_by_global" });
  });

  it("prefers the project allow when both layers allow", () => {
    expect(decide({ global: [allow("git.commit")], project: [allow("git.commit")] }, "git.commit").reason).toBe("allowed_by_project");
  });

  it("lets a deny in any scope beat allows in every other scope", () => {
    for (const scope of ["global", "project", "session"] as const) {
      const layers: PolicyLayers = { global: [allow("git.commit")], project: [allow("git.commit")], [scope]: [deny("git.commit")] };
      expect(decide(layers, "git.commit")).toMatchObject({ effect: "deny", reason: `denied_by_${scope}` });
    }
  });

  it("lets a session narrow a project allow", () => {
    expect(decide({ project: [allow("git.commit")], session: [deny("git.commit")] }, "git.commit").effect).toBe("deny");
  });
});

describe("sessions cannot elevate", () => {
  it("ignores a session allow for a local action and flags it", () => {
    expect(decide({ session: [allow("git.commit")] }, "git.commit")).toEqual({ effect: "deny", reason: "no_matching_allow", sessionElevationIgnored: true });
  });

  it("ignores a session allow for a remote action even when a project rule is scoped elsewhere", () => {
    const layers: PolicyLayers = { project: [allow("git.push", "github.com/o/other")], session: [allow("git.push", "github.com/o/repo")] };
    expect(decide(layers, "git.push", "github.com/o/repo")).toMatchObject({ effect: "deny", sessionElevationIgnored: true });
  });
});

describe("remote and sensitive actions", () => {
  const remote = Object.entries(ACTION_CLASS).filter(([, c]) => c !== "local").map(([a]) => a);

  it("never allows them from a global rule alone", () => {
    for (const action of remote) {
      expect(decide({ global: [allow(action, "target")] }, action, "target")).toMatchObject({ effect: "deny", reason: "project_authorization_required" });
    }
  });

  it("allows them only for the project-authorized target", () => {
    const layers: PolicyLayers = { project: [allow("git.push", "github.com/o/repo")] };
    expect(decide(layers, "git.push", "github.com/o/repo").effect).toBe("allow");
    expect(decide(layers, "git.push", "github.com/o/other").effect).toBe("deny");
    expect(decide(layers, "git.push", "github.com/o/repo-fork").effect).toBe("deny");
  });

  it("does not let an allow cover a request without a resource, but a deny still applies", () => {
    expect(decide({ project: [allow("pr.merge", "github.com/o/repo")] }, "pr.merge").effect).toBe("deny");
    expect(decide({ project: [allow("pr.merge", "github.com/o/repo"), deny("pr.merge", "github.com/o/repo")] }, "pr.merge")).toMatchObject({ reason: "denied_by_project" });
  });

  it("keeps push authorization separate from merge authorization", () => {
    const layers: PolicyLayers = { project: [allow("git.push", "github.com/o/repo")] };
    expect(decide(layers, "pr.merge", "github.com/o/repo").effect).toBe("deny");
    expect(decide(layers, "git.fetch", "github.com/o/repo").effect).toBe("deny");
  });

  it("denies sensitive actions without a matching project allow", () => {
    expect(decide({ global: [allow("spend.incur")] }, "spend.incur", "provider-x").effect).toBe("deny");
    expect(decide({ project: [allow("command.destructive", "rm *")] }, "command.destructive", "rm -rf /").effect).toBe("allow");
  });
});

describe("unbound remote allows (review finding)", () => {
  it("does not let a resource-less project allow authorize a remote action", () => {
    expect(decide({ project: [allow("git.push")] }, "git.push").effect).toBe("deny");
    expect(decide({ project: [allow("pr.merge")] }, "pr.merge", "github.com/o/repo").effect).toBe("deny");
  });

  it("does not let a bare wildcard allow authorize a remote or sensitive action", () => {
    for (const action of Object.entries(ACTION_CLASS).filter(([, c]) => c !== "local").map(([a]) => a)) {
      expect(decide({ project: [allow(action, "*")] }, action, "anything").effect).toBe("deny");
      expect(decide({ project: [allow(action, "**")] }, action, "anything").effect).toBe("deny");
    }
  });

  it("still lets a resource-less allow authorize a local action", () => {
    expect(decide({ project: [allow("git.commit")] }, "git.commit").effect).toBe("allow");
    expect(decide({ project: [allow("git.commit")] }, "git.commit", "any").effect).toBe("allow");
  });

  it("keeps a bare-wildcard deny effective for remote actions", () => {
    expect(decide({ project: [allow("git.push", "github.com/o/repo"), deny("git.push", "*")] }, "git.push", "github.com/o/repo").effect).toBe("deny");
  });
});

describe("resource matching", () => {
  it("matches literally and with * wildcards", () => {
    expect(matchesResource("a/b", "a/b")).toBe(true);
    expect(matchesResource("a/b", "a/bc")).toBe(false);
    expect(matchesResource("a/*", "a/b/c")).toBe(true);
    expect(matchesResource("*/c", "a/b/c")).toBe(true);
    expect(matchesResource("a*c*e", "abcde")).toBe(true);
    expect(matchesResource("a*c*e", "abde")).toBe(false);
    expect(matchesResource("a*b*b", "ab")).toBe(false);
  });

  it("treats regex metacharacters literally", () => {
    expect(matchesResource("a.b", "axb")).toBe(false);
    expect(matchesResource("(x)+", "(x)+")).toBe(true);
    expect(matchesResource("[a-z]", "q")).toBe(false);
  });
});

describe("validateLayers", () => {
  const issues = (layers: unknown) => {
    const r = validateLayers(layers);
    return r.ok ? [] : r.issues.map((i) => `${i.scope}:${i.message}`);
  };

  it("accepts a well-formed policy", () => {
    expect(validateLayers({ global: [allow("workspace.read")], project: [allow("git.push", "github.com/o/repo")], session: [deny("git.push")] }).ok).toBe(true);
  });

  it("rejects session allows", () => {
    expect(issues({ session: [allow("git.commit")] })).toEqual(["session:A session cannot grant permissions."]);
  });

  it("rejects global allows for remote actions", () => {
    expect(issues({ global: [allow("git.push", "github.com/o/repo")] })).toEqual([
      "global:Remote and sensitive actions are authorized per project, not globally.",
    ]);
  });

  it("rejects remote allows without a specific resource", () => {
    expect(issues({ project: [allow("pr.merge")] })).toHaveLength(1);
    expect(issues({ project: [allow("pr.merge", "*")] })).toHaveLength(1);
    expect(issues({ project: [allow("pr.merge", "**")] })).toHaveLength(1);
  });

  it("rejects unknown actions and bad shapes", () => {
    expect(validateLayers({ project: [{ effect: "allow", action: "nope" }] }).ok).toBe(false);
    expect(validateLayers("policy").ok).toBe(false);
  });
});
