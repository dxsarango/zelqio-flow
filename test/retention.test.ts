import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AttemptJournal } from "../server/attempt-journal";
import { deleteLocalState, exportRuns, isBusy, isStateFile, planRetention, purgeFinished } from "../server/retention";
import { RunManager, type AgentPort, type AgentSnapshot, type CreateAgentInput } from "../server/run-manager";
import { nodeFs, VersionedStore, type FsOps } from "../server/store";
import type { ProviderCatalogData } from "../shared/providers";
import { runRecord, runsState, type RunRecord, type RunsState } from "../shared/runs";
import { defaultSettings, DEFAULT_RETENTION, retentionPolicy, zelqioSettings, type RetentionPolicy } from "../shared/settings";

const DAY = 86_400_000;
const NOW = Date.parse("2026-11-27T12:00:00Z");
const SHA = "b".repeat(40);
const policy = (change: Partial<RetentionPolicy> = {}): RetentionPolicy => ({ ...DEFAULT_RETENTION, ...change });

/** A finished run last touched `ageDays` ago. Its prompt and result carry markers that must disappear with it. */
function run(id: string, ageDays: number, change: Partial<RunRecord> = {}): RunRecord {
  const at = NOW - ageDays * DAY;
  return runRecord.parse({
    id, prompt: `prompt-of-${id}`, role: "developer", capability: "implement", complexity: null, cwd: "/work/repo", status: "delivered",
    current: null, attempts: 1, suspended: {}, resumeAt: null, pending: null, handledError: null, userBaseline: null,
    attention: false, result: `result-of-${id}`, error: null, history: [], createdAt: at, updatedAt: at, ...change,
  });
}
const none: ReadonlySet<string> = new Set();
const plan = (runs: RunRecord[], change: Partial<RetentionPolicy> = {}, unsettled: ReadonlySet<string> = none) =>
  planRetention({ runs, unsettledTasks: unsettled, policy: policy(change), now: NOW });

describe("retention policy setting", () => {
  it("defaults to 30 days, results kept, at most 200 finished runs, and old settings still parse", () => {
    expect(DEFAULT_RETENTION).toEqual({ finishedDays: 30, resultDays: 30, maxFinishedRuns: 200 });
    expect(zelqioSettings.parse({}).retention).toEqual(DEFAULT_RETENTION);
    expect(zelqioSettings.parse({ retention: { finishedDays: 7 } }).retention).toEqual({ finishedDays: 7, resultDays: 30, maxFinishedRuns: 200 });
    expect(defaultSettings().retention).toEqual(DEFAULT_RETENTION);
  });

  it("is adjustable within bounds; 0 days for results means keep nothing after delivery", () => {
    expect(retentionPolicy.safeParse({ resultDays: 0 }).success).toBe(true);
    expect(retentionPolicy.safeParse({ finishedDays: 0 }).success).toBe(false);
    expect(retentionPolicy.safeParse({ maxFinishedRuns: 0 }).success).toBe(false);
    expect(retentionPolicy.safeParse({ finishedDays: 1.5 }).success).toBe(false);
    expect(retentionPolicy.safeParse({ other: 1 }).success).toBe(false);
  });
});

