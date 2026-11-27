import { randomUUID } from "node:crypto";
import { ZelqioError } from "../shared/errors";
import type { ProviderCatalogData } from "../shared/providers";
import { runsState, type RunRecord, type RunsState } from "../shared/runs";
import type { ZelqioSettings } from "../shared/settings";
import type { UsageSnapshot } from "../shared/usage";
import type { AttemptJournal } from "./attempt-journal";
import { deriveModelFacts, providerQuotas } from "./model-facts";
import { classifyFailure } from "./quota-signal";
import { resolveRoles } from "./roles";
import { route, type RoutingTarget } from "./router";
import type { VersionedStore } from "./store";

export interface AgentSnapshot {
  id: string;
  status: "initializing" | "idle" | "running" | "error" | "closed";
  lastError: string | null;
  pendingPermissions: number;
  archived: boolean;
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
}

/** The part of Paseo the manager uses. The real implementation wraps the SDK; tests use a fake. */
export interface AgentPort {
  create(input: CreateAgentInput): Promise<{ id: string }>;
  snapshot(agentId: string): Promise<AgentSnapshot | null>;
  send(agentId: string, text: string, messageId: string): Promise<void>;
  /** The final answer of the latest turn, if any. */
  lastReply(agentId: string): Promise<string | null>;
  /** A short transcript tail used to brief a replacement agent. */
  recentActivity(agentId: string): Promise<string>;
  /** The first message the user sent to the agent, used when an agent created natively is adopted. */
  firstUserMessage(agentId: string): Promise<string | null>;
}

/** Stands in for the request of an adopted agent until its first message can be read. */
export const ADOPTED_PROMPT = "Continue the task described in the previous agent's conversation.";

export interface RunManagerDeps {
  port: AgentPort;
  store: VersionedStore<RunsState>;
  attempts: AttemptJournal;
  readCatalog(): Promise<ProviderCatalogData>;
  readUsage(): Promise<UsageSnapshot | null>;
  readSettings(): Promise<ZelqioSettings | null>;
  clock?: () => number;
  /** Runs that may be active at once. The rest wait in the queue. */
  maxConcurrent?: number;
  /** Agents one run may use before it stops reassigning. */
  maxAttempts?: number;
  /** How long to wait when a provider reports a limit without saying when it ends. */
  defaultWaitMs?: number;
  /** How soon to look again when Paseo has not yet reported recovered quota. */
  recheckMs?: number;
}

