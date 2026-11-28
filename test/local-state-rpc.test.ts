import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import contribute from "../index.server";
import { VersionedStore } from "../server/store";
import { projectsListRpc, stateDeleteRpc, stateExportRpc, statePurgeRpc } from "../shared/local-state";
import { runRecord, runsState, type RunRecord } from "../shared/runs";
import { zelqioSettings } from "../shared/settings";
import { createMockServer } from "./mock-sdk";

const DAY = 86_400_000;
const SHA = "c".repeat(40);

function run(id: string, ageDays: number, change: Partial<RunRecord> = {}): RunRecord {
  const at = Date.now() - ageDays * DAY;
  return runRecord.parse({
    id, prompt: `prompt-of-${id}`, role: "developer", capability: "implement", complexity: null, cwd: "C:\\Work\\Repo\\", status: "delivered",
    current: null, attempts: 1, suspended: {}, resumeAt: null, pending: null, handledError: null, userBaseline: null,
    attention: false, result: `result-of-${id}`, error: null, history: [], createdAt: at, updatedAt: at,
    delivery: { state: "integrated", sha: SHA }, ...change,
  });
}

describe("local state through the plugin entry", () => {
  let directory: string;
  let cleanup: (() => void) | undefined;
  let previous: string | undefined;

  const start = (settings: Record<string, unknown> = {}, workspaces?: () => Promise<{ entries: unknown[] }>) => {
    const values = zelqioSettings.parse(settings);
    const paseo = { workspaces: { list: workspaces ?? (async () => ({ entries: [] })) } } as never;
    const mock = createMockServer({ paseo }, (id) => (id === "general" ? { status: "ready", revision: "1", values } : { status: "invalid", revision: "0", error: "mock" }));
    cleanup = contribute(mock.server) as () => void;
    return mock;
  };
  const seed = (runs: RunRecord[]) =>
    new VersionedStore({ dir: directory, name: "runs", version: 1, schema: runsState, defaults: () => ({ runs: [] }) }).save({ runs });
  const stored = async () => (await new VersionedStore({ dir: directory, name: "runs", version: 1, schema: runsState, defaults: () => ({ runs: [] }) }).load()).data.runs;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "zelqio-entry-"));
    previous = process.env.ZELQIO_FLOW_HOME;
    process.env.ZELQIO_FLOW_HOME = directory;
  });
  afterEach(async () => {
    cleanup?.();
    cleanup = undefined;
    if (previous === undefined) delete process.env.ZELQIO_FLOW_HOME;
    else process.env.ZELQIO_FLOW_HOME = previous;
    await rm(directory, { recursive: true, force: true });
  });

  it("exports only the id, the verdict and the commit", async () => {
    await seed([run("run-one", 1), run("run-two", 1, { delivery: { state: "no_changes" } })]);
    const result = await start().call(stateExportRpc, {});
    expect(result).toEqual({ ok: true, data: { version: 1, rejected: 1, records: [{ id: "run-one", verdict: "PASS", sha: SHA }] } });
    expect(JSON.stringify(result)).not.toMatch(/prompt-of|result-of|Work/);
  });

  it("applies the saved retention policy when asked, and a second time finds nothing", async () => {
    await seed([run("run-old", 20), run("run-new", 1)]);
    const mock = start({ retention: { finishedDays: 7 } });
    const first = await mock.call(statePurgeRpc, {});
    expect(first.ok).toBe(true);
    expect((await stored()).map(item => item.id)).toEqual(["run-new"]);
    expect(await mock.call(statePurgeRpc, {})).toEqual({ ok: true, data: { removedRuns: 0, clearedResults: 0, removedAttempts: 0 } });
    expect(await readFile(join(directory, "runs.json"), "utf8")).not.toContain("prompt-of-run-old");
  });

  it("clears result text when the results are not kept", async () => {
    await seed([run("run-one", 1)]);
    const mock = start({ retention: { resultDays: 0 } });
    await mock.call(statePurgeRpc, {});
    expect((await stored())[0]).toMatchObject({ id: "run-one", result: null });
  });

  it("refuses to delete local data while a run is active and deletes it once none is", async () => {
    await writeFile(join(directory, "git-projects.json"), "{}", "utf8");
    await seed([run("run-active", 1, { status: "running", result: null, delivery: undefined }), run("run-done", 1)]);
    const mock = start();
    const refused = await mock.call(stateDeleteRpc, { confirm: true });
    expect(refused).toMatchObject({ ok: false, error: { code: "disabled" } });
    expect(await stored()).toHaveLength(2);

    await seed([run("run-done", 1)]);
    const deleted = await mock.call(stateDeleteRpc, { confirm: true });
    expect(deleted).toMatchObject({ ok: true, data: { deletedFiles: expect.any(Number) } });
    expect(await stored()).toEqual([]);
    expect((await readdir(directory)).filter(name => name.startsWith("runs.json") || name.startsWith("attempts.json"))).toEqual([]);
    expect(await readFile(join(directory, "git-projects.json"), "utf8")).toBe("{}");
  });

  it("requires an explicit confirmation to delete", async () => {
    const mock = start();
    await expect(mock.call(stateDeleteRpc, { confirm: false as never })).rejects.toThrow();
  });

  it("lists the projects of Paseo and of earlier runs, by normalized key", async () => {
    await seed([run("run-one", 1), run("run-two", 1, { cwd: "/work/other", projectKey: "/work/other" })]);
    const mock = start({}, async () => ({ entries: [{ projectRootPath: "C:\\Work\\Repo", projectDisplayName: "Repo" }, { projectRootPath: "/srv/app", projectDisplayName: "App" }] }));
    expect(await mock.call(projectsListRpc, {})).toEqual({
      ok: true,
      data: { projects: [{ key: "/srv/app", name: "App" }, { key: "/work/other", name: null }, { key: "c:/work/repo", name: "Repo" }] },
    });
  });

  it("still lists the projects of earlier runs when Paseo cannot be asked", async () => {
    await seed([run("run-one", 1)]);
    const mock = start({}, async () => { throw new Error("offline"); });
    expect(await mock.call(projectsListRpc, {})).toEqual({ ok: true, data: { projects: [{ key: "c:/work/repo", name: null }] } });
  });
});
