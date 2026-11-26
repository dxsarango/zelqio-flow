import { describe, expect, it } from "vitest";
import { compileTaskGraph, planTaskCandidates, type TaskSchedulingState } from "../server/task-graph";

describe("task dependency graph", () => {
  it("preserves dependency order and produces the same order for permuted inputs", () => {
    const nodes = [
      { id: "pack", dependencies: ["review", "test", "review"] },
      { id: "test", dependencies: ["edit"] },
      { id: "edit", dependencies: [] },
      { id: "review", dependencies: ["edit"] },
    ];
    const result = compileTaskGraph(nodes);
    expect(result).toMatchObject({ ok: true, graph: { order: ["edit", "review", "test", "pack"] } });
    expect(compileTaskGraph(nodes.toReversed())).toEqual(result);
  });

  it("identifies missing dependencies and invalid or duplicate task IDs", () => {
    const task = { id: "review", dependencies: [] };
    expect(compileTaskGraph([task, task])).toEqual({ ok: false, reason: "duplicate_task", tasks: ["review"] });
    expect(compileTaskGraph([{ ...task, id: "" }])).toEqual({ ok: false, reason: "invalid_id", tasks: [""] });
    expect(compileTaskGraph([{ ...task, dependencies: ["missing"] }])).toEqual({
      ok: false, reason: "unknown_dependency", tasks: ["review", "missing"],
    });
  });

  it("reports the tasks left unresolved by a cycle, including a self dependency", () => {
    expect(compileTaskGraph([
      { id: "a", dependencies: ["b"] }, { id: "b", dependencies: ["a"] }, { id: "c", dependencies: ["a"] },
    ])).toEqual({ ok: false, reason: "cycle", tasks: ["a", "b", "c"] });
    expect(compileTaskGraph([{ id: "a", dependencies: ["a"] }])).toEqual({ ok: false, reason: "cycle", tasks: ["a"] });
  });

  it("handles a long graph without recursion", () => {
    const nodes = Array.from({ length: 10_000 }, (_, index) => ({
      id: `t${index}`, dependencies: index === 0 ? [] : [`t${index - 1}`],
    }));
    expect(compileTaskGraph(nodes)).toMatchObject({ ok: true, graph: { order: nodes.map(node => node.id) } });
  });

  it("proposes only queued tasks with satisfied dependencies within the remaining slots", () => {
    const result = compileTaskGraph([
      { id: "edit", dependencies: [] },
      { id: "review", dependencies: ["edit"] },
      { id: "release", dependencies: ["review"] },
      { id: "test", dependencies: ["edit"] },
      { id: "worker", dependencies: [] },
    ]);
    if (!result.ok) throw new Error("Invalid test fixture.");
    const state = new Map<string, TaskSchedulingState>([
      ["edit", "succeeded"], ["review", "queued"], ["release", "queued"], ["test", "queued"], ["worker", "running"],
    ]);
    expect(planTaskCandidates(result.graph, state, 2)).toEqual({ status: "proposed", slots: 1, candidates: ["review"] });
    expect(planTaskCandidates(result.graph, state, 1)).toEqual({ status: "proposed", slots: 0, candidates: [] });
    state.set("review", "blocked");
    expect(planTaskCandidates(result.graph, state, 3)).toEqual({ status: "proposed", slots: 2, candidates: ["test"] });
  });

  it("requires a reconciled task snapshot before proposing any dispatch", () => {
    const result = compileTaskGraph([{ id: "task", dependencies: [] }]);
    if (!result.ok) throw new Error("Invalid test fixture.");
    expect(planTaskCandidates(result.graph, new Map(), 1)).toEqual({ status: "reconcile" });
    expect(planTaskCandidates(result.graph, new Map([["other", "queued"]]), 1)).toEqual({ status: "reconcile" });
    expect(planTaskCandidates(result.graph, new Map([["task", "queued"]]), 0)).toEqual({ status: "reconcile" });
  });
});
