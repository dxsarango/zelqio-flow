import { z } from "zod";
import { VersionedStore } from "./store";
import { evaluateCoordinatorRecovery, planRecoveryRetry, type RecoveryRetry } from "./watchdog";

const timestamp = z.number().int().nonnegative();
const reference = z.string().regex(/^[A-Za-z0-9_.-]{1,128}$/);
const leaseRecord = z.strictObject({
  agent: reference,
  epoch: timestamp.positive(),
  checkpoint: reference,
  acquiredAt: timestamp,
  progressedAt: timestamp,
  expiresAt: timestamp,
}).refine(record => record.acquiredAt <= record.progressedAt && record.progressedAt < record.expiresAt);
const retryRecord = z.discriminatedUnion("status", [
  z.strictObject({ status: z.literal("retry"), failures: timestamp.positive(), failedAt: timestamp, nextCheckAt: timestamp, evidenceRef: reference }),
  z.strictObject({ status: z.literal("exhausted"), failures: timestamp.positive(), failedAt: timestamp, evidenceRef: reference }),
]);
const journalPolicy = z.strictObject({
  maxLeaseMs: timestamp.positive(),
  retryLimits: z.strictObject({
    maxFailures: timestamp.min(2),
    initialDelayMs: timestamp.positive(),
    maxDelayMs: timestamp.positive(),
  }).refine(limits => limits.maxDelayMs >= limits.initialDelayMs),
});
const journal = z.strictObject({ policy: journalPolicy, lease: leaseRecord.nullable(), retry: retryRecord.nullable() }).refine(({ lease, retry }) =>
  !retry || !!lease && retry.failedAt >= lease.expiresAt
    && (retry.status === "exhausted" || retry.nextCheckAt > retry.failedAt),
);
type Journal = z.infer<typeof journal>;
type Lease = NonNullable<Journal["lease"]>;
type Mutation = { status: "recorded"; lease: Lease } | { status: "blocked" };
type RecoveryEvidence = Omit<Parameters<typeof evaluateCoordinatorRecovery>[0], "lease" | "now" | "retry">;

/**
 * Models durable lease transitions in one process. The host-facing implementation still needs verified
 * reconciliation and an exclusive cross-process authority. This journal is not registered with Paseo.
 */
export class CoordinationJournal {
  private readonly store: VersionedStore<Journal>;

  constructor(directory: string, policy: z.input<typeof journalPolicy>, private readonly clock: () => number = Date.now) {
    const initialPolicy = journalPolicy.parse(policy);
    this.store = new VersionedStore({
      dir: directory, name: "coordination-lease", version: 1, schema: journal,
      defaults: () => ({ policy: initialPolicy, lease: null, retry: null }),
    });
  }

  read(): Promise<Journal> {
    return this.store.update(current => ({ result: current }));
  }

  acquire(input: {
    agent: string;
    expectedEpoch: number;
    checkpoint: string;
    durationMs: number;
    recovery?: RecoveryEvidence & { provider: string };
  }): Promise<Mutation> {
    return this.store.update<Mutation>(({ lease, retry, policy }) => {
      const now = this.clock();
      if (!Number.isSafeInteger(input.durationMs) || input.durationMs < 1 || input.durationMs > policy.maxLeaseMs
        || input.expectedEpoch !== (lease?.epoch ?? 0) || (lease && (now < lease.expiresAt || input.checkpoint !== lease.checkpoint))) {
        return { result: { status: "blocked" } };
      }
      if (lease) {
        if (!input.recovery) return { result: { status: "blocked" } };
        const plan = evaluateCoordinatorRecovery({ ...input.recovery, lease, now, retry: retry ?? undefined });
        if (plan.status !== "propose_takeover" || plan.provider !== input.recovery.provider) {
          return { result: { status: "blocked" } };
        }
      }
      return this.record(policy, {
        agent: input.agent, epoch: input.expectedEpoch + 1, checkpoint: input.checkpoint,
        acquiredAt: now, progressedAt: now, expiresAt: now + input.durationMs,
      });
    });
  }

  advance(input: { agent: string; epoch: number; checkpoint: string; durationMs: number }): Promise<Mutation> {
    return this.store.update<Mutation>(({ lease, policy }) => {
      const now = this.clock();
      if (!Number.isSafeInteger(input.durationMs) || input.durationMs < 1 || input.durationMs > policy.maxLeaseMs
        || !lease || lease.agent !== input.agent || lease.epoch !== input.epoch || now <= lease.progressedAt || now >= lease.expiresAt) {
        return { result: { status: "blocked" } };
      }
      const expiresAt = Math.max(lease.expiresAt, now + input.durationMs);
      return this.record(policy, { ...lease, checkpoint: input.checkpoint, progressedAt: now, expiresAt });
    });
  }

  /** Records one failed read or handoff result for the expired epoch, never a request to start an agent. */
  recordRecoveryFailure(input: {
    expectedEpoch: number;
    previousFailures: number;
    evidenceRef: string;
  }): Promise<RecoveryRetry | null> {
    return this.store.update<RecoveryRetry | null>(({ lease, retry, policy }) => {
      const now = this.clock();
      if (!reference.safeParse(input.evidenceRef).success || !lease || lease.epoch !== input.expectedEpoch || !Number.isSafeInteger(now) || now < lease.expiresAt
        || retry?.status === "exhausted" || (retry && now < retry.nextCheckAt)
        || (retry?.failures ?? 0) !== input.previousFailures) {
        return { result: null };
      }
      const next = planRecoveryRetry(input.previousFailures + 1, now, policy.retryLimits);
      return { result: next, next: { policy, lease, retry: { ...next, evidenceRef: input.evidenceRef } } };
    });
  }

  private record(policy: Journal["policy"], candidate: Lease): { result: Mutation; next?: Journal } {
    const parsed = leaseRecord.safeParse(candidate);
    if (!parsed.success) return { result: { status: "blocked" } };
    return { result: { status: "recorded", lease: parsed.data }, next: { policy, lease: parsed.data, retry: null } };
  }
}
