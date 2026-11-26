import { mkdtemp, rm, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GitOperationJournal } from "../server/git-operation-journal";

const initial = {
  id: "op-1", repository: "repo", targetRef: "refs/heads/main",
  previousSha: "a".repeat(40), expectedSha: "b".repeat(40),
};
const second = { ...initial, id: "op-2", targetRef: "refs/heads/other" };
const observation = (sha: string) => ({
  repository: initial.repository, ref: initial.targetRef, observation: { status: "present", sha, object: "verified" } as const,
});

describe("Git operation intent fixture", () => {
  let directory: string;
  let journal: GitOperationJournal;
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "zelqio-git-journal-"));
    journal = new GitOperationJournal(directory);
  });
  afterEach(() => rm(directory, { recursive: true, force: true }));

  it("serializes within the same process and deduplicates the original intent after reopening", async () => {
    const reopened = new GitOperationJournal(directory);
    const results = await Promise.all([journal.recordIntent(initial), reopened.recordIntent(initial)]);
    expect(results.sort()).toEqual(["already_recorded", "recorded"]);
    expect(await reopened.recordIntent({ ...initial, expectedSha: "c".repeat(40) })).toBe("blocked");
    expect(await reopened.recordIntent(second)).toBe("blocked");
  });

  it("keeps an uncertain result pending until the exact verified result is observed", async () => {
    await journal.recordIntent(initial);
    const restarted = new GitOperationJournal(directory);
    expect(await restarted.reconcile("unrelated", observation(initial.expectedSha))).toEqual({ status: "missing_intent" });
    expect(await restarted.reconcile(initial.id, observation(initial.previousSha))).toMatchObject({ status: "no_change_observed" });
    expect(await restarted.recordIntent(second)).toBe("blocked");
    expect(await restarted.reconcile(initial.id, observation("c".repeat(40)))).toMatchObject({ status: "conflict" });
    expect(await restarted.recordIntent(second)).toBe("blocked");
    expect(await restarted.reconcile(initial.id, observation(initial.expectedSha))).toMatchObject({ status: "applied" });
    expect(await journal.reconcile(initial.id, observation(initial.expectedSha))).toEqual({ status: "already_applied" });
    expect(await journal.recordIntent(second)).toBe("recorded");
  });

  it("keeps a lost primary journal from restoring stale operation authority", async () => {
    await journal.recordIntent(initial);
    await journal.reconcile(initial.id, observation(initial.expectedSha));
    await unlink(join(directory, "git-operation-intents.json"));
    await expect(new GitOperationJournal(directory).recordIntent(second)).rejects.toMatchObject({ code: "disabled" });
  });
});
