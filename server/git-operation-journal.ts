import { z } from "zod";
import { isFullGitObjectId } from "./git-preflight";
import { reconcileGitOperation, type GitReconciliationSnapshot } from "./git-reconciliation";
import { VersionedStore } from "./store";

const intent = z.strictObject({
  id: z.string().regex(/^[A-Za-z0-9_.-]{1,128}$/),
  repository: z.string().trim().min(1),
  targetRef: z.string().startsWith("refs/").min(6),
  previousSha: z.string().refine(isFullGitObjectId),
  expectedSha: z.string().refine(isFullGitObjectId),
}).refine(value => value.previousSha.length === value.expectedSha.length && value.previousSha !== value.expectedSha);
const journal = z.strictObject({
  operations: z.array(z.strictObject({ intent, status: z.enum(["pending", "applied"]) })),
});
type Intent = z.infer<typeof intent>;
type Journal = z.infer<typeof journal>;
type RecordStatus = "recorded" | "already_recorded" | "blocked";

/**
 * Fixture journal for prior intent and confirmed observations. Its lock scope is one process, and a
 * stored intent or observation grants no authority to execute a Git operation or retry it.
 */
export class GitOperationJournal {
  private readonly store: VersionedStore<Journal>;

  constructor(directory: string) {
    this.store = new VersionedStore({
      dir: directory, name: "git-operation-intents", version: 1, schema: journal,
      defaults: () => ({ operations: [] }),
    });
  }

  recordIntent(input: Intent): Promise<RecordStatus> {
    const parsed = intent.safeParse(input);
    if (!parsed.success) return Promise.resolve("blocked");
    const current = parsed.data;
    return this.store.update<RecordStatus>(({ operations }) => {
      const existing = operations.find(entry => entry.intent.id === current.id);
      if (existing) {
        const same = existing.intent.repository === current.repository && existing.intent.targetRef === current.targetRef
          && existing.intent.previousSha === current.previousSha && existing.intent.expectedSha === current.expectedSha;
        return { result: same ? "already_recorded" : "blocked" };
      }
      if (operations.some(entry => entry.status === "pending" && entry.intent.repository === current.repository)) {
        return { result: "blocked" };
      }
      return { result: "recorded", next: { operations: [...operations, { intent: current, status: "pending" }] } };
    });
  }

  reconcile(id: string, snapshot: GitReconciliationSnapshot) {
    type Result = ReturnType<typeof reconcileGitOperation> | { status: "missing_intent" } | { status: "already_applied" };
    return this.store.update<Result>(({ operations }) => {
      const index = operations.findIndex(entry => entry.intent.id === id);
      const current = operations[index];
      if (!current) return { result: { status: "missing_intent" } };
      if (current.status === "applied") return { result: { status: "already_applied" } };
      const result = reconcileGitOperation(current.intent, snapshot);
      if (result.status !== "applied") return { result };
      return {
        result,
        next: { operations: operations.with(index, { ...current, status: "applied" }) },
      };
    });
  }
}