describe("planRetention: which records go", () => {
  it("removes finished runs older than the limit and keeps recent ones", () => {
    const result = plan([run("old", 31), run("edge", 30), run("recent", 29), run("fresh", 0)]);
    expect(result.remove.sort()).toEqual(["edge", "old"]);
    expect(plan([run("a", 5)], { finishedDays: 3 }).remove).toEqual(["a"]);
  });

  it("failed and cancelled runs follow the same limit", () => {
    const result = plan([run("failed", 40, { status: "failed", result: null, error: "x" }), run("cancelled", 40, { status: "cancelled", result: null })]);
    expect(result.remove.sort()).toEqual(["cancelled", "failed"]);
  });

  it("never touches a run that is not finished, however old", () => {
    const runs = (["queued", "running", "waiting_quota"] as const).map(status => run(`r-${status}`, 400, { status, result: null }));
    expect(plan(runs, { resultDays: 0 })).toEqual({ remove: [], clear: [] });
  });

  it("keeps a delivered child while its coordinator is active, and the coordinator while a task is active", () => {
    const coordinator = run("coord", 90, { status: "running", result: null });
    const child = run("child", 90, { parentRunId: "coord" });
    const dependency = run("dep", 90, { parentRunId: "coord" });
    const dependent = run("next", 90, { parentRunId: "coord", status: "queued", result: null, dependsOn: ["dep"] });
    expect(plan([coordinator, child, dependency, dependent]).remove).toEqual([]);

    const doneCoordinator = run("coord2", 90, { result: "x" });
    const activeChild = run("child2", 90, { parentRunId: "coord2", status: "running", result: null });
    expect(plan([doneCoordinator, activeChild]).remove).toEqual([]);
    expect(plan([doneCoordinator, { ...activeChild, status: "delivered", result: "y" }]).remove.sort()).toEqual(["child2", "coord2"]);
  });

  it("keeps a run with an operation in flight, a pending delivery or a scheduled next look", () => {
    const runs = [
      run("pending-op", 90, { pending: { kind: "report", key: "k1" } }),
      run("delivery-pending", 90, { delivery: { state: "pending" } }),
      run("delivery-next", 90, { delivery: { state: "review", nextAt: NOW + 1000 } }),
      run("delivery-done", 90, { delivery: { state: "integrated", sha: SHA } }),
    ];
    expect(plan(runs).remove).toEqual(["delivery-done"]);
  });

  it("keeps a run whose attempt is not settled in the journal", () => {
    const runs = [run("ambiguous", 90), run("settled", 90)];
    expect(plan(runs, {}, new Set(["ambiguous"])).remove).toEqual(["settled"]);
    expect(isBusy(runs[0], new Set(["ambiguous"]))).toBe(true);
    expect(isBusy(runs[0], none)).toBe(false);
  });

  it("never keeps more than the maximum, dropping the oldest unreferenced runs first", () => {
    const runs = [run("a", 5), run("b", 4), run("c", 3), run("d", 2), run("e", 1)];
    expect(plan(runs, { maxFinishedRuns: 3 }).remove.sort()).toEqual(["a", "b"]);
    expect(plan(runs, { maxFinishedRuns: 5 }).remove).toEqual([]);
    // Active runs do not count toward the cap, and referenced runs are never dropped for it.
    const active = [run("live", 1, { status: "running", result: null }), run("kept", 5, { parentRunId: "live" }), ...runs];
    expect(plan(active, { maxFinishedRuns: 2 }).remove.sort()).toEqual(["a", "b", "c", "d"]);
  });

  it("clears result text after the result limit while keeping the run; 0 clears it as soon as it is delivered", () => {
    const runs = [run("fresh", 1), run("stale", 10)];
    expect(plan(runs, { resultDays: 5 })).toEqual({ remove: [], clear: ["stale"] });
    expect(plan(runs).clear).toEqual([]);
    expect(plan(runs, { resultDays: 0 }).clear.sort()).toEqual(["fresh", "stale"]);
    // Nothing to clear when there is no text, and a referenced result is never cleared.
    expect(plan([run("empty", 1, { result: null })], { resultDays: 0 }).clear).toEqual([]);
    const coordinator = run("coord", 1, { status: "running", result: null });
    expect(plan([coordinator, run("child", 1, { parentRunId: "coord" })], { resultDays: 0 }).clear).toEqual([]);
    expect(plan([run("pending", 1, { delivery: { state: "pending" } })], { resultDays: 0 }).clear).toEqual([]);
  });

  it("a record dated in the future or an invalid input is kept", () => {
    expect(plan([run("future", -3)]).remove).toEqual([]);
    expect(plan([run("future", -3)], { resultDays: 0 }).clear).toEqual([]);
    expect(plan([run("dup", 90), run("dup", 90)]).remove).toEqual([]);
  });
});

