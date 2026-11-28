import { readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { ZelqioError } from "../shared/errors";
import type { PurgeResult } from "../shared/local-state";
import type { RunRecord, RunsState } from "../shared/runs";
import type { RetentionPolicy } from "../shared/settings";
import type { AttemptJournal } from "./attempt-journal";
import { evaluateRetention, exportFixtures, type ExportResult } from "./export-retention";
import type { VersionedStore } from "./store";

const DAY = 86_400_000;
const TERMINAL = new Set<RunRecord["status"]>(["delivered", "failed", "cancelled"]);
/** A delivery that still has work for Zelqio Flow to do: a commit to publish, or a scheduled next look. */
const OPEN_DELIVERY = new Set<string>(["pending"]);

/**
 * A run that is not finished, or whose finish is not settled yet: it still has an operation in flight, a delivery that
 * waits for the next step, or an attempt that is not settled in the journal. Such a run is never purged or deleted.
 */
export function isBusy(run: RunRecord, unsettledTasks: ReadonlySet<string>): boolean {
  return !TERMINAL.has(run.status)
    || run.pending !== null
    || unsettledTasks.has(run.id)
    || (run.delivery !== undefined && (OPEN_DELIVERY.has(run.delivery.state) || run.delivery.nextAt !== undefined));
}

export interface RetentionPlan {
  /** Whole finished runs to delete (their attempt-journal entries go with them). */
  remove: string[];
  /** Finished runs that stay but lose their result text. */
  clear: string[];
}

/**
 * Pure: which finished runs to delete and which results to clear. It reuses `evaluateRetention`, so a run is only a
 * candidate when it is older than the limit and no active run reaches it, directly or through other runs: a delivered
 * child stays while its coordinator is active, and a coordinator stays while one of its tasks is. Doubt keeps.
 * Beyond the age limit, the oldest unreferenced finished runs go until at most `maxFinishedRuns` remain.
 */
export function planRetention(input: {
  runs: readonly RunRecord[];
  unsettledTasks: ReadonlySet<string>;
  policy: RetentionPolicy;
  now: number;
}): RetentionPlan {
  const { runs, unsettledTasks, policy, now } = input;
  const children = new Map<string, string[]>();
  for (const run of runs) if (run.parentRunId) children.set(run.parentRunId, [...(children.get(run.parentRunId) ?? []), run.id]);
  const evaluated = evaluateRetention({
    records: runs.map(run => ({
      id: run.id,
      kind: "run",
      createdAt: run.updatedAt,
      refs: [...new Set([...(run.parentRunId ? [run.parentRunId] : []), ...run.dependsOn, ...(children.get(run.id) ?? [])])],
    })),
    activeRefs: runs.filter(run => isBusy(run, unsettledTasks)).map(run => run.id),
    maxAgeMs: { run: policy.finishedDays * DAY },
    now,
  });
  if (evaluated.status !== "evaluated") return { remove: [], clear: [] };

  const decision = new Map(evaluated.decisions.map(entry => [entry.id, entry.decision]));
  const finished = runs.filter(run => TERMINAL.has(run.status));
  const remove = new Set(finished.filter(run => decision.get(run.id) === "eligible").map(run => run.id));
  const overflow = finished.length - remove.size - policy.maxFinishedRuns;
  if (overflow > 0) {
    const oldest = finished
      .filter(run => decision.get(run.id) === "keep_recent")
      .sort((a, b) => a.updatedAt - b.updatedAt || a.id.localeCompare(b.id));
    for (const run of oldest.slice(0, overflow)) remove.add(run.id);
  }
  const clear = finished.filter(run => !remove.has(run.id) && run.result !== null
    && decision.get(run.id) !== "keep_referenced" && decision.get(run.id) !== "keep_future"
    && now - run.updatedAt >= policy.resultDays * DAY).map(run => run.id);
  return { remove: [...remove], clear };
}

export interface PurgeDeps {
  store: VersionedStore<RunsState>;
  attempts: AttemptJournal;
  policy: RetentionPolicy;
  now: number;
}

/**
 * Applies the retention policy. Call it through `RunManager.maintain` so no run is being changed at the same time.
 *
 * Crash safety: the runs file is replaced in one atomic step, so a crash leaves either the old or the new file, never
 * a mix. The attempt journal is cleaned afterwards, and every pass also removes entries whose run no longer exists,
 * so a crash between the two steps is repaired by the next pass. A second pass with nothing left to do writes nothing.
 * It never touches Paseo agents, worktrees or Git branches: it only forgets the plugin's own records.
 */
export async function purgeFinished(deps: PurgeDeps): Promise<PurgeResult> {
  const journal = await deps.attempts.read();
  const unsettledTasks = new Set(journal.entries.filter(entry => entry.status !== "settled").map(entry => entry.task));
  const outcome = await deps.store.update(state => {
    const plan = planRetention({ runs: state.runs, unsettledTasks, policy: deps.policy, now: deps.now });
    const remove = new Set(plan.remove);
    const clear = new Set(plan.clear);
    const live = new Set(state.runs.filter(run => !remove.has(run.id)).map(run => run.id));
    if (!remove.size && !clear.size) return { result: { removed: 0, cleared: 0, live } };
    const runs = state.runs.filter(run => !remove.has(run.id)).map(run => (clear.has(run.id) ? { ...run, result: null } : run));
    return { result: { removed: remove.size, cleared: clear.size, live }, next: { runs } };
  });
  const removedAttempts = await deps.attempts.forget(task => !outcome.live.has(task));
  // The store keeps one previous copy; rewrite once so it no longer holds the prompts and results that were just removed.
  if (outcome.removed || outcome.cleared) await deps.store.update(state => ({ result: undefined, next: state }));
  return { removedRuns: outcome.removed, clearedResults: outcome.cleared, removedAttempts };
}

const VERDICTS: Record<RunRecord["status"], "PASS" | "FAIL" | "BLOCKED" | "NOT_RUN"> = {
  delivered: "PASS", failed: "FAIL", cancelled: "BLOCKED", queued: "NOT_RUN", running: "NOT_RUN", waiting_quota: "NOT_RUN",
};

/** Manual export: only the id, the verdict and the commit of each run. Runs without a commit are counted, not exported. */
export function exportRuns(runs: readonly RunRecord[]): ExportResult {
  return exportFixtures(runs.map(run => ({ id: run.id, verdict: VERDICTS[run.status], sha: run.delivery?.sha })));
}

/** The plugin's own state files. Settings live in Paseo; the Git project authorizations are the user's own and stay. */
const STATE_STEMS = [
  "runs", "attempts", "git-operation-intents", "git-delivery-plans", "routing-decisions", "approval-requests", "coordination-lease",
] as const;
const VARIANT = /^(?:|\.bak|\.restore|\.tmp-.*|\.bak\.tmp-.*|\.corrupt-.*)$/;

export function isStateFile(name: string): boolean {
  return STATE_STEMS.some(stem => name.startsWith(`${stem}.json`) && VARIANT.test(name.slice(stem.length + 5)));
}

/**
 * Deletes every run, attempt and Git journal file of the plugin, including backups and preserved corrupt copies.
 * Refused while any run is active or still settling, because those records are what keeps work from running twice.
 * Call it through `RunManager.maintain`. Paseo agents, worktrees, branches and the user's authorizations are untouched.
 */
export async function deleteLocalState(deps: { directory: string; store: VersionedStore<RunsState>; attempts: AttemptJournal }) {
  const [{ data }, journal] = await Promise.all([deps.store.load(), deps.attempts.read()]);
  const unsettledTasks = new Set(journal.entries.filter(entry => entry.status !== "settled").map(entry => entry.task));
  if (unsettledTasks.size || data.runs.some(run => isBusy(run, unsettledTasks))) {
    throw new ZelqioError("disabled", "Runs are still active. Stop them or wait until they finish before deleting local data.");
  }
  let deletedFiles = 0;
  for (const entry of await readdir(deps.directory, { withFileTypes: true })) {
    if (!entry.isFile() || !isStateFile(entry.name)) continue;
    await rm(join(deps.directory, entry.name), { force: true });
    deletedFiles++;
  }
  return { deletedFiles };
}