const MAX_REPLY = 6000;
const MAX_HISTORY = 200;

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
    run.prompt,
    "",
    "Recent activity of the previous agent (may be incomplete):",
    activity || "(not available)",
  ].join("\n");
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
  private chain: Promise<unknown> = Promise.resolve();

  constructor(private readonly deps: RunManagerDeps) {
    this.clock = deps.clock ?? Date.now;
    this.maxConcurrent = deps.maxConcurrent ?? 3;
    this.maxAttempts = deps.maxAttempts ?? 5;
    this.defaultWaitMs = deps.defaultWaitMs ?? 30 * 60_000;
    this.recheckMs = deps.recheckMs ?? 5 * 60_000;
  }

  /** Runs every mutation one at a time so a run is never processed twice at once. */
  private exclusive<T>(work: () => Promise<T>): Promise<T> {
    const next = this.chain.then(work, work);
    this.chain = next.catch(() => undefined);
    return next;
  }

  list(): Promise<RunRecord[]> {
    return this.deps.store.update(state => ({ result: state.runs }));
  }

  submit(input: { prompt: string; cwd: string; role?: string; capability?: RunRecord["capability"] }): Promise<RunRecord> {
    return this.exclusive(async () => {
      const now = this.clock();
      const run: RunRecord = {
        id: `run-${randomUUID()}`,
        prompt: input.prompt,
        role: input.role ?? "developer",
        capability: input.capability ?? "implement",
        cwd: input.cwd,
        status: "queued",
        current: null,
        attempts: 0,
        suspended: {},
        resumeAt: null,
        pending: null,
        handledError: null,
        attention: false,
        result: null,
        error: null,
        history: [{ at: now, kind: "queued" }],
        createdAt: now,
        updatedAt: now,
      };
      if (!resolveRoles({}).some(role => role.id === run.role)) throw new ZelqioError("invalid_input", `Unknown role: ${run.role}`);
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
      const run: RunRecord = {
        id, prompt: clip(prompt, 20_000) ?? ADOPTED_PROMPT, role: input.role ?? "developer", capability: "implement", cwd: input.cwd,
        status: "running",
        current: { agentId: input.agentId, provider: input.provider, model: input.model, startedAt: now },
        attempts: 1, suspended: {}, resumeAt: null, pending: null, handledError: null, attention: false, result: null, error: null,
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
      if (run.status === "delivered" || run.status === "failed" || run.status === "cancelled") return run;
      const next = this.note({ ...run, status: "cancelled", resumeAt: null }, "cancelled");
      await this.save(next);
      return next;
    });
  }

  /** Looks at every active run once. Called on a timer, on agent updates and after a restart. */
  tick(): Promise<void> {
    return this.exclusive(async () => {
      const runs = await this.list();
      for (const run of runs) {
        const latest = (await this.find(run.id)) ?? run;
        try {
          if (latest.status === "running") await this.reconcile(latest);
          else if (latest.status === "waiting_quota" && latest.resumeAt !== null && this.clock() >= latest.resumeAt) await this.recover(latest);
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
        if (run.status !== "running" && run.status !== "waiting_quota") continue;
        try {
          if (run.pending?.kind === "create" && !run.current) await this.launch(run, null, undefined, true);
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
  onAgentUpdate(agentId: string): Promise<void> {
    return this.exclusive(async () => {
      const run = (await this.list()).find(entry => entry.current?.agentId === agentId && entry.status === "running");
      if (run) await this.reconcile(run);
    });
  }

  // ---- internals (always called inside exclusive) ----

  private async find(id: string): Promise<RunRecord | undefined> {
    return (await this.list()).find(run => run.id === id);
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

  private async context() {
    const [settings, catalog, usage] = await Promise.all([this.deps.readSettings(), this.deps.readCatalog(), this.deps.readUsage()]);
    if (!settings) throw new ZelqioError("unavailable", "Zelqio settings are unavailable.");
    return { settings, catalog, usage };
  }

  private choose(
    run: RunRecord,
    ctx: Awaited<ReturnType<RunManager["context"]>>,
    options: { continuity?: RoutingTarget; suspended?: RunRecord["suspended"] } = {},
  ) {
    const role = resolveRoles({}).find(entry => entry.id === run.role);
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
      const active = runs.filter(run => run.status === "running" || run.status === "waiting_quota").length;
      const next = runs.find(run => run.status === "queued");
      if (!next || active >= this.maxConcurrent) return;
      await this.launch(next, null);
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
    const attempt = retry ? run.attempts : run.attempts + 1;
    const key = `${run.id}-a${attempt}`;
    const reserved = await this.deps.attempts.reserve({ key, task: run.id, attempt, maxConcurrent: this.maxConcurrent + 8 });
    if (reserved.status === "blocked") {
      await this.save(this.note({ ...run, status: "failed", error: `Could not reserve the attempt (${reserved.reason}).` }, "failed"));
      return;
    }
    let working: RunRecord = { ...run, status: "running", attempts: attempt, pending: { kind: "create", key }, resumeAt: null };
    await this.save(working);
    try {
      const created = await this.deps.port.create({
        key, provider: target.provider, model: target.model, cwd: run.cwd,
        prompt: handoff ?? run.prompt, title: `Zelqio · ${clip(run.prompt, 48)}`,
        metadata: { "zelqio.run": run.id, "zelqio.attempt": String(attempt) },
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
      await this.save(this.note({ ...working, status: "failed", pending: null, error: clip(error instanceof Error ? error.message : "Could not create the agent.", 300) }, "failed"));
    }
  }

  private async reconcile(run: RunRecord): Promise<void> {
    if (!run.current) return;
    const snapshot = await this.deps.port.snapshot(run.current.agentId);
    if (!snapshot || snapshot.archived || snapshot.status === "closed") {
      await this.save(this.note({ ...run, status: "failed", error: "The agent is no longer available." }, "failed", { agentId: run.current.agentId }));
      return;
    }
    if (snapshot.status === "initializing" || snapshot.status === "running") {
      const attention = snapshot.pendingPermissions > 0;
      const confirmed = run.pending?.kind === "resume" ? { ...run, pending: null } : run;
      if (attention !== run.attention || confirmed !== run) await this.save({ ...confirmed, attention });
      return;
    }
    if (run.pending?.kind === "resume") {
      // The resume was recorded but the agent is not running: send it again with the same message id.
      await this.deps.port.send(run.current.agentId, "The usage limit was restored. Continue the task from where you stopped.", run.pending.key);
      return;
    }
    if (snapshot.status === "idle" && !snapshot.lastError) {
      const reply = clip(await this.deps.port.lastReply(run.current.agentId), MAX_REPLY);
      await this.deps.attempts.settle({ key: `${run.id}-a${run.attempts}`, outcome: "succeeded", evidenceRef: "agent-idle" }).catch(() => undefined);
      await this.save(this.note({ ...run, status: "delivered", result: reply ?? "The agent finished without a final message.", attention: false, pending: null }, "delivered", { agentId: run.current.agentId }));
      return;
    }
    const message = snapshot.lastError ?? "The agent reported an error.";
    if (message === run.handledError) return;
    const signal = classifyFailure(message, this.clock());
    if (signal.kind === "other") {
      await this.deps.attempts.settle({ key: `${run.id}-a${run.attempts}`, outcome: "failed", evidenceRef: "agent-error" }).catch(() => undefined);
      await this.save(this.note({ ...run, status: "failed", error: clip(message, 300), handledError: message, attention: false }, "failed", { agentId: run.current.agentId }));
      return;
    }
    await this.exhausted(run, message, signal.resetsAt, signal.kind === "rate_limit");
  }

  /** The provider of the current agent reached a limit: keep the work, then reassign or wait. */
  private async exhausted(run: RunRecord, message: string, hintedReset: number | undefined, transient: boolean): Promise<void> {
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
    const resumeAt = hintedReset ?? reportedReset ?? now + (transient ? Math.min(this.defaultWaitMs, 2 * 60_000) : this.defaultWaitMs);
    const suspended = { ...run.suspended, [current.provider]: now };
    let working = this.note({ ...run, suspended, handledError: message }, "exhausted", { provider: current.provider, model: current.model, agentId: current.agentId });
    await this.deps.attempts.settle({ key: `${run.id}-a${run.attempts}`, outcome: "failed", evidenceRef: "quota" }).catch(() => undefined);

    if (run.attempts < this.maxAttempts) {
      const decision = this.choose(working, ctx, { continuity: current, suspended });
      const alternative = decision.selected;
      if (alternative && alternative.provider !== current.provider) {
        const activity = (await this.deps.port.recentActivity(current.agentId).catch(() => "")) ?? "";
        working = { ...working, handledError: null, attention: false };
        await this.save(working);
        await this.launch(working, handoffPrompt(run, activity), alternative);
        return;
      }
    }
    working = this.note({ ...working, status: "waiting_quota", resumeAt, attention: false }, "waiting", {
      provider: current.provider, model: current.model, agentId: current.agentId, note: `until ${new Date(resumeAt).toISOString()}`,
    });
    await this.save(working);
  }

  /** A waiting run reached its check time: resume the same agent when its provider recovered, or hand the work over. */
  private async recover(run: RunRecord): Promise<void> {
    const current = run.current;
    if (!current) return;
    const now = this.clock();
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
        const { [current.provider]: _removed, ...remaining } = suspended;
        void _removed;
        await this.save(this.note({ ...marked, suspended: remaining, handledError: null }, "resumed", { provider: current.provider, model: current.model, agentId: current.agentId }));
      } catch (error) {
        await this.save(this.note({ ...marked, status: "waiting_quota", pending: null, resumeAt: now + this.recheckMs }, "waiting", { note: clip(error instanceof Error ? error.message : "resume failed", 120) ?? undefined }));
      }
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
