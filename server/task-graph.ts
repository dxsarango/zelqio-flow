export interface TaskNode {
  id: string;
  dependencies: readonly string[];
}

export type TaskGraph = { order: readonly string[]; dependencies: ReadonlyMap<string, readonly string[]> };
type GraphResult =
  | { ok: true; graph: TaskGraph }
  | { ok: false; reason: "invalid_id" | "duplicate_task" | "unknown_dependency" | "cycle"; tasks: readonly string[] };

/** Compiles only dependency structure. Runtime state, claims, leases and effects are separate. */
export function compileTaskGraph(nodes: readonly TaskNode[]): GraphResult {
  const dependencies = new Map<string, string[]>();
  for (const node of nodes) {
    if (!node.id.trim()) return { ok: false, reason: "invalid_id", tasks: [node.id] };
    if (dependencies.has(node.id)) return { ok: false, reason: "duplicate_task", tasks: [node.id] };
    dependencies.set(node.id, [...new Set(node.dependencies)].sort());
  }

  const ids = [...dependencies.keys()].sort();
  const dependents = new Map(ids.map(id => [id, [] as string[]]));
  const unresolved = new Map<string, number>();
  const queue: string[] = [];
  for (const id of ids) {
    const required = dependencies.get(id)!;
    unresolved.set(id, required.length);
    if (!required.length) queue.push(id);
    for (const parent of required) {
      const downstream = dependents.get(parent);
      if (!downstream) return { ok: false, reason: "unknown_dependency", tasks: [id, parent] };
      downstream.push(id);
    }
  }
  for (let index = 0; index < queue.length; index++) {
    for (const downstream of dependents.get(queue[index])!) {
      const remaining = unresolved.get(downstream)! - 1;
      unresolved.set(downstream, remaining);
      if (remaining === 0) queue.push(downstream);
    }
  }
  if (queue.length !== ids.length) {
    return { ok: false, reason: "cycle", tasks: ids.filter(id => unresolved.get(id)! > 0) };
  }
  return { ok: true, graph: { order: queue, dependencies } };
}

export type TaskSchedulingState = "queued" | "running" | "blocked" | "succeeded" | "failed" | "cancelled";
const schedulingStates: ReadonlySet<string> = new Set<TaskSchedulingState>([
  "queued", "running", "blocked", "succeeded", "failed", "cancelled",
]);

/** Returns an ordered proposal. Claiming a task and reserving a slot require an atomic runtime operation. */
export function planTaskCandidates(
  graph: TaskGraph,
  states: ReadonlyMap<string, TaskSchedulingState>,
  maxConcurrent: number,
) {
  if (!Number.isSafeInteger(maxConcurrent) || maxConcurrent < 1 || states.size !== graph.dependencies.size) {
    return { status: "reconcile" } as const;
  }

  let running = 0;
  for (const [id, state] of states) {
    if (!graph.dependencies.has(id) || !schedulingStates.has(state)) return { status: "reconcile" } as const;
    if (state === "running") running++;
  }
  const slots = Math.max(0, maxConcurrent - running);
  const candidates = graph.order.filter(id =>
    states.get(id) === "queued" && graph.dependencies.get(id)!.every(parent => states.get(parent) === "succeeded"),
  );
  return { status: "proposed", slots, candidates: candidates.slice(0, slots) } as const;
}