describe("purgeFinished: applying the policy to the stored state", () => {
  let dir: string;
  const open = (fs?: FsOps) => new VersionedStore({ dir, name: "runs", version: 1, schema: runsState, defaults: () => ({ runs: [] }), fs });
  const seed = async (runs: RunRecord[], store = open()) => store.save({ runs });
  /** Records a finished attempt for a run in the journal. */
  const settle = async (journal: AttemptJournal, task: string) => {
    await journal.reserve({ key: `${task}-a1`, task, attempt: 1, maxConcurrent: 5 });
    await journal.confirmLaunch({ key: `${task}-a1`, agentRef: "agent-1" });
    await journal.settle({ key: `${task}-a1`, outcome: "succeeded", evidenceRef: "agent-idle" });
  };
  const stored = async () => (await open().load()).data.runs;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "zelqio-retention-"));
  });
  afterEach(() => rm(dir, { recursive: true, force: true }));

  it("deletes whole finished runs with their journal entries and keeps everything else", async () => {
    const attempts = new AttemptJournal(dir);
    await seed([run("old", 60), run("recent", 2), run("active", 60, { status: "running", result: null })]);
    await settle(attempts, "old");
    await settle(attempts, "recent");

    const result = await purgeFinished({ store: open(), attempts, policy: policy(), now: NOW });
    expect(result).toEqual({ removedRuns: 1, clearedResults: 0, removedAttempts: 1 });
    expect((await stored()).map(item => item.id).sort()).toEqual(["active", "recent"]);
    expect((await attempts.read()).entries.map(item => item.task)).toEqual(["recent"]);
  });

  it("clears result text but keeps the run when only the result limit is over", async () => {
    await seed([run("a", 10)]);
    const result = await purgeFinished({ store: open(), attempts: new AttemptJournal(dir), policy: policy({ resultDays: 5 }), now: NOW });
    expect(result).toMatchObject({ removedRuns: 0, clearedResults: 1 });
    expect((await stored())[0]).toMatchObject({ id: "a", result: null, prompt: "prompt-of-a" });
  });

  it("keeps a run whose attempt is ambiguous and its journal entry", async () => {
    const before = new AttemptJournal(dir);
    await seed([run("unsure", 90), run("sure", 90)]);
    await settle(before, "sure");
    await before.reserve({ key: "unsure-a1", task: "unsure", attempt: 1, maxConcurrent: 5 });
    await before.confirmLaunch({ key: "unsure-a1", agentRef: "agent-9" });
    const restarted = new AttemptJournal(dir);
    await restarted.recoverAfterRestart();

    await purgeFinished({ store: open(), attempts: restarted, policy: policy(), now: NOW });
    expect((await stored()).map(item => item.id)).toEqual(["unsure"]);
    expect((await restarted.read()).entries.map(item => `${item.task}:${item.status}`)).toEqual(["unsure:ambiguous"]);
  });

  it("is idempotent: a second pass changes nothing and writes nothing", async () => {
    const attempts = new AttemptJournal(dir);
    await seed([run("old", 60), run("recent", 2)]);
    await settle(attempts, "old");
    await purgeFinished({ store: open(), attempts, policy: policy(), now: NOW });

    let writes = 0;
    const counting: FsOps = { ...nodeFs, writeFileSynced: (path, data) => { writes++; return nodeFs.writeFileSynced(path, data); } };
    const before = await readFile(join(dir, "runs.json"), "utf8");
    const again = await purgeFinished({ store: open(counting), attempts, policy: policy(), now: NOW });
    expect(again).toEqual({ removedRuns: 0, clearedResults: 0, removedAttempts: 0 });
    expect(writes).toBe(0);
    expect(await readFile(join(dir, "runs.json"), "utf8")).toBe(before);
  });

  it("is atomic: a failure while replacing the file leaves the previous state complete, and a retry finishes the job", async () => {
    const attempts = new AttemptJournal(dir);
    await seed([run("old", 60), run("recent", 2)]);
    await settle(attempts, "old");
    const original = await readFile(join(dir, "runs.json"), "utf8");

    let renames = 0;
    const crashing: FsOps = { ...nodeFs, rename: (from, to) => (++renames === 2 ? Promise.reject(new Error("crash")) : nodeFs.rename(from, to)) };
    await expect(purgeFinished({ store: open(crashing), attempts, policy: policy(), now: NOW })).rejects.toThrow("crash");
    expect(await readFile(join(dir, "runs.json"), "utf8")).toBe(original);
    expect((await stored()).map(item => item.id).sort()).toEqual(["old", "recent"]);
    expect((await attempts.read()).entries).toHaveLength(1);

    await purgeFinished({ store: open(), attempts, policy: policy(), now: NOW });
    expect((await stored()).map(item => item.id)).toEqual(["recent"]);
    expect((await attempts.read()).entries).toHaveLength(0);
  });

  it("repairs a crash between removing the runs and cleaning the journal on the next pass", async () => {
    const attempts = new AttemptJournal(dir);
    await seed([run("old", 60), run("recent", 2)]);
    await settle(attempts, "old");
    await settle(attempts, "recent");
    const failing = vi.spyOn(attempts, "forget").mockRejectedValueOnce(new Error("crash"));

    await expect(purgeFinished({ store: open(), attempts, policy: policy(), now: NOW })).rejects.toThrow("crash");
    expect((await stored()).map(item => item.id)).toEqual(["recent"]);
    expect((await attempts.read()).entries.map(item => item.task).sort()).toEqual(["old", "recent"]);

    failing.mockRestore();
    const repaired = await purgeFinished({ store: open(), attempts, policy: policy(), now: NOW });
    expect(repaired).toEqual({ removedRuns: 0, clearedResults: 0, removedAttempts: 1 });
    expect((await attempts.read()).entries.map(item => item.task)).toEqual(["recent"]);
  });

  it("never drops an attempt that is not settled, even for a task with no run", async () => {
    const attempts = new AttemptJournal(dir);
    await attempts.reserve({ key: "ghost-a1", task: "ghost", attempt: 1, maxConcurrent: 5 });
    await seed([]);
    expect(await attempts.forget(() => true)).toBe(0);
    expect(await purgeFinished({ store: open(), attempts, policy: policy(), now: NOW })).toMatchObject({ removedAttempts: 0 });
    expect((await attempts.read()).entries).toHaveLength(1);
  });

  it("leaves no prompt or result of a purged run in the previous copy the store keeps", async () => {
    await seed([run("old", 60), run("recent", 2)]);
    await seed([run("old", 60), run("recent", 2)]);
    expect(await readFile(join(dir, "runs.json.bak"), "utf8")).toContain("prompt-of-old");
    await purgeFinished({ store: open(), attempts: new AttemptJournal(dir), policy: policy(), now: NOW });
    for (const file of ["runs.json", "runs.json.bak"]) {
      const text = await readFile(join(dir, file), "utf8");
      expect(text).not.toContain("prompt-of-old");
      expect(text).not.toContain("result-of-old");
      expect(text).toContain("prompt-of-recent");
    }
  });

  it("works through the run manager's own queue, without touching its agents", async () => {
    const touched: string[] = [];
    const port = new Proxy({}, { get: (_target, name) => () => { touched.push(String(name)); return Promise.resolve(null); } }) as unknown as AgentPort;
    const attempts = new AttemptJournal(dir);
    const manager = new RunManager({
      port, store: open(), attempts, readCatalog: async () => ({ providers: [], generatedAt: "" }), readUsage: async () => null,
      readSettings: async () => defaultSettings(), clock: () => NOW,
    });
    await seed([run("old", 60), run("recent", 2)]);
    const result = await manager.maintain(() => purgeFinished({ store: open(), attempts, policy: policy(), now: NOW }));
    expect(result.removedRuns).toBe(1);
    expect(touched).toEqual([]);
  });
});

