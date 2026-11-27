import { z } from "zod";
import { capability } from "./roles";
import { defineZelqioRpc } from "./rpc";

const reference = z.string().regex(/^[A-Za-z0-9_.-]{1,128}$/);
const epoch = z.number().int().nonnegative();

export const runStatus = z.enum(["queued", "running", "waiting_quota", "delivered", "failed", "cancelled"]);
export type RunStatus = z.infer<typeof runStatus>;

const historyKind = z.enum(["queued", "started", "exhausted", "reassigned", "waiting", "resumed", "delivered", "failed", "cancelled"]);

const target = z.strictObject({ agentId: reference, provider: z.string().min(1), model: z.string().min(1), startedAt: epoch });

/** One user request coordinated across native Paseo agents. The prompt stays local, in the plugin's own state. */
export const runRecord = z.strictObject({
  id: reference,
  prompt: z.string().min(1).max(20_000),
  role: reference,
  capability,
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
  pending: z.strictObject({ kind: z.enum(["create", "resume"]), key: reference }).nullable(),
  /** The last error text already handled, so the same failure is not processed twice. */
  handledError: z.string().nullable(),
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
  cwd: z.string().min(1),
  role: reference.default("developer"),
  capability: capability.default("implement"),
});

export const runsSubmitRpc = defineZelqioRpc({ name: "runs.submit", input: runSubmitInput, data: runRecord });
export const runsListRpc = defineZelqioRpc({ name: "runs.list", input: z.strictObject({}), data: z.strictObject({ runs: z.array(runRecord) }) });
export const runsCancelRpc = defineZelqioRpc({ name: "runs.cancel", input: z.strictObject({ id: reference }), data: runRecord });
