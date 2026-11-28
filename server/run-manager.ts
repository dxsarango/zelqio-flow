import { randomUUID } from "node:crypto";
import { ZelqioError } from "../shared/errors";
import type { ProviderCatalogData } from "../shared/providers";
import type { RolesConfig } from "../shared/roles";
import { runsState, type RunGitPlan, type RunRecord, type RunsState } from "../shared/runs";
import type { ZelqioSettings } from "../shared/settings";
import type { UsageSnapshot } from "../shared/usage";
import type { AttemptJournal } from "./attempt-journal";
import { chooseEffort, estimateComplexity } from "./effort";
import type { GitDelivery } from "./git-delivery";
import { deriveModelFacts, providerQuotas } from "./model-facts";
import { classifyFailure, limitFromReply, redactSecrets } from "./quota-signal";
import { resolveRoles } from "./roles";
import { route, type RoutingTarget } from "./router";
import type { VersionedStore } from "./store";

export interface AgentSnapshot {
  id: string;
  status: "initializing" | "idle" | "running" | "error" | "closed";
  lastError: string | null;
  pendingPermissions: number;
  archived: boolean;
  /** Paseo has a persisted session that can be reopened for this agent. */
  restorable: boolean;
  /** When the user last wrote to the agent, in epoch milliseconds. Used to notice that a person took over. */
  lastUserMessageAt: number | null;
  /** When Paseo last updated the agent, in epoch milliseconds. Absent when the source cannot say. */
  updatedAt?: number | null;
  /** When the turn in progress started, in epoch milliseconds. */
  turnStartedAt?: number | null;
}

export interface CreateAgentInput {
  /** Native Paseo idempotency key: repeating the call with the same key returns the same agent. */
  key: string;
  provider: string;
  model: string;
  cwd: string;
  prompt: string;
  title: string;
  metadata: Record<string, string>;
  /** Paseo agent that delegated this one, so the native parent relation is recorded. */
  parentAgentId?: string;
  /** Reasoning level chosen for the model, when it has recognizable levels. */
  thinkingOptionId?: string;
  workspaceId?: string;
}

/** The part of Paseo the manager uses. The real implementation wraps the SDK; tests use a fake. */
export interface AgentPort {
  create(input: CreateAgentInput): Promise<{ id: string }>;
  snapshot(agentId: string): Promise<AgentSnapshot | null>;
  send(agentId: string, text: string, messageId: string): Promise<void>;
  stop(agentId: string): Promise<void>;
  /** The final answer of the latest turn, if any. */
  lastReply(agentId: string): Promise<string | null>;
  /** A short transcript tail used to brief a replacement agent. */
  recentActivity(agentId: string): Promise<string>;
  /** The first message the user sent to the agent, used when an agent created natively is adopted. */
  firstUserMessage(agentId: string): Promise<string | null>;
  /** Create an empty native workspace so Git can verify placement before the provider starts. */
  createWorktree?(input: RunGitPlan & { key: string }): Promise<{ cwd: string; workspaceId: string }>;
  worktreeInactive?(workspaceId: string, cwd: string, owners: readonly string[]): Promise<boolean>;
}

/** Stands in for the request of an adopted agent until its first message can be read. */
export const ADOPTED_PROMPT = "Continue the task described in the previous agent's conversation.";

export interface RunManagerDeps {
  port: AgentPort;
  store: VersionedStore<RunsState>;
  attempts: AttemptJournal;
  git?: GitDelivery;
  readCatalog(): Promise<ProviderCatalogData>;
  readUsage(): Promise<UsageSnapshot | null>;
  readSettings(): Promise<ZelqioSettings | null>;
  /** The user's role edits and custom roles. Built-in roles apply when absent. */
  readRoles?(): Promise<RolesConfig>;
  clock?: () => number;
  /** Runs that may be active at once. The rest wait in the queue. */
  maxConcurrent?: number;
  /** Agents one run may use before it stops reassigning. */
  maxAttempts?: number;
  /** How long to wait when a provider reports a limit without saying when it ends. */
  defaultWaitMs?: number;
  /** How soon to look again when Paseo has not yet reported recovered quota. */
  recheckMs?: number;
  /** How long a running agent may go without any update before the run is flagged as stalled. Zero turns it off. */
  stallMs?: number;
}

const MAX_REPLY = 6000;
/** Capabilities whose agents edit files. Two of them never share a working directory at the same time. */
const WRITERS = new Set<RunRecord["capability"]>(["implement", "architecture", "ui", "docs", "test", "coordinate"]);
const TERMINAL = new Set<RunRecord["status"]>(["delivered", "failed", "cancelled"]);
const MAX_CHILDREN = 8;
const MAX_HISTORY = 200;
const DEFAULT_STALL_MS = 45 * 60_000;

function clip(text: string | null | undefined, size: number): string | null {
  if (!text) return null;
  return text.length > size ? `${text.slice(0, size)}…` : text;
}

function handoffPrompt(run: RunRecord, activity: string): string {
  return [
    "You are continuing a task that another agent could not finish because its provider reached a usage limit.",
    "Inspect the current state of the workspace first and do not redo work that is already done.",
    "",
    "Original task:",
    redactSecrets(run.prompt),
    "",
    "Recent activity of the previous agent (may be incomplete):",
    redactSecrets(activity) || "(not available)",
  ].join("\n");
}