describe("manual export", () => {
  it("carries only the id, the verdict and the commit", () => {
    const runs = [
      run("done", 1, { delivery: { state: "integrated", sha: SHA, prUrl: "https://github.com/example/repo/pull/1", reason: "x" } }),
      run("failed", 1, { status: "failed", result: null, error: "token=ghp_secret", delivery: { state: "blocked", sha: SHA } }),
      run("nothing", 1, { delivery: { state: "no_changes" } }),
    ];
    const exported = exportRuns(runs);
    expect(exported).toEqual({
      version: 1, rejected: 1,
      records: [{ id: "done", verdict: "PASS", sha: SHA }, { id: "failed", verdict: "FAIL", sha: SHA }],
    });
    const text = JSON.stringify(exported);
    for (const secret of ["prompt-of-", "result-of-", "/work/repo", "ghp_secret", "github.com"]) expect(text).not.toContain(secret);
  });
});

describe("delete all local state", () => {
  let dir: string;
  const store = () => new VersionedStore({ dir, name: "runs", version: 1, schema: runsState, defaults: () => ({ runs: [] }) });
  const files = async () => (await readdir(dir)).sort();
  const state = (runs: RunRecord[]): Promise<void> => store().save({ runs } as RunsState);

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "zelqio-delete-"));
  });
  afterEach(() => rm(dir, { recursive: true, force: true }));

  it("recognizes only the plugin's state files, with their backups, temporary and corrupt copies", () => {
    for (const name of ["runs.json", "runs.json.bak", "runs.json.restore", "runs.json.tmp-1-2-3", "runs.json.bak.tmp-1-2-3", "runs.json.corrupt-123",
      "attempts.json", "git-operation-intents.json.bak", "git-delivery-plans.json", "routing-decisions.json", "approval-requests.json", "coordination-lease.json"]) {
      expect(isStateFile(name), name).toBe(true);
    }
    for (const name of ["git-projects.json", "runs.jsonx", "runs.txt", "notes.json", "myruns.json", "attempts", "runs.json.other"]) {
      expect(isStateFile(name), name).toBe(false);
    }
  });

  it("refuses while any run is active, and deletes nothing", async () => {
    const attempts = new AttemptJournal(dir);
    await state([run("old", 90), run("live", 1, { status: "running", result: null })]);
    const before = await files();
    await expect(deleteLocalState({ directory: dir, store: store(), attempts })).rejects.toMatchObject({ code: "disabled" });
    expect(await files()).toEqual(before);
    expect((await store().load()).data.runs).toHaveLength(2);
  });

  it("refuses while a delivery is pending or an attempt is unsettled", async () => {
    const attempts = new AttemptJournal(dir);
    await state([run("a", 90, { delivery: { state: "pending" } })]);
    await expect(deleteLocalState({ directory: dir, store: store(), attempts })).rejects.toMatchObject({ code: "disabled" });
    await state([run("b", 90)]);
    await attempts.reserve({ key: "b-a1", task: "b", attempt: 1, maxConcurrent: 5 });
    await expect(deleteLocalState({ directory: dir, store: store(), attempts })).rejects.toMatchObject({ code: "disabled" });
  });

  it("deletes the runs, attempts, backups and corrupt copies, and keeps the user's own files", async () => {
    const attempts = new AttemptJournal(dir);
    await state([run("a", 90)]);
    await state([run("b", 90)]);
    await attempts.reserve({ key: "b-a1", task: "b", attempt: 1, maxConcurrent: 5 });
    await attempts.confirmLaunch({ key: "b-a1", agentRef: "agent-1" });
    await attempts.settle({ key: "b-a1", outcome: "succeeded", evidenceRef: "agent-idle" });
    await writeFile(join(dir, "runs.json.corrupt-1"), "prompt-of-a", "utf8");
    await writeFile(join(dir, "git-projects.json"), "{}", "utf8");
    await writeFile(join(dir, "notes.txt"), "mine", "utf8");
    await mkdir(join(dir, "runs.json.tmp-dir"));

    const result = await deleteLocalState({ directory: dir, store: store(), attempts });
    expect(result.deletedFiles).toBeGreaterThanOrEqual(4);
    expect(await files()).toEqual(["git-projects.json", "notes.txt", "runs.json.tmp-dir"]);
    expect(await deleteLocalState({ directory: dir, store: store(), attempts })).toEqual({ deletedFiles: 0 });
    expect((await store().load()).data.runs).toEqual([]);
  });
});

