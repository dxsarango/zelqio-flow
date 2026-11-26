import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FallbackJournal } from "../server/fallback";
import { resolveRoles } from "../server/roles";
import type { RoutingModelFacts, RoutingRequest } from "../server/router";
import { defaultSettings } from "../shared/settings";

let directory: string;
beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), "zelqio-fallback-")); });
afterEach(async () => { await rm(directory, { recursive: true, force: true }); });

const free = { provider: "free-main", model: "model" };
const spare = { provider: "free-spare", model: "model" };
const paid = { provider: "paid", model: "model" };
const failed = { run: "run-1", checkpoint: "checkpoint-sha", target: free, attempt: 0, funding: "free", cause: "quota_exhausted", observedAt: 100 } as const;

function request(): RoutingRequest {
  const provider = (id: string) => ({
    id, label: id, enabled: true, status: "ready" as const, modes: [],
    models: [{ id: "model", label: "Model", selectable: true, isDefault: true, thinkingOptions: [] }],
  });
  const facts: RoutingModelFacts = {
    permitted: true, funding: "free", quota: { status: "fresh", remainingPct: 60, observedAt: 90 },
  };
  return {
    catalog: { providers: [provider(free.provider), provider(spare.provider), provider(paid.provider)], generatedAt: "2026-11-26" },
    settings: {
      ...defaultSettings(),
      consumptionOptIn: true,
      providers: {
        [free.provider]: { use: "primary", funding: "free" },
        [spare.provider]: { use: "auxiliary", funding: "free" },
        [paid.provider]: { use: "primary", funding: "consumption" },
      },
    },
    role: resolveRoles({}).find(({ id }) => id === "developer")!,
    capability: "implement",
    models: new Map([
      [free.provider, new Map([[free.model, facts]])],
      [spare.provider, new Map([[spare.model, facts]])],
      [paid.provider, new Map([[paid.model, { ...facts, funding: "consumption", spendPermitted: true }]])],
    ]),
  };
}

describe("fallback journal", () => {
  it("preserves the checkpoint and funding and records at most one retry across concurrent writers", async () => {
    const [first, second] = await Promise.all([
      new FallbackJournal(directory).recordFailure(failed, request()),
      new FallbackJournal(directory).recordFailure(failed, request()),
    ]);
    expect([first, second]).toContainEqual({ status: "retry", target: spare, checkpoint: failed.checkpoint, attempt: 1 });
    expect([first, second]).toContainEqual({ status: "already_recorded" });
    const journal = new FallbackJournal(directory);
    await expect(journal.recordFailure({ ...failed, attempt: 1, target: paid }, request())).rejects.toMatchObject({ code: "invalid_input" });
    expect(await journal.recordFailure({ ...failed, attempt: 1, target: spare, observedAt: 120 }, request())).toEqual({ status: "blocked" });
  });

  it("blocks if the only alternative would switch to consumption", async () => {
    const routing = request();
    routing.settings.providers[spare.provider] = { use: "off", funding: "free" };
    expect(await new FallbackJournal(directory).recordFailure(failed, routing)).toEqual({ status: "blocked" });
  });

  it("keeps an exhausted target suspended across restart until newer positive evidence arrives", async () => {
    const current = request();
    await new FallbackJournal(directory).recordFailure(failed, current);
    const restarted = new FallbackJournal(directory);
    current.allowUnknownQuota = true;
    expect((await restarted.plan(current)).selected).toEqual(spare);
    const replaceQuota = (quota: RoutingModelFacts["quota"]) => {
      const models = new Map(current.models);
      models.set(free.provider, new Map([[free.model, { permitted: true, funding: "free", quota }]]));
      current.models = models;
    };
    replaceQuota(undefined);
    expect((await restarted.plan(current)).selected).toEqual(spare);
    replaceQuota({ status: "fresh", remainingPct: 75, observedAt: 101 });
    expect((await restarted.plan(current)).selected).toEqual(free);
  });

  it("does not retry a denied attempt or accept a conflicting replay", async () => {
    const journal = new FallbackJournal(directory);
    expect(await journal.recordFailure({ ...failed, cause: "denied" }, request())).toEqual({ status: "blocked" });
    await expect(journal.recordFailure(failed, request())).rejects.toMatchObject({ code: "invalid_input" });
    await expect(journal.recordFailure({ ...failed, checkpoint: "C:/private/path" }, request())).rejects.toBeDefined();
  });

  it("blocks on corrupt state without silently replaying from a stale backup", async () => {
    const journal = new FallbackJournal(directory);
    await journal.recordFailure(failed, request());
    await journal.recordFailure({ ...failed, attempt: 1, target: spare, observedAt: 120 }, request());
    const file = join(directory, "routing-decisions.json");
    await writeFile(file, "{ damaged");
    await expect(new FallbackJournal(directory).recordFailure(failed, request())).rejects.toMatchObject({ code: "disabled" });
    await expect(new FallbackJournal(directory).plan(request())).rejects.toMatchObject({ code: "disabled" });
    expect(await readFile(file, "utf8")).toBe("{ damaged");
  });
});