function childReport(children: RunRecord[]): string {
  const lines = children.map(child => {
    const label = child.title ?? clip(child.prompt, 60) ?? child.id;
    const body = child.status === "delivered" ? clip(child.result, 1500) ?? "(no message)"
      : child.status === "failed" ? `failed: ${child.error ?? "unknown error"}` : child.status;
    return `- ${label} [${child.status}]: ${body}`;
  });
  return ["The delegated tasks finished. Review their results and finish the work.", ...lines].join("\n");
}

/**
 * Coordinates one request across native Paseo agents: it picks an authorized model, lets Paseo run the agent, and
 * reacts to the outcome. When a provider reaches its limit it keeps the work, then either hands it to another
 * authorized provider or waits for the quota Paseo reports to recover and resumes the same agent.
 * It uses the user's own provider settings and Paseo's quota reports; it never changes accounts, enables credits or
 * verifies billing.
 */
export class RunManager {
  private readonly clock: () => number;
  private readonly maxConcurrent: number;
  private readonly maxAttempts: number;
  private readonly defaultWaitMs: number;
  private readonly recheckMs: number;
  private readonly stallMs: number;
  private chain: Promise<unknown> = Promise.resolve();

  constructor(private readonly deps: RunManagerDeps) {
    this.clock = deps.clock ?? Date.now;
    this.maxConcurrent = deps.maxConcurrent ?? 3;
    this.maxAttempts = deps.maxAttempts ?? 5;
    this.defaultWaitMs = deps.defaultWaitMs ?? 30 * 60_000;
    this.recheckMs = deps.recheckMs ?? 5 * 60_000;
    this.stallMs = deps.stallMs ?? DEFAULT_STALL_MS;
  }

  /** Runs every mutation one at a time so a run is never processed twice at once. */
  private exclusive<T>(work: () => Promise<T>): Promise<T> {
    const next = this.chain.then(work, work);
    this.chain = next.catch(() => undefined);
    return next;
  }

  /** True while any run is running or waiting for a quota that is expected to come back. */
  async hasWork(): Promise<boolean> {
    return (await this.list()).some(run => run.status === "running" || run.status === "waiting_quota");
  }

  list(): Promise<RunRecord[]> {
    return this.deps.store.update(state => ({ result: state.runs }));
  }

  submit(input: { prompt: string; cwd: string; title?: string; role?: string; capability?: RunRecord["capability"]; complexity?: RunRecord["complexity"] }): Promise<RunRecord> {
    return this.exclusive(async () => {
      const now = this.clock();
      const run: RunRecord = {
        id: `run-${randomUUID()}`,
        prompt: input.prompt,
        role: input.role ?? "developer",
        capability: input.capability ?? "implement",
        complexity: input.complexity ?? null,
        cwd: input.cwd,
        status: "queued",
        current: null,
        attempts: 0,
        suspended: {},
        resumeAt: null,
        pending: null,
        handledError: null,
        userBaseline: null,
        title: input.title ?? clip(input.prompt.split(/\r?\n/, 1)[0], 100),
        parentRunId: null,
        dependsOn: [],
        reported: false,
        attention: false,
        result: null,
        error: null,
        history: [{ at: now, kind: "queued" }],
        createdAt: now,
        updatedAt: now,
      };
      if (!resolveRoles(await this.roles()).some(role => role.id === run.role)) throw new ZelqioError("invalid_input", `Unknown role: ${run.role}`);
      await this.save(run, true);
      await this.startQueued();
      return (await this.find(run.id)) ?? run;
    });
  }

  /**
   * Brings an agent that Paseo already created (for example from the native New Agent screen with Automatic on) under
   * the same coordination as a submitted request: its limits are handled, its answer is delivered.
   */
  adopt(input: { agentId: string; provider: string; model: string; cwd: string; prompt?: string; role?: string }): Promise<RunRecord> {
    return this.exclusive(async () => {
      const existing = (await this.list()).find(run => run.current?.agentId === input.agentId);
      if (existing) return existing;
      const now = this.clock();
      const prompt = input.prompt ?? (await this.deps.port.firstUserMessage(input.agentId).catch(() => null)) ?? ADOPTED_PROMPT;
      const id = `run-${randomUUID()}`;
      // The checkout stays where Paseo put it. Its state now is the baseline that tells the run's changes from others.
      const adopted = (await this.deps.git?.baseline(input.cwd)) ?? undefined;
      const run: RunRecord = {
        id, prompt: clip(prompt, 20_000) ?? ADOPTED_PROMPT, role: input.role ?? "developer", capability: "implement", complexity: null, cwd: input.cwd,
        status: "running",
        current: { agentId: input.agentId, provider: input.provider, model: input.model, startedAt: now },
        attempts: 1, suspended: {}, resumeAt: null, pending: null, handledError: null, userBaseline: null, title: null, parentRunId: null, dependsOn: [], reported: false, attention: false, result: null, error: null,
        ...(adopted ? { adopted, delivery: { state: "pending" as const } } : this.deps.git ? { delivery: { state: "unmanaged" as const } } : {}),
        history: [{ at: now, kind: "started", provider: input.provider, model: input.model, agentId: input.agentId, note: "adopted" }],
        createdAt: now, updatedAt: now,
      };
      await this.deps.attempts.reserve({ key: `${id}-a1`, task: id, attempt: 1, maxConcurrent: this.maxConcurrent + 8 }).catch(() => undefined);
      await this.deps.attempts.confirmLaunch({ key: `${id}-a1`, agentRef: input.agentId }).catch(() => undefined);
      await this.save(run, true);
      return run;
    });
  }