describe("privacy of the local state", () => {
  const roots = ["index.server.ts", "index.client.tsx", "server", "shared", "client"];
  const base = join(__dirname, "..");
  const sources = async () => {
    const out: Array<{ file: string; text: string }> = [];
    const walk = async (path: string) => {
      const entries = await readdir(path, { withFileTypes: true }).catch(() => null);
      if (!entries) {
        if (/\.(ts|tsx)$/.test(path)) out.push({ file: relative(base, path).split("\\").join("/"), text: await readFile(path, "utf8") });
        return;
      }
      for (const entry of entries) await walk(join(path, entry.name));
    };
    for (const root of roots) await walk(join(base, root));
    return out;
  };
  const name = (file: string) => file;

  it("has no code that talks to the network, other than Git and the user's own remote delivery", async () => {
    const forbidden = /node:(?:http2?|https|net|dgram|tls|dns|worker_threads|cluster)\b|\bXMLHttpRequest\b|\bWebSocket\b|\bEventSource\b|sendBeacon|\bnew\s+Request\(|globalThis\.fetch|\bfetch\(\s*["'`h]/;
    const offenders = (await sources()).filter(item => forbidden.test(item.text)).map(item => name(item.file));
    expect(offenders).toEqual([]);
  });

  it("starts processes only to run Git and to keep the computer awake", async () => {
    const users = (await sources()).filter(item => /node:child_process/.test(item.text)).map(item => name(item.file)).sort();
    expect(users).toEqual(["server/git-runner.ts", "server/power-manager.ts"]);
  });

  it("writes files only in the store and in the retention module, which deletes inside the state directory", async () => {
    const WRITES = new Set(["writeFile", "appendFile", "createWriteStream", "copyFile", "rename", "mkdir", "rm", "unlink", "open", "truncate", "cp"]);
    const writers = (await sources()).filter(item => {
      const imported = [...item.text.matchAll(/import\s*\{([^}]*)\}\s*from\s*"node:fs(?:\/promises)?"/g)].flatMap(match => match[1].split(",").map(part => part.trim().split(/\s+as\s+/)[0]));
      return imported.some(entry => WRITES.has(entry)) || /import\s+\*\s+as\s+\w+\s+from\s*"node:fs/.test(item.text);
    }).map(item => name(item.file)).sort();
    expect(writers).toEqual(["server/retention.ts", "server/store.ts"]);
  });

  it("has no telemetry or analytics, except the sentence that says there is none", async () => {
    const mentions = (await sources()).filter(item => /telemetry|analytics|tracking/i.test(item.text)).map(item => name(item.file));
    expect(mentions).toEqual(["client/resources.ts"]);
  });

  it("sends nothing out while a run is delivered, and keeps the prompt and the result only in the state directory", async () => {
    const dir = await mkdtemp(join(tmpdir(), "zelqio-privacy-"));
    const stray = await mkdtemp(join(tmpdir(), "zelqio-stray-"));
    const outbound = vi.fn(() => { throw new Error("network used"); });
    vi.stubGlobal("fetch", outbound);
    try {
      const catalog: ProviderCatalogData = {
        generatedAt: "2026-11-27T12:00:00.000Z",
        providers: [{ id: "alpha", label: "alpha", status: "ready", enabled: true, source: "builtin", modes: [], models: [{ id: "m", label: "m", isDefault: true, selectable: true, thinkingOptions: [] }] }],
      };
      let status: AgentSnapshot["status"] = "running";
      const port: AgentPort = {
        async create(input: CreateAgentInput) { return { id: `a-${input.key}` }; },
        async snapshot(id) { return { id, status, lastError: null, pendingPermissions: 0, archived: false, restorable: false, lastUserMessageAt: null }; },
        async send() {}, async stop() {}, async lastReply() { return "RESULT-MARKER"; }, async recentActivity() { return ""; }, async firstUserMessage() { return null; },
      };
      const manager = new RunManager({
        port, store: new VersionedStore({ dir, name: "runs", version: 1, schema: runsState, defaults: () => ({ runs: [] }) }),
        attempts: new AttemptJournal(dir), readCatalog: async () => catalog, readUsage: async () => null,
        readSettings: async () => ({ ...defaultSettings(), providers: { alpha: { use: "primary", funding: "subscription" } } }),
      });
      await manager.submit({ prompt: "PROMPT-MARKER", cwd: "/work/repo" });
      status = "idle";
      await manager.tick();
      expect((await manager.list())[0]).toMatchObject({ status: "delivered", result: "RESULT-MARKER" });
      expect(outbound).not.toHaveBeenCalled();
      const stored = (await readdir(dir)).map(file => join(dir, file));
      const texts = await Promise.all(stored.map(file => readFile(file, "utf8")));
      expect(texts.some(text => text.includes("PROMPT-MARKER"))).toBe(true);
      expect(texts.some(text => text.includes("RESULT-MARKER"))).toBe(true);
      expect(await readdir(stray)).toEqual([]);
    } finally {
      vi.unstubAllGlobals();
      await rm(dir, { recursive: true, force: true });
      await rm(stray, { recursive: true, force: true });
    }
  });
});

describe("error messages redact credentials before they are stored", () => {
  const TOKEN = "ghp_abcdefghijklmnopqrstuvwxyz0123456789";
  const KEY = "sk-abcdefghijklmnopqrstuvwxyz123456";
  let dir: string;
  let failure: { create?: string; agent?: string };
  let status: AgentSnapshot["status"];
  let manager: RunManager;
  const catalog: ProviderCatalogData = {
    generatedAt: "2026-11-27T12:00:00.000Z",
    providers: [{ id: "alpha", label: "alpha", status: "ready", enabled: true, source: "builtin", modes: [], models: [{ id: "m", label: "m", isDefault: true, selectable: true, thinkingOptions: [] }] }],
  };

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "zelqio-redact-"));
    failure = {};
    status = "running";
    const port: AgentPort = {
      async create() { if (failure.create) throw new Error(failure.create); return { id: "agent-1" }; },
      async snapshot(id): Promise<AgentSnapshot> {
        return { id, status, lastError: status === "error" ? (failure.agent ?? null) : null, pendingPermissions: 0, archived: false, restorable: false, lastUserMessageAt: null };
      },
      async send() {}, async stop() {}, async lastReply() { return null; }, async recentActivity() { return ""; }, async firstUserMessage() { return null; },
    };
    manager = new RunManager({
      port, store: new VersionedStore({ dir, name: "runs", version: 1, schema: runsState, defaults: () => ({ runs: [] }) }),
      attempts: new AttemptJournal(dir), readCatalog: async () => catalog, readUsage: async () => null,
      readSettings: async () => ({ ...defaultSettings(), providers: { alpha: { use: "primary", funding: "subscription" } } }),
    });
  });
  afterEach(() => rm(dir, { recursive: true, force: true }));

  it("a failure to create the agent", async () => {
    failure.create = `request failed with token ${KEY} and Authorization: Bearer ${TOKEN}`;
    const created = await manager.submit({ prompt: "Do it", cwd: "/work/repo" });
    expect(created.status).toBe("failed");
    expect(created.error).not.toContain(KEY);
    expect(created.error).not.toContain(TOKEN);
    expect(created.error).toContain("[redacted]");
    expect(await readFile(join(dir, "runs.json"), "utf8")).not.toContain(KEY);
  });

  it("an error reported by the agent, which is stored once and not processed twice", async () => {
    await manager.submit({ prompt: "Do it", cwd: "/work/repo" });
    status = "error";
    failure.agent = `boom: api_key=${KEY} and ${TOKEN}`;
    await manager.tick();
    const [failed] = await manager.list();
    expect(failed.status).toBe("failed");
    for (const field of [failed.error, failed.handledError, JSON.stringify(failed.history)]) {
      expect(field).not.toContain(KEY);
      expect(field).not.toContain(TOKEN);
    }
    expect(failed.error).toContain("[redacted]");
    const text = await readFile(join(dir, "runs.json"), "utf8");
    expect(text).not.toContain(KEY);
    expect(text).not.toContain(TOKEN);
    await manager.tick();
    expect((await manager.list())[0].history.filter(entry => entry.kind === "failed")).toHaveLength(1);
  });
});
