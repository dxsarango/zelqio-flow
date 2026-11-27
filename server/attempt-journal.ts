import { randomUUID } from "node:crypto";
import { z } from "zod";
import { VersionedStore } from "./store";

const reference = z.string().regex(/^[A-Za-z0-9_.-]{1,128}$/);
const count = z.number().int().nonnegative();
const entry = z.discriminatedUnion("status", [
  z.strictObject({ status: z.literal("reserved"), key: reference, task: reference, attempt: count.positive(), reservedAt: count, session: reference }),
  z.strictObject({ status: z.literal("running"), key: reference, task: reference, attempt: count.positive(), reservedAt: count, session: reference, agentRef: reference }),
  z.strictObject({ status: z.literal("ambiguous"), key: reference, task: reference, attempt: count.positive(), reservedAt: count, agentRef: reference.optional() }),
  z.strictObject({
    status: z.literal("settled"), key: reference, task: reference, attempt: count.positive(), reservedAt: count,
    outcome: z.enum(["succeeded", "failed", "not_launched"]), evidenceRef: reference,
  }),
]);
type Entry = z.infer<typeof entry>;
type Active = Exclude<Entry, { status: "settled" }>;
const holdsSlot = (item: Entry): item is Active => item.status !== "settled";
/** A snapshot must never carry duplicate keys, several live attempts for one task or gaps in a task's attempt numbers. */
export const attemptJournalState = z.strictObject({ entries: z.array(entry) }).refine(({ entries }) => {
  if (new Set(entries.map(item => item.key)).size !== entries.length) return false;
  const byTask = new Map<string, Entry[]>();
  for (const item of entries) byTask.set(item.task, [...(byTask.get(item.task) ?? []), item]);
  return [...byTask.values()].every(items =>
    items.filter(holdsSlot).length <= 1
    && items.map(item => item.attempt).sort((a, b) => a - b).every((attempt, index) => attempt === index + 1));
}, "inconsistent attempt journal");
type State = z.infer<typeof attemptJournalState>;

export type Reservation =
  | { status: "reserved"; entry: Entry }
  | { status: "existing"; entry: Entry }
  | { status: "blocked"; reason: "invalid" | "no_slot" | "task_active" | "attempt_order" | "key_conflict" };
export type Transition = { status: "recorded"; entry: Entry } | { status: "blocked" };

const settled = (item: Entry, outcome: string, evidenceRef: string) => ({
  status: "settled", key: item.key, task: item.task, attempt: item.attempt, reservedAt: item.reservedAt, outcome, evidenceRef,
});

/**
 * Local fixture of idempotent attempt reservations. A reserved or running attempt belongs to the journal instance
 * that recorded it: a reopened journal cannot confirm or settle it until recoverAfterRestart() makes it ambiguous,
 * and it keeps its slot until explicit evidence resolves it. Nothing here infers launch state or starts agents.
 */
export class AttemptJournal {
  private readonly store: VersionedStore<State>;
  private readonly session = randomUUID();

  constructor(directory: string, private readonly clock: () => number = Date.now) {
    this.store = new VersionedStore({ dir: directory, name: "attempts", version: 1, schema: attemptJournalState, defaults: () => ({ entries: [] }) });
  }

  read(): Promise<State> {
    return this.store.update(current => ({ result: current }));
  }

  /** The key is the idempotency identity: repeating it with the same task and attempt returns the recorded entry. */
  reserve(input: { key: string; task: string; attempt: number; maxConcurrent: number }): Promise<Reservation> {
    return this.store.update<Reservation>(current => {
      const parsed = entry.safeParse({ status: "reserved", key: input.key, task: input.task, attempt: input.attempt, reservedAt: this.clock(), session: this.session });
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
    if (input.outcome !== "succeeded" && input.outcome !== "failed") return Promise.resolve({ status: "blocked" });
    return this.change(input.key, ["running"], item => settled(item, input.outcome, input.evidenceRef));
  }

  /**
   * Explicit evidence is required to leave ambiguity. "not_launched" frees the slot, so it is accepted only for an
   * attempt that never had a confirmed agent; one that did must be resolved as succeeded or failed.
   */
  resolveAmbiguous(input: { key: string; outcome: "succeeded" | "failed" | "not_launched"; evidenceRef: string }): Promise<Transition> {
    return this.change(input.key, ["ambiguous"], item =>
      input.outcome === "not_launched" && item.status === "ambiguous" && item.agentRef !== undefined ? null : settled(item, input.outcome, input.evidenceRef));
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
      const target = current.entries[index];
      if (!target || !from.includes(target.status) || (target.status !== "ambiguous" && target.status !== "settled" && target.session !== this.session)) {
        return { result: { status: "blocked" } };
      }
      const parsed = entry.safeParse(build(target));
      if (!parsed.success) return { result: { status: "blocked" } };
      const entries = [...current.entries];
      entries[index] = parsed.data;
      return { result: { status: "recorded", entry: parsed.data }, next: { entries } };
    });
  }
}