  cancel(id: string): Promise<RunRecord> {
    return this.exclusive(async () => {
      const run = await this.find(id);
      if (!run) throw new ZelqioError("not_found", "Run not found.");
      if (TERMINAL.has(run.status)) return run;
      for (const child of (await this.list()).filter(entry => entry.parentRunId === run.id && !TERMINAL.has(entry.status))) {
        await this.stopRun(child, "the coordinator run was stopped");
      }
      return this.stopRun(run);
    });
  }

  /**
   * A coordinator agent hands one self-contained task to another agent. The model is chosen like for any run, from the
   * models the user authorized; the coordinator only names the work. Only a root run can delegate, so delegation does
   * not recurse, and the number of delegated tasks is bounded.
   */
  delegate(coordinatorAgentId: string, input: {
    title: string; prompt: string; role?: string; capability?: RunRecord["capability"];
    complexity?: RunRecord["complexity"]; dependsOn?: string[];
  }): Promise<RunRecord> {
    return this.exclusive(async () => {
      const runs = await this.list();
      const parent = runs.find(run => run.current?.agentId === coordinatorAgentId && run.parentRunId === null
        && (run.status === "running" || run.status === "waiting_quota"));
      if (!parent) throw new ZelqioError("invalid_input", "Only a coordinator run can delegate tasks.");
      const children = runs.filter(run => run.parentRunId === parent.id);
      if (children.length >= MAX_CHILDREN) throw new ZelqioError("invalid_input", `A run can delegate at most ${MAX_CHILDREN} tasks.`);
      const dependsOn = [...new Set(input.dependsOn ?? [])];
      for (const id of dependsOn) {
        if (!children.some(child => child.id === id)) throw new ZelqioError("invalid_input", `Unknown task to depend on: ${id}`);
      }
      const role = input.role ?? "developer";
      if (!resolveRoles(await this.roles()).some(entry => entry.id === role)) throw new ZelqioError("invalid_input", `Unknown role: ${role}`);
      const now = this.clock();
      const child: RunRecord = {
        id: `run-${randomUUID()}`, prompt: input.prompt, role, capability: input.capability ?? "implement",
        complexity: input.complexity ?? null, cwd: parent.gitPlan?.cwd ?? parent.cwd, status: "queued", current: null, attempts: 0, suspended: {},
        resumeAt: null, pending: null, handledError: null, userBaseline: null, title: clip(input.title, 120),
        parentRunId: parent.id, dependsOn, reported: false, attention: false, result: null, error: null,
        history: [{ at: now, kind: "queued", note: "delegated" }], createdAt: now, updatedAt: now,
      };
      await this.save(child, true);
      await this.startQueued();
      return (await this.find(child.id)) ?? child;
    });
  }

  /** The delegated tasks of the coordinator that owns this agent. */
  children(coordinatorAgentId: string): Promise<RunRecord[]> {
    return this.exclusive(async () => {
      const runs = await this.list();
      const parent = runs.find(run => run.current?.agentId === coordinatorAgentId && run.parentRunId === null);
      return parent ? runs.filter(run => run.parentRunId === parent.id) : [];
    });
  }

  /** Stops one delegated task of this coordinator. */
  cancelChild(coordinatorAgentId: string, childId: string): Promise<RunRecord> {
    return this.exclusive(async () => {
      const runs = await this.list();
      const parent = runs.find(run => run.current?.agentId === coordinatorAgentId && run.parentRunId === null);
      const child = parent ? runs.find(run => run.id === childId && run.parentRunId === parent.id) : undefined;
      if (!child) throw new ZelqioError("not_found", "Delegated task not found.");
      if (TERMINAL.has(child.status)) return child;
      return this.stopRun(child);
    });
  }

  /** Looks at every active run once. Called on a timer, on agent updates and after a restart. */
  tick(): Promise<void> {
    return this.exclusive(async () => {
      // Delegated tasks first, so a coordinator sees their outcome in the same pass.
      const runs = [...(await this.list())].sort((a, b) => Number(b.parentRunId !== null) - Number(a.parentRunId !== null));
      for (const run of runs) {
        const latest = (await this.find(run.id)) ?? run;
        try {
          if (latest.status === "running") await this.reconcile(latest);
          else if (latest.status === "waiting_quota" && latest.resumeAt !== null && this.clock() >= latest.resumeAt) await this.recover(latest);
          else if (TERMINAL.has(latest.status)) await this.advanceDelivery(latest);
        } catch (error) {
          // One broken run must not stop the others. It is retried on the next pass.
          void error;
        }
      }
      await this.startQueued();
    });
  }

  /**
   * Call once when the plugin starts. Attempts that were in flight become ambiguous, never repeated blindly:
   * an agent that was being created is requested again with the same native idempotency key, so Paseo returns the
   * agent it already made, and a resume that may not have been sent is reconciled against the agent's real state.
   */
  recoverAfterRestart(): Promise<void> {
    return this.exclusive(async () => {
      await this.deps.attempts.recoverAfterRestart();
      for (const run of await this.list()) {
        if (TERMINAL.has(run.status)) {
          await this.advanceDelivery(run).catch(() => undefined);
          continue;
        }
        if (run.status !== "running" && run.status !== "waiting_quota") continue;
        try {
          if (run.pending?.kind === "create" && (!run.current || run.gitPlan)) await this.launch(run, null, undefined, true);
          const entry = (await this.deps.attempts.read()).entries.find(item => item.key === `${run.id}-a${run.attempts}`);
          if (entry?.status === "ambiguous") {
            await this.deps.attempts.resolveAmbiguous({ key: entry.key, outcome: entry.agentRef ? "failed" : "not_launched", evidenceRef: "restart-reconciled" }).catch(() => undefined);
          }
        } catch (error) {
          void error;
        }
      }
    });
  }

