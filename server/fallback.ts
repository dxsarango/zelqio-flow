import { z } from "zod";
import { ZelqioError } from "../shared/errors";
import { funding } from "../shared/settings";
import { route, type RoutingDecision, type RoutingModelFacts, type RoutingRequest, type RoutingTarget } from "./router";
import { VersionedStore } from "./store";

const reference = z.string().regex(/^[A-Za-z0-9_.-]{1,128}$/);
const target = z.strictObject({ provider: z.string().min(1), model: z.string().min(1) });
const attempt = z.union([z.literal(0), z.literal(1)]);
const failureRecord = z.strictObject({
  run: reference,
  checkpoint: reference,
  originCheckpoint: reference.optional(),
  attempt,
  target,
  funding,
  cause: z.enum(["transient", "quota_exhausted", "denied"]),
  quotaScope: z.enum(["model", "provider"]).optional(),
  observedAt: z.number().int().nonnegative(),
});
const record = failureRecord.extend({
  strategy: z.enum(["balanced", "economy", "quality_first", "custom"]),
  retry: target.nullable(),
});
const journalState = z.strictObject({ entries: z.array(record) });
type JournalState = z.infer<typeof journalState>;
type Entry = z.infer<typeof record>;
type Failure = z.infer<typeof failureRecord>;

export type FallbackResult =
  | { status: "retry"; target: RoutingTarget; checkpoint: string; attempt: 1 }
  | { status: "blocked" }
  | { status: "already_recorded" };

const sameTarget = (a: RoutingTarget, b: RoutingTarget) => a.provider === b.provider && a.model === b.model;
const targetKey = (value: RoutingTarget) => JSON.stringify([value.provider, value.model]);

function withSuspensions(request: RoutingRequest, entries: Entry[], failure?: Failure): RoutingRequest {
  const suspended = new Map<string, number>();
  const suspendedProviders = new Map<string, number>();
  for (const entry of entries) {
    if (entry.cause !== "quota_exhausted") continue;
    const byProvider = entry.quotaScope === "provider";
    const index = byProvider ? suspendedProviders : suspended;
    const key = byProvider ? entry.target.provider : targetKey(entry.target);
    index.set(key, Math.max(index.get(key) ?? 0, entry.observedAt));
  }

  const models = new Map<string, ReadonlyMap<string, RoutingModelFacts>>();
  for (const [provider, available] of request.models) {
    const bound = new Map<string, RoutingModelFacts>();
    for (const [model, facts] of available) {
      const modelTarget = { provider, model };
      const since = Math.max(suspended.get(targetKey(modelTarget)) ?? -Infinity, suspendedProviders.get(provider) ?? -Infinity);
      const excluded = failure?.quotaScope === "provider"
        ? failure.target.provider === provider
        : failure !== undefined && sameTarget(modelTarget, failure.target);
      bound.set(model, {
        ...facts,
        suspendedSince: since === -Infinity ? facts.suspendedSince : Math.max(since, facts.suspendedSince ?? 0),
        permitted: facts.permitted && !excluded,
      });
    }
    models.set(provider, bound);
  }
  return { ...request, models };
}

/**
 * Persists proposals only. The caller must bind failure observations and checkpoints to a verified attempt.
 * Launch and recovery after an uncertain effect require the execution journal in the later orchestration phase.
 */
export class FallbackJournal {
  private readonly store: VersionedStore<JournalState>;

  constructor(projectStateDirectory: string) {
    this.store = new VersionedStore({
      dir: projectStateDirectory,
      name: "routing-decisions",
      version: 1,
      schema: journalState,
      defaults: () => ({ entries: [] }),
    });
  }

  plan(request: RoutingRequest): Promise<RoutingDecision> {
    return this.store.update(({ entries }) => ({ result: route(withSuspensions(request, entries)) }));
  }

  async recordFailure(input: Failure, request: RoutingRequest): Promise<FallbackResult> {
    const failure = failureRecord.parse(input);
    if ((failure.attempt === 0 && failure.originCheckpoint !== undefined) ||
        (failure.quotaScope !== undefined && failure.cause !== "quota_exhausted")) {
      throw new ZelqioError("invalid_input", "The failure metadata does not match the attempt.");
    }
    return this.store.update<FallbackResult>((state) => {
      const existing = state.entries.find((entry) => entry.run === failure.run && entry.attempt === failure.attempt);
      if (existing) {
        if (!sameTarget(existing.target, failure.target) || existing.funding !== failure.funding ||
            existing.checkpoint !== failure.checkpoint || existing.originCheckpoint !== failure.originCheckpoint ||
            existing.cause !== failure.cause || existing.quotaScope !== failure.quotaScope || existing.observedAt !== failure.observedAt) {
          throw new ZelqioError("invalid_input", "The attempt already has a different failure record.");
        }
        return { result: { status: "already_recorded" } };
      }

      if (failure.attempt === 1) {
        const initial = state.entries.find((entry) => entry.run === failure.run && entry.attempt === 0);
        if (!initial?.retry || !sameTarget(initial.retry, failure.target) || initial.funding !== failure.funding ||
            initial.checkpoint !== failure.originCheckpoint || failure.observedAt < initial.observedAt) {
          throw new ZelqioError("invalid_input", "The follow-up does not match the recorded retry.");
        }
      }

      const exhausted = failure.cause === "quota_exhausted";
      const fundingMatches = request.requestedFunding === failure.funding ||
        (request.requestedFunding === undefined && failure.funding !== "consumption");
      const retry = failure.attempt === 0 && failure.cause !== "denied" && fundingMatches
        ? route(withSuspensions({
          ...request,
          continuity: failure.target,
          requestedFunding: failure.funding,
        }, state.entries, exhausted ? failure : undefined)).selected
        : null;
      const entry = { ...failure, strategy: request.settings.strategy, retry };
      return {
        next: { entries: [...state.entries, entry] },
        result: retry ? { status: "retry", target: retry, checkpoint: failure.checkpoint, attempt: 1 } : { status: "blocked" },
      };
    });
  }
}
