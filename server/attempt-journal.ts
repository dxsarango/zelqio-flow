import { z } from "zod";
import { VersionedStore } from "./store";

const reference = z.string().regex(/^[A-Za-z0-9_.-]{1,128}$/);
const count = z.number().int().nonnegative();
const entry = z.discriminatedUnion("status", [
  z.strictObject({ status: z.literal("reserved"), key: reference, task: reference, attempt: count.positive(), reservedAt: count }),
  z.strictObject({ status: z.literal("running"), key: reference, task: reference, attempt: count.positive(), reservedAt: count, agentRef: reference }),
  z.strictObject({ status: z.literal("ambiguous"), key: reference, task: reference, attempt: count.positive(), reservedAt: count, agentRef: reference.optional() }),
  z.strictObject({
    status: z.literal("settled"), key: reference, task: reference, attempt: count.positive(), reservedAt: count,
    outcome: z.enum(["succeeded", "failed", "not_launched"]), evidenceRef: reference,
  }),
]);
const state = z.strictObject({ entries: z.array(entry) });
type State = z.infer<typeof state>;
type Entry = z.infer<typeof entry>;
type Active = Exclude<Entry, { status: "settled" }>;

export type Reservation =
  | { status: "reserved"; entry: Entry }
  | { status: "existing"; entry: Entry }
  | { status: "blocked"; reason: "invalid" | "no_slot" | "task_active" | "attempt_order" | "key_conflict" };
export type Transition = { status: "recorded"; entry: Entry } | { status: "blocked" };

const holdsSlot = (item: Entry): item is Active => item.status !== "settled";

/**
 * Local fixture of idempotent attempt reservations. A reserved or running attempt becomes ambiguous after a
 * restart and keeps its slot until explicit evidence resolves it; nothing here infers launch state or starts agents.
 */
export class AttemptJournal {
  private readonly store: VersionedStore<State>;

  constructor(directory: string, private readonly clock: () => number = Date.now) {
    this.store = new VersionedStore({ dir: directory, name: "attempts", version: 1, schema: state, defaults: () => ({ entries: [] }) });
  }

  read(): Promise<State> {
    return this.store.update(current => ({ result: current }));
  }

  /** The key is the idempotency identity: repeating it with the same task and attempt returns the recorded entry. */
  reserve(input: { key: string; task: string; attempt: number; maxConcurrent: number }): Promise<Reservation> {
    return this.store.update<Reservation>(current => {
      const parsed = entry.safeParse({ status: "reserved", key: input.key, task: input.task, attempt: input.attempt, reservedAt: this.clock() });
      if (!parsed.success || !Number.isSafeInteger(input.maxConcurrent) || input.maxConcurrent < 1) {
        return { result: { status: "blocked", reason: "invalid" } };
      }
      const existing = current.entries.find(item => item.key === input.key);
      if (existing) {
        const same = existing.task === input.task && existing.attempt === input.attempt;
        return { result: same ? { status: "existing", entry: existing } : { status: "blocked", reason: "key_conflict" } };
      }
      const forTask = current.entries.filter(item => item.task === input.task);
      if (forTask.some(holdsSlot)) return { result: { status: "blocked", reason: "task_active" } };
      if (input.attempt !== Math.max(0, ...forTask.map(item => item.attempt)) + 1) {
        return { result: { status: "blocked", reason: "attempt_order" } };
      }
      if (current.entries.filter(holdsSlot).length >= input.maxConcurrent) return { result: { status: "blocked", reason: "no_slot" } };
      return { result: { status: "reserved", entry: parsed.data }, next: { entries: [...current.entries, parsed.data] } };
    });
  }

  /** Records that a host-reported agent now owns a reserved attempt. */
  confirmLaunch(input: { key: string; agentRef: string }): Promise<Transition> {
    return this.change(input.key, ["reserved"], item => ({ ...item, status: "running", agentRef: input.agentRef }));
  }

  settle(input: { key: string; outcome: "succeeded" | "failed"; evidenceRef: string }): Promise<Transition> {
    return this.change(input.key, ["running"], item => ({ status: "settled", key: item.key, task: item.task, attempt: item.attempt, reservedAt: item.reservedAt, outcome: input.outcome, evidenceRef: input.evidenceRef }));
  }

  /** Explicit evidence is required to leave ambiguity; "not_launched" frees the slot for a later attempt. */
  resolveAmbiguous(input: { key: string; outcome: "succeeded" | "failed" | "not_launched"; evidenceRef: string }): Promise<Transition> {
    return this.change(input.key, ["ambiguous"], item => ({ status: "settled", key: item.key, task: item.task, attempt: item.attempt, reservedAt: item.reservedAt, outcome: input.outcome, evidenceRef: input.evidenceRef }));
  }

  /** Call once after a restart: every unsettled attempt keeps its slot as ambiguous, without verifying the host. */
  recoverAfterRestart(): Promise<number> {
    return this.store.update(current => {
      let changed = 0;
      const entries = current.entries.map((item): Entry => {
        if (item.status !== "reserved" && item.status !== "running") return item;
        changed++;
        return { status: "ambiguous", key: item.key, task: item.task, attempt: item.attempt, reservedAt: item.reservedAt, ...(item.status === "running" ? { agentRef: item.agentRef } : {}) };
      });
      return changed ? { result: changed, next: { entries } } : { result: 0 };
    });
  }

  private change(key: string, from: Array<Entry["status"]>, build: (item: Entry) => unknown): Promise<Transition> {
    return this.store.update<Transition>(current => {
      const index = current.entries.findIndex(item => item.key === key);
      if (index < 0 || !from.includes(current.entries[index].status)) return { result: { status: "blocked" } };
      const parsed = entry.safeParse(build(current.entries[index]));
      if (!parsed.success) return { result: { status: "blocked" } };
      const entries = [...current.entries];
      entries[index] = parsed.data;
      return { result: { status: "recorded", entry: parsed.data }, next: { entries } };
    });
  }
}