  /** Reconciles the run that owns this agent, if any. Safe to call for every Paseo agent update. */
  onAgentUpdate(agentId: string, hint?: { error?: { message: string; code?: string | null } }): Promise<void> {
    return this.exclusive(async () => {
      const run = (await this.list()).find(entry => entry.current?.agentId === agentId
        && (entry.status === "running" || entry.status === "waiting_quota"));
      if (run?.status === "running") await this.reconcile(run, hint);
      else if (run?.status === "waiting_quota") {
        const snapshot = await this.deps.port.snapshot(agentId);
        if (snapshot) await this.stopForTakeover(run, snapshot);
      }
    });
  }

  // ---- internals (always called inside exclusive) ----

  private async find(id: string): Promise<RunRecord | undefined> {
    return (await this.list()).find(run => run.id === id);
  }

  private async stopRun(run: RunRecord, note?: string): Promise<RunRecord> {
    // Keep its slot and writer reservation until the native session acknowledges the stop.
    if (run.parentRunId && run.current && run.status === "running") {
      await this.deps.port.stop(run.current.agentId);
    }
    const unconfirmedPlacement = run.gitPlan && run.pending?.kind === "create";
    const next = this.note({ ...run, status: "cancelled", resumeAt: null, pending: null, attention: false, stall: undefined,
      ...(unconfirmedPlacement ? { delivery: { state: "blocked" as const, reason: "operation_uncertain", retained: true } } : {}),
    }, "cancelled", { note });
    await this.save(next);
    if (run.attempts > 0) {
      await this.deps.attempts.settle({ key: `${run.id}-a${run.attempts}`, outcome: "failed", evidenceRef: "cancelled" }).catch(() => undefined);
    }
    await this.advanceDelivery(next);
    return (await this.find(run.id)) ?? next;
  }

  private async save(run: RunRecord, isNew = false): Promise<void> {
    const updated = { ...run, updatedAt: this.clock(), history: run.history.slice(-MAX_HISTORY) };
    await this.deps.store.update(state => {
      const exists = state.runs.some(entry => entry.id === updated.id);
      if (isNew && exists) return { result: undefined };
      const runs = exists ? state.runs.map(entry => (entry.id === updated.id ? updated : entry)) : [...state.runs, updated];
      return { result: undefined, next: runsState.parse({ runs }) };
    });
  }

  private note(run: RunRecord, kind: RunRecord["history"][number]["kind"], extra: Partial<RunRecord["history"][number]> = {}): RunRecord {
    return { ...run, history: [...run.history, { at: this.clock(), kind, ...extra }] };
  }

  private async roles(): Promise<RolesConfig> {
    return (await this.deps.readRoles?.().catch(() => ({}))) ?? {};
  }

  private async context() {
    const [settings, catalog, usage, roles] = await Promise.all([this.deps.readSettings(), this.deps.readCatalog(), this.deps.readUsage(), this.roles()]);
    if (!settings) throw new ZelqioError("unavailable", "Zelqio settings are unavailable.");
    return { settings, catalog, usage, roles };
  }

  private choose(
    run: RunRecord,
    ctx: Awaited<ReturnType<RunManager["context"]>>,
    options: { continuity?: RoutingTarget; suspended?: RunRecord["suspended"] } = {},
  ) {
    const role = resolveRoles(ctx.roles).find(entry => entry.id === run.role);
    if (!role) throw new ZelqioError("invalid_input", `Unknown role: ${run.role}`);
    const models = deriveModelFacts({
      catalog: ctx.catalog, settings: ctx.settings, usage: ctx.usage, now: this.clock(), suspended: options.suspended ?? run.suspended,
    });
    return route({
      catalog: ctx.catalog, settings: ctx.settings, role, capability: run.capability, models,
      continuity: options.continuity, allowUnknownQuota: true,
    });
  }

  private async startQueued(): Promise<void> {
    for (;;) {
      const runs = await this.list();
      const open = (parent: RunRecord) => runs.some(child => child.parentRunId === parent.id && !TERMINAL.has(child.status));
      // A coordinator waiting for its delegated tasks is idle, so it does not hold a slot.
      const active = runs.filter(run => (run.status === "running" || run.status === "waiting_quota") && !(run.parentRunId === null && open(run))).length;
      if (active >= this.maxConcurrent) return;
      let started = false;
      for (const next of runs.filter(run => run.status === "queued")) {
        const parent = next.parentRunId ? runs.find(run => run.id === next.parentRunId) : undefined;
        if (parent && TERMINAL.has(parent.status)) {
          await this.save(this.note({ ...next, status: "cancelled", error: "The coordinator run has stopped." }, "cancelled"));
          started = true;
          break;
        }
        const blockers = next.dependsOn.map(id => runs.find(run => run.id === id));
        const broken = blockers.find(dep => !dep || dep.status === "failed" || dep.status === "cancelled");
        if (broken !== undefined || blockers.some(dep => dep === undefined)) {
          await this.save(this.note({ ...next, status: "failed", error: "A task it depends on did not finish." }, "failed"));
          started = true;
          break;
        }
        if (blockers.some(dep => dep?.status !== "delivered")) continue;
        if (blockers.some(dep => dep?.gitPlan && !["integrated", "no_changes"].includes(dep.delivery?.state ?? ""))) continue;
        let prepared = next;
        if (this.deps.git && this.deps.port.createWorktree && WRITERS.has(next.capability) && !next.gitPlan) {
          try {
            const gitPlan = await this.deps.git.plan(next.cwd, next);
            if (gitPlan) {
              prepared = { ...next, gitPlan, delivery: { state: "pending" } };
              await this.save(prepared);
            }
          } catch {
            await this.save(this.note({ ...next, status: "failed", delivery: { state: "blocked", reason: "isolation_unverified" } }, "failed"));
            started = true;
            break;
          }
        }
        if (!prepared.gitPlan && WRITERS.has(next.capability) && runs.some(other =>
          other.id !== next.id && !other.gitPlan && other.cwd === next.cwd && WRITERS.has(other.capability)
          && (this.deps.git ? other.id !== next.parentRunId : other.parentRunId !== null)
          && (other.status === "running" || other.status === "waiting_quota"))) continue;
        if (parent?.gitPlan?.cwd && !prepared.gitPlan && WRITERS.has(next.capability) && parent.current) {
          const coordinator = await this.deps.port.snapshot(parent.current.agentId);
          if (!coordinator || coordinator.status === "running" || coordinator.status === "initializing" || coordinator.pendingPermissions) continue;
        }
        await this.launch(prepared, null);
        started = true;
        break;
      }
      if (!started) return;
    }
  }

