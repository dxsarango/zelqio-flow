import { z } from "zod";
import { VersionedStore } from "./store";

const reference = z.string().regex(/^[A-Za-z0-9_.-]{1,128}$/);
const timestamp = z.number().int().nonnegative();
const scope = z.strictObject({ project: reference, task: reference, action: reference, target: reference });
const observation = z.strictObject({
  // Preserve the reported spelling and length so an uppercase or abbreviated SHA invalidates the exact binding.
  candidateSha: z.string().regex(/^[0-9a-fA-F]{1,64}$/),
  policyRevision: reference,
});
const binding = z.strictObject({
  id: reference,
  scope,
  candidateSha: z.string().regex(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/),
  policyRevision: reference,
});
const request = binding.extend({ requesterRef: reference, expiresAt: timestamp });
const decision = z.strictObject({
  outcome: z.enum(["approved", "rejected"]),
  approverRef: reference,
  decidedAt: timestamp,
});
const decisionInput = binding.extend({ outcome: decision.shape.outcome, approverRef: reference, observation });
const reconciliationInput = binding.extend(observation.shape);
const closure = z.discriminatedUnion("reason", [
  z.strictObject({ reason: z.literal("invalidated"), closedAt: timestamp, observation }),
  z.strictObject({ reason: z.literal("expired"), closedAt: timestamp }),
]);
const entry = request.extend({
  createdAt: timestamp,
  decision: decision.nullable(),
  closure: closure.nullable(),
}).refine(({ createdAt, expiresAt, requesterRef, decision, closure, ...bound }) =>
  createdAt < expiresAt
  && (!decision || (!sameActor(decision.approverRef, requesterRef) && createdAt <= decision.decidedAt && decision.decidedAt < expiresAt))
  && (!closure || (
    (decision?.decidedAt ?? createdAt) <= closure.closedAt
    && (closure.reason === "expired") === (closure.closedAt >= expiresAt)
    && decision?.outcome !== "rejected"
    && (closure.reason === "expired" || !sameCandidate(bound, closure.observation))
  )),
);
const state = z.strictObject({ entries: z.array(entry) }).refine(
  ({ entries }) => new Set(entries.map(item => item.id)).size === entries.length,
);
type State = z.infer<typeof state>;
type Entry = z.infer<typeof entry>;
type Binding = z.infer<typeof binding>;
type Observation = z.infer<typeof observation>;
type DecisionInput = z.infer<typeof decisionInput>;
type Creation = { status: "created" | "existing"; entry: Entry } | { status: "blocked" };

function sameScope(left: Binding["scope"], right: Binding["scope"]): boolean {
  return left.project === right.project && left.task === right.task && left.action === right.action && left.target === right.target;
}

function sameCandidate(left: Observation, right: Observation): boolean {
  return left.candidateSha === right.candidateSha && left.policyRevision === right.policyRevision;
}

function sameActor(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

/**
 * Local approval fixture. The caller supplies unverified approver references and candidate observations.
 * A live integration needs verified human provenance and fresh observations before any effect.
 * VersionedStore serializes within one process. A corrupt current file blocks access until operator reconciliation.
 */
export class ApprovalRequests {
  private readonly store: VersionedStore<State>;

  constructor(directory: string, private readonly clock: () => number = Date.now) {
    this.store = new VersionedStore({
      dir: directory, name: "approval-requests", version: 1, schema: state, defaults: () => ({ entries: [] }),
    });
  }

  /** Replays return the stored snapshot. Use reconcile to check the current candidate and expiry. */
  create(input: z.input<typeof request>): Promise<Creation> {
    return this.store.update<Creation>(current => {
      const parsed = request.safeParse(input);
      if (!parsed.success) return { result: { status: "blocked" } };
      const existing = current.entries.find(item => item.id === parsed.data.id);
      if (existing) {
        const same = sameScope(existing.scope, parsed.data.scope) && sameCandidate(existing, parsed.data)
          && existing.requesterRef === parsed.data.requesterRef && existing.expiresAt === parsed.data.expiresAt;
        return { result: same ? { status: "existing", entry: existing } : { status: "blocked" } };
      }
      const created = entry.safeParse({ ...parsed.data, createdAt: this.clock(), decision: null, closure: null });
      if (!created.success) return { result: { status: "blocked" } };
      return { result: { status: "created", entry: created.data }, next: { entries: [...current.entries, created.data] } };
    });
  }

  /** A decision must echo the original binding and supply a current observation before settling the request. */
  async decide(input: DecisionInput): Promise<Entry | null> {
    const parsed = decisionInput.safeParse(input);
    if (!parsed.success) return null;
    const updated = await this.evaluate(parsed.data, parsed.data.observation, parsed.data);
    return updated?.recordedDecision ? updated.entry : null;
  }

  /**
   * Applies the current candidate and policy observation for this request and scope.
   * A recorded approval applies to this observation only when the returned entry has no closure.
   */
  async reconcile(input: z.input<typeof reconciliationInput>): Promise<Entry | null> {
    const parsed = reconciliationInput.safeParse(input);
    if (!parsed.success) return null;
    const { id, scope, ...observed } = parsed.data;
    return (await this.evaluate({ id, scope }, observed))?.entry ?? null;
  }

  private evaluate(input: Pick<Binding, "id" | "scope">, observed: Observation, proposed?: DecisionInput) {
    return this.store.update<{ entry: Entry; recordedDecision: boolean } | null>(current => {
      const index = current.entries.findIndex(item => item.id === input.id);
      if (index < 0) return { result: null };
      const existing = current.entries[index];
      if (!sameScope(existing.scope, input.scope)) return { result: null };
      if (proposed && (!sameCandidate(existing, proposed) || sameActor(existing.requesterRef, proposed.approverRef))) {
        return { result: null };
      }

      const now = timestamp.safeParse(this.clock());
      if (!now.success || now.data < (existing.decision?.decidedAt ?? existing.createdAt)) return { result: null };
      const unchanged = { result: { entry: existing, recordedDecision: false } };
      if (existing.closure || existing.decision?.outcome === "rejected") return unchanged;

      const closed: Entry["closure"] = now.data >= existing.expiresAt
        ? { reason: "expired", closedAt: now.data }
        : sameCandidate(existing, observed) ? null : { reason: "invalidated", closedAt: now.data, observation: observed };
      let updated: Entry;
      if (closed) {
        updated = { ...existing, closure: closed };
      } else if (proposed && !existing.decision) {
        const { outcome, approverRef } = proposed;
        updated = { ...existing, decision: { outcome, approverRef, decidedAt: now.data } };
      } else {
        return unchanged;
      }
      const entries = [...current.entries];
      entries[index] = updated;
      return { result: { entry: updated, recordedDecision: !closed }, next: { entries } };
    });
  }
}
