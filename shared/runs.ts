import { z } from "zod";
import { capability } from "./roles";
import { defineZelqioRpc } from "./rpc";
import { effectiveValues } from "./scoped-settings";
import { projectKey, sessionOverride } from "./settings";

const reference = z.string().regex(/^[A-Za-z0-9_.-]{1,128}$/);
const epoch = z.number().int().nonnegative();

export const runStatus = z.enum(["queued", "running", "waiting_quota", "delivered", "failed", "cancelled"]);
export type RunStatus = z.infer<typeof runStatus>;

const historyKind = z.enum(["queued", "started", "exhausted", "reassigned", "waiting", "resumed", "delivered", "failed", "cancelled"]);

const target = z.strictObject({ agentId: reference, provider: z.string().min(1), model: z.string().min(1), startedAt: epoch });

export const runGitPlan = z.strictObject({
  repository: z.string().min(1),
  source: z.string().min(1),
  baseRef: z.string().startsWith("refs/heads/"),
  baseSha: z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/),
  branch: z.string().min(1),
  cwd: z.string().min(1).optional(),
  workspaceId: z.string().min(1).optional(),
});
export type RunGitPlan = z.infer<typeof runGitPlan>;

const runDelivery = z.strictObject({
  state: z.enum(["pending", "no_changes", "local", "remote_denied", "review", "checks", "merged", "direct", "integrated", "blocked", "unmanaged"]),
  sha: z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/).optional(),
  prUrl: z.url({ protocol: /^https$/, hostname: /^github\.com$/ }).optional(),
  reason: z.string().max(200).optional(),
  nextAt: epoch.optional(),
  retired: z.boolean().optional(),
  retained: z.boolean().optional(),
});
export type RunDelivery = z.infer<typeof runDelivery>;

/** One user request coordinated across native Paseo agents. The prompt stays local, in the plugin's own state. */
export const runRecord = z.strictObject({
  id: reference,
  prompt: z.string().min(1).max(20_000),
  role: reference,
  capability,
  /** How demanding the request is. Null means it is estimated from the request. */
  complexity: z.enum(["low", "medium", "high"]).nullable(),
  cwd: z.string().min(1),
  status: runStatus,
  /** The agent that currently owns the work. Earlier agents stay in Paseo untouched. */
  current: target.nullable(),
  attempts: z.number().int().nonnegative(),
  /** Providers that returned a limit, with the time it happened. They stay out until Paseo reports fresh quota. */
  suspended: z.record(z.string(), epoch),
  /** When a waiting run should be checked again. */
  resumeAt: epoch.nullable(),
  /** A side effect started but not confirmed; reconciled on restart so it never runs twice. */
  pending: z.strictObject({ kind: z.enum(["create", "resume", "report"]), key: reference }).nullable(),
  /** The last error text already handled, so the same failure is not processed twice. */
  handledError: z.string().nullable(),
  /** When the user last wrote to the agent as of the stop. A later message means a person took over. */
  userBaseline: epoch.nullable(),
  /** Short name shown in listings; set for delegated tasks. */
  title: z.string().max(200).nullable().default(null),
  /** The run that delegated this one. Only a coordinator delegates, so the tree is one level deep. */
  parentRunId: reference.nullable().default(null),
  /** Delegated tasks of the same coordinator that must be delivered before this one starts. */
  dependsOn: z.array(reference).max(10).default([]),
  /** The coordinator was told that its delegated tasks finished. */
  reported: z.boolean().default(false),
  /** Canonical key of the project the run belongs to (see `normalizeProjectKey`). Absent on older runs. */
  projectKey: projectKey.optional(),
  /** Strategy and mode this run was submitted with. They are a request: the effective values still obey the safety limits. */
  overrides: sessionOverride.optional(),
  /** The values this run resolved to when it started (global, project and session scopes combined). */
  effective: effectiveValues.optional(),
  gitPlan: runGitPlan.optional(),
  delivery: runDelivery.optional(),
  attention: z.boolean(),
  result: z.string().nullable(),
  error: z.string().nullable(),
  history: z.array(z.strictObject({
    at: epoch,
    kind: historyKind,
    provider: z.string().optional(),
    model: z.string().optional(),
    agentId: reference.optional(),
    note: z.string().max(300).optional(),
  })).max(200),
  createdAt: epoch,
  updatedAt: epoch,
});
export type RunRecord = z.infer<typeof runRecord>;

export const runsState = z.strictObject({ runs: z.array(runRecord) }).refine(
  ({ runs }) => new Set(runs.map(run => run.id)).size === runs.length,
  "duplicate run id",
);
export type RunsState = z.infer<typeof runsState>;

export const runSubmitInput = z.strictObject({
  prompt: z.string().trim().min(1).max(20_000),
  title: z.string().trim().min(1).max(100).optional(),
  cwd: z.string().min(1),
  role: reference.default("developer"),
  capability: capability.default("implement"),
  complexity: z.enum(["low", "medium", "high"]).optional(),
  /** Session overrides for this run only. A mode more elevated than the project's is ignored. */
  strategy: sessionOverride.shape.strategy,
  mode: sessionOverride.shape.mode,
});

export const runsSubmitRpc = defineZelqioRpc({ name: "runs.submit", input: runSubmitInput, data: runRecord });
export const runsListRpc = defineZelqioRpc({ name: "runs.list", input: z.strictObject({}), data: z.strictObject({ runs: z.array(runRecord) }) });
export const runsCancelRpc = defineZelqioRpc({ name: "runs.cancel", input: z.strictObject({ id: reference }), data: runRecord });