  /** Starts the run on the best authorized target, or on `forced` when a handoff already chose one. */
  private async launch(run: RunRecord, handoff: string | null, forced?: RoutingTarget, retry = false): Promise<void> {
    let ctx;
    try {
      ctx = await this.context();
    } catch (error) {
      await this.save(this.note({ ...run, status: "failed", error: error instanceof ZelqioError ? error.message : "Unavailable." }, "failed"));
      return;
    }
    const decision = forced ? { selected: forced } : this.choose(run, ctx, { continuity: run.current ?? undefined });
    const target = decision.selected;
    if (!target) {
      const reasons = "excluded" in decision ? [...new Set((decision as ReturnType<RunManager["choose"]>).excluded.map(entry => entry.reason))].join(", ") : "";
      await this.save(this.note({ ...run, status: "failed", error: `No authorized model is available${reasons ? ` (${reasons})` : ""}.` }, "failed"));
      return;
    }
    const parentAgentId = run.parentRunId
      ? (await this.list()).find(entry => entry.id === run.parentRunId)?.current?.agentId
      : undefined;
    const attempt = retry ? run.attempts : run.attempts + 1;
    const key = `${run.id}-a${attempt}`;
    const reserved = await this.deps.attempts.reserve({ key, task: run.id, attempt, maxConcurrent: this.maxConcurrent + 8 });
    if (reserved.status === "blocked") {
      await this.save(this.note({ ...run, status: "failed", error: `Could not reserve the attempt (${reserved.reason}).` }, "failed"));
      return;
    }
    const model = ctx.catalog.providers.find(entry => entry.id === target.provider)?.models.find(entry => entry.id === target.model);
    const remaining = providerQuotas(ctx.usage, this.clock()).get(target.provider)?.remainingPct;
    const thinkingOptionId = chooseEffort(model?.thinkingOptions ?? [], {
      complexity: run.complexity ?? estimateComplexity(run.prompt),
      strategy: ctx.settings.strategy,
      quotaLow: remaining !== null && remaining !== undefined && remaining <= 30,
    });
    let working: RunRecord = { ...run, status: "running", attempts: attempt, pending: { kind: "create", key }, resumeAt: null };
    await this.save(working);
    try {
      if (working.gitPlan && !working.gitPlan.cwd) {
        const plan = working.gitPlan;
        const native = await this.deps.port.createWorktree!({ ...plan, key: run.id });
        const attached = await this.deps.git!.attach(plan, native.cwd, native.workspaceId);
        working = { ...working, gitPlan: attached };
        await this.save(working);
      }
      const delegatedReader = Boolean(run.parentRunId && this.deps.git && !WRITERS.has(run.capability));
      const created = await this.deps.port.create({
        key, provider: target.provider, model: target.model, cwd: working.gitPlan?.cwd ?? run.cwd,
        workspaceId: working.gitPlan?.workspaceId,
        prompt: (handoff ?? (run.parentRunId ? `${run.prompt}\n\n(Delegated task${run.title ? `: ${run.title}` : ""}. Finish with a concise report of what you did.)` : run.prompt)) +
          (delegatedReader ? "\n\nRead-only task: inspect and report. Do not modify files, Git state, or remotes." : working.gitPlan
            ? "\n\nWork in the assigned checkout. Leave commits and remote publication to Zelqio Flow. Keep the checkout clean before delegating work that needs your changes." : ""),
        title: `Zelqio · ${run.title ?? clip(run.prompt, 48)}`,
        metadata: { "zelqio.run": run.id, "zelqio.attempt": String(attempt), ...(run.parentRunId ? { "zelqio.parent": run.parentRunId } : {}) },
        ...(parentAgentId ? { parentAgentId } : {}),
        ...(thinkingOptionId ? { thinkingOptionId } : {}),
      });
      await this.deps.attempts.confirmLaunch({ key, agentRef: created.id }).catch(() => undefined);
      working = this.note({
        ...working,
        current: { agentId: created.id, provider: target.provider, model: target.model, startedAt: this.clock() },
        pending: null, handledError: null,
      }, handoff ? "reassigned" : "started", { provider: target.provider, model: target.model, agentId: created.id });
      await this.save(working);
    } catch (error) {
      await this.deps.attempts.settle({ key, outcome: "failed", evidenceRef: "create-failed" }).catch(() => undefined);
      await this.save(this.note({ ...working, status: "failed", pending: null,
        ...(working.gitPlan ? { delivery: { state: "blocked" as const, reason: "isolation_unverified", retained: true } } : {}),
        error: working.gitPlan ? "Could not create the agent in its verified worktree." :
          clip(error instanceof Error ? error.message : "Could not create the agent.", 300) }, "failed"));
    }
  }

  private async reconcile(run: RunRecord, hint?: { error?: { message: string; code?: string | null } }): Promise<void> {
    if (!run.current) return;
    const snapshot = await this.deps.port.snapshot(run.current.agentId);
    const children = run.parentRunId === null ? (await this.list()).filter(entry => entry.parentRunId === run.id) : [];
    const reportKey = `${run.id}-c`;
    // Earlier versions used a quota-resume marker for a report.
    const pendingReport = run.pending?.kind === "report" || (run.pending?.kind === "resume" && run.pending.key === reportKey);
    const needsReport = children.length > 0 && (!run.reported || pendingReport);
    const canRestoreForReport = snapshot?.status === "closed" && snapshot.restorable && needsReport;
    if (!snapshot || snapshot.archived || (snapshot.status === "closed" && !canRestoreForReport)) {
      await this.save(this.note({ ...run, status: "failed", error: "The agent is no longer available.", attention: false, stall: undefined }, "failed", { agentId: run.current.agentId }));
      return;
    }
    if (snapshot.status === "initializing" || snapshot.status === "running") {
      const confirmed = run.pending?.kind === "resume" && !pendingReport ? { ...run, pending: null } : run;
      // A stall is flagged for the person, never acted on: the agent is not stopped, resent to or replaced.
      const lastProgressAt = this.stalledSince(snapshot);
      const attention = snapshot.pendingPermissions > 0 || lastProgressAt !== undefined;
      const stallChanged = (lastProgressAt !== undefined) !== (run.stall !== undefined);
      if (attention !== run.attention || confirmed !== run || stallChanged) {
        let next: RunRecord = { ...confirmed, attention, stall: lastProgressAt === undefined ? undefined : { lastProgressAt } };
        if (stallChanged) {
          next = lastProgressAt === undefined
            ? this.note(next, "progress", { agentId: run.current.agentId, ...(snapshot.pendingPermissions > 0 ? { note: "waiting for a permission" } : {}) })
            : this.note(next, "stalled", { agentId: run.current.agentId,
              note: `no progress for ${Math.floor((this.clock() - lastProgressAt) / 60_000)} minutes` });
        }
        await this.save(next);
      }
      return;
    }
    if (pendingReport) {
      await this.sendReport(run, children, reportKey);
      return;
    }
    if (run.pending?.kind === "resume") {
      // The resume was recorded but the agent is not running: send it again with the same message id.
      await this.deps.port.send(run.current.agentId, "The usage limit was restored. Continue the task from where you stopped.", run.pending.key);
      await this.confirmResume(run);
      return;
    }
    if ((snapshot.status === "idle" || canRestoreForReport) && !snapshot.lastError && !hint?.error) {
      const full = await this.deps.port.lastReply(run.current.agentId);
      const limit = limitFromReply(full, this.clock());
      if (limit && full !== run.handledError) {
        await this.exhausted({ ...run, userBaseline: snapshot.lastUserMessageAt }, full ?? "", limit.resetsAt, false, true);
        return;
      }
      // Integrate completed writers before waiting for dependents that need their commits.
      const reportedChildren = needsReport ? await this.integrateChildren(run, children) : children;
      if (!reportedChildren || reportedChildren.some(child => !TERMINAL.has(child.status))) return;
      if (needsReport) {
        await this.save({ ...run, pending: { kind: "report", key: reportKey } });
        await this.sendReport(run, reportedChildren, reportKey);
        return;
      }
      const reply = clip(full, MAX_REPLY);
      await this.deps.attempts.settle({ key: `${run.id}-a${run.attempts}`, outcome: "succeeded", evidenceRef: "agent-idle" }).catch(() => undefined);
      const delivered = this.note({ ...run, status: "delivered", result: reply ?? "The agent finished without a final message.",
        attention: false, stall: undefined, pending: null, ...(run.gitPlan || run.adopted ? { userBaseline: snapshot.lastUserMessageAt } : {}) }, "delivered", { agentId: run.current.agentId });
      await this.save(delivered);
      await this.advanceDelivery(delivered);
      return;
    }
    const message = snapshot.lastError ?? hint?.error?.message ?? "The agent reported an error.";
    if (message === run.handledError) return;
    const signal = classifyFailure(message, this.clock(), hint?.error?.code);
    if (signal.kind === "other") {
      await this.deps.attempts.settle({ key: `${run.id}-a${run.attempts}`, outcome: "failed", evidenceRef: "agent-error" }).catch(() => undefined);
      await this.save(this.note({ ...run, status: "failed", error: clip(message, 300), handledError: message, attention: false, stall: undefined }, "failed", { agentId: run.current.agentId }));
      return;
    }
    await this.exhausted({ ...run, userBaseline: snapshot.lastUserMessageAt }, message, signal.resetsAt, signal.kind === "rate_limit");
  }

  /**
   * The last time a running agent made progress, when it has been quiet for longer than the threshold. An agent that
   * waits for a permission, is not running, or has no known update time is never reported as stalled.
   */
  private stalledSince(snapshot: AgentSnapshot): number | undefined {
    if (this.stallMs <= 0 || snapshot.status !== "running" || snapshot.pendingPermissions > 0) return undefined;
    const last = Math.max(snapshot.updatedAt ?? 0, snapshot.turnStartedAt ?? 0);
    return last > 0 && this.clock() - last > this.stallMs ? last : undefined;
  }

  private async integrateChildren(run: RunRecord, children: RunRecord[]): Promise<RunRecord[] | null> {
    const git = this.deps.git;
    if (!git || !run.gitPlan) return children;
    if (children.some(child => !WRITERS.has(child.capability) && child.status === "running")) return null;
    for (const child of children) {
      if (!child.gitPlan || child.status !== "delivered") continue;
      if (child.delivery?.state === "pending") await this.advanceDelivery(child);
      const fresh = (await this.find(child.id)) ?? child;
      if (fresh.delivery?.state === "no_changes" || fresh.delivery?.state === "integrated") continue;
      if (fresh.delivery?.state !== "local" && fresh.delivery?.state !== "blocked") return null;
      const outcome = fresh.delivery.state === "local" ? await git.integrate(fresh, run) : fresh.delivery;
      const delivered = { ...fresh, delivery: outcome };
      await this.save(delivered);
      if (outcome.state === "integrated") await this.advanceDelivery(delivered);
      if (outcome.state === "blocked") {
        await this.save(this.note({ ...run, status: "failed", attention: true,
          delivery: { state: "blocked", reason: outcome.reason, retained: true },
          error: "Delegated Git integration stopped. Review the child and coordinator branches." }, "failed"));
        return null;
      }
    }
    return (await this.list()).filter(entry => entry.parentRunId === run.id);
  }

  private async sendReport(run: RunRecord, children: RunRecord[], key: string): Promise<void> {
    await this.deps.port.send(run.current!.agentId, childReport(children), key);
    await this.save({ ...run, reported: true, pending: null });
  }

  private async advanceDelivery(original: RunRecord): Promise<void> {
    const git = this.deps.git;
    let run = original;
    if (!git || !run.gitPlan?.cwd && !run.adopted) return;
    let delivery = run.delivery;
    if (run.status === "delivered" && (delivery?.state === "pending" ||
        delivery?.nextAt !== undefined && this.clock() >= delivery.nextAt)) {
      const previous = delivery;
      const snapshot = run.current && await this.deps.port.snapshot(run.current.agentId);
      if (snapshot && (snapshot.lastUserMessageAt ?? 0) > (run.userBaseline ?? 0)) {
        await this.save({ ...run, delivery: { ...previous, state: "blocked", reason: "checkout_taken_over", nextAt: undefined } });
        return;
      }
      if (run.current && (!snapshot || snapshot.status === "running" || snapshot.status === "initializing" || snapshot.pendingPermissions)) return;
      const settings = await this.deps.readSettings();
      if (!settings) return;
      if (run.adopted && !run.gitPlan?.cwd) {
        // The agent's own checkout is only read. Delivery happens from a separate worktree of the same repository.
        const first = run.prompt === ADOPTED_PROMPT ? null : (run.prompt.split(/\r?\n/, 1)[0] ?? null);
        const prepared = await git.adopt(run, run.title ?? first);
        if (!prepared.plan) {
          await this.save({ ...run, delivery: prepared.delivery });
          return;
        }
        run = { ...run, gitPlan: prepared.plan, delivery: prepared.delivery };
        await this.save(run);
      }
      delivery = await git.deliver(run, settings);
      await this.save({ ...run, delivery });
    }
    const local = delivery?.state === "no_changes" || delivery?.state === "remote_denied" || delivery?.state === "integrated" ||
      delivery?.state === "local" && !run.parentRunId;
    const cancelled = run.status === "cancelled" && !run.pending &&
      delivery?.reason !== "checkout_taken_over" && delivery?.reason !== "operation_uncertain";
    if (run.gitPlan?.cwd && !delivery?.retired && (local || delivery?.state === "direct" || delivery?.state === "merged" || cancelled) &&
        (this.deps.port.worktreeInactive || run.adopted)) {
      const retired = await git.retire({ ...run, delivery }, async () => {
        const tasks = await this.list();
        if (tasks.some(entry => entry.id !== run.id && !TERMINAL.has(entry.status) &&
            (entry.gitPlan?.cwd === run.gitPlan!.cwd || entry.cwd === run.gitPlan!.cwd))) return false;
        // The delivery worktree of an adopted run is created by Zelqio Flow and has no agent or Paseo workspace.
        if (run.adopted) return true;
        const owners = run.history.flatMap(event => event.agentId ? [event.agentId] : []);
        if (run.current) owners.push(run.current.agentId);
        return this.deps.port.worktreeInactive!(run.gitPlan!.workspaceId!, run.gitPlan!.cwd!, owners);
      });
      if (retired || !delivery?.retained) {
        await this.save({ ...run, delivery: { state: "pending", ...delivery, retired, retained: !retired } });
      }
    }
  }

  /** The provider of the current agent reached a limit: keep the work, then reassign or wait. */
  private async exhausted(run: RunRecord, message: string, hintedReset: number | undefined, transient: boolean, fromReply = false): Promise<void> {
    const current = run.current!;
    const now = this.clock();
    if (run.prompt === ADOPTED_PROMPT) {
      const first = await this.deps.port.firstUserMessage(current.agentId).catch(() => null);
      if (first) run = { ...run, prompt: clip(first, 20_000) ?? run.prompt };
    }
    let ctx;
    try {
      ctx = await this.context();
    } catch {
      return; // Try again on the next pass; nothing was changed.
    }
    const quotas = providerQuotas(ctx.usage, now);
    const reportedReset = quotas.get(current.provider)?.resetsAt;
    const base = hintedReset ?? reportedReset ?? now + (transient ? Math.min(this.defaultWaitMs, 2 * 60_000) : this.defaultWaitMs);
    // A short margin after the reset, so the first request is not sent at the very second the window opens.
    const resumeAt = base + (hintedReset !== undefined || reportedReset !== undefined ? 30_000 : 0);
    const suspended = { ...run.suspended, [current.provider]: now };
    let working = this.note({ ...run, suspended, handledError: message }, "exhausted", {
      provider: current.provider, model: current.model, agentId: current.agentId, ...(fromReply ? { note: "from the last reply" } : {}),
    });
    await this.deps.attempts.settle({ key: `${run.id}-a${run.attempts}`, outcome: "failed", evidenceRef: "quota" }).catch(() => undefined);

    if (run.attempts < this.maxAttempts) {
      const decision = this.choose(working, ctx, { continuity: current, suspended });
      const alternative = decision.selected;
      if (alternative && alternative.provider !== current.provider) {
        const activity = (await this.deps.port.recentActivity(current.agentId).catch(() => "")) ?? "";
        working = { ...working, handledError: null, attention: false, stall: undefined };
        await this.save(working);
        await this.launch(working, handoffPrompt(run, activity), alternative);
        return;
      }
    }
    working = this.note({ ...working, status: "waiting_quota", resumeAt, attention: false, stall: undefined }, "waiting", {
      provider: current.provider, model: current.model, agentId: current.agentId, note: `until ${new Date(resumeAt).toISOString()}`,
    });
    await this.save(working);
  }

  private async stopForTakeover(run: RunRecord, snapshot: AgentSnapshot): Promise<boolean> {
    // Older runs, and native prompts sent without a message ID, may have no user timestamp at exhaustion.
    const baseline = run.userBaseline ?? run.history.findLast(event => event.kind === "exhausted")?.at ?? run.createdAt;
    if (snapshot.lastUserMessageAt === null || snapshot.lastUserMessageAt <= baseline) return false;
    await this.save(this.note({ ...run, status: "cancelled", resumeAt: null,
      ...(run.gitPlan ? { delivery: { state: "blocked" as const, reason: "checkout_taken_over", retained: true } } : {}) },
    "cancelled", { agentId: snapshot.id, note: "the user took over" }));
    return true;
  }

  private async confirmResume(run: RunRecord): Promise<void> {
    const current = run.current!;
    const { [current.provider]: _removed, ...remaining } = run.suspended;
    void _removed;
    const confirmed: RunRecord = { ...run, pending: null, suspended: remaining, handledError: null };
    // Older state could persist the history entry while still leaving the resume pending.
    const alreadyRecorded = run.history.at(-1)?.kind === "resumed";
    await this.save(alreadyRecorded ? confirmed : this.note(confirmed, "resumed", {
      provider: current.provider, model: current.model, agentId: current.agentId,
    }));
  }

  /** A waiting run reached its check time: resume the same agent when its provider recovered, or hand the work over. */
  private async recover(run: RunRecord): Promise<void> {
    const current = run.current;
    if (!current) return;
    const now = this.clock();
    const snapshot = await this.deps.port.snapshot(current.agentId);
    if (!snapshot || snapshot.archived || (snapshot.status === "closed" && !snapshot.restorable)) {
      await this.save(this.note({ ...run, status: "failed", error: "The agent is no longer available.", resumeAt: null }, "failed", { agentId: current.agentId }));
      return;
    }
    if (await this.stopForTakeover(run, snapshot)) return;
    if (snapshot.pendingPermissions > 0 || snapshot.status === "running" || snapshot.status === "initializing") {
      await this.save({ ...run, resumeAt: now + this.recheckMs, attention: snapshot.pendingPermissions > 0 });
      return;
    }
    let ctx;
    try {
      ctx = await this.context();
    } catch {
      await this.save({ ...run, resumeAt: now + this.recheckMs });
      return;
    }
    const quotas = providerQuotas(ctx.usage, now);
    const quota = quotas.get(current.provider);
    // Providers Paseo does not report on are retried once the wait is over; the next failure waits again.
    const reported = quota !== undefined;
    let suspended = run.suspended;
    if (!reported) suspended = Object.fromEntries(Object.entries(suspended).filter(([provider]) => provider !== current.provider));
    const decision = this.choose({ ...run, suspended }, ctx, { continuity: current, suspended });
    const ranked = decision.ranked;
    const originalOk = ranked.some(target => target.provider === current.provider && target.model === current.model);
    if (originalOk) {
      const key = `${run.id}-r${run.history.filter(entry => entry.kind === "resumed").length + 1}`;
      const marked: RunRecord = { ...run, suspended, status: "running", resumeAt: null, pending: { kind: "resume", key }, handledError: run.handledError };
      await this.save(marked);
      try {
        await this.deps.port.send(current.agentId, "The usage limit was restored. Continue the task from where you stopped.", key);
      } catch (error) {
        await this.save(this.note({ ...marked, status: "waiting_quota", pending: null, resumeAt: now + this.recheckMs }, "waiting", { note: clip(error instanceof Error ? error.message : "resume failed", 120) ?? undefined }));
        return;
      }
      await this.confirmResume(marked);
      return;
    }
    const alternative = decision.selected;
    if (alternative && alternative.provider !== current.provider && run.attempts < this.maxAttempts) {
      const activity = (await this.deps.port.recentActivity(current.agentId).catch(() => "")) ?? "";
      await this.launch({ ...run, suspended }, handoffPrompt(run, activity), alternative);
      return;
    }
    const nextCheck = Math.max(now + this.recheckMs, quota?.resetsAt ?? 0);
    await this.save({ ...run, suspended, resumeAt: nextCheck });
  }
}
