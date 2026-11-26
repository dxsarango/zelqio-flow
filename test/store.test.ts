import { existsSync } from "node:fs";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { nodeFs, VersionedStore, type FsOps } from "../server/store";

const v1 = z.object({ name: z.string() });
const v2 = z.object({ name: z.string(), count: z.number() });
let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "zelqio-store-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const make = (overrides: Partial<ConstructorParameters<typeof VersionedStore<{ name: string; count: number }>>[0]> = {}) =>
  new VersionedStore({
    dir,
    name: "settings",
    version: 2,
    schema: v2,
    defaults: () => ({ name: "default", count: 0 }),
    migrations: [{ from: 1, migrate: (d) => ({ ...v1.parse(d), count: 1 }) }],
    ...overrides,
  });
const files = async () => (await readdir(dir)).sort();

/** Fails the n-th call (1-based) of the named operation. */
function failing(op: keyof FsOps, n: number): FsOps {
  let calls = 0;
  const wrapped = { ...nodeFs } as Record<string, unknown>;
  wrapped[op] = (...args: unknown[]) => {
    calls += 1;
    if (calls === n) return Promise.reject(new Error(`injected ${op} #${n}`));
    return (nodeFs[op] as (...a: unknown[]) => unknown)(...args);
  };
  return wrapped as unknown as FsOps;
}

describe("VersionedStore", () => {
  it("returns defaults without writing when nothing exists", async () => {
    const result = await make().load();
    expect(result).toEqual({ data: { name: "default", count: 0 }, status: "created" });
    expect(await files()).toEqual([]);
  });

  it("round-trips data and keeps a backup of the previous version", async () => {
    const store = make();
    await store.save({ name: "a", count: 1 });
    await store.save({ name: "b", count: 2 });
    expect((await make().load()).data).toEqual({ name: "b", count: 2 });
    expect(JSON.parse(await readFile(join(dir, "settings.json.bak"), "utf8")).data).toEqual({ name: "a", count: 1 });
    expect(await files()).toEqual(["settings.json", "settings.json.bak"]);
  });

  it("migrates an older version and persists it on the next save", async () => {
    await writeFile(join(dir, "settings.json"), JSON.stringify({ schemaVersion: 1, data: { name: "old" } }));
    const store = make();
    const loaded = await store.load();
    expect(loaded).toEqual({ data: { name: "old", count: 1 }, status: "migrated" });
    await store.save(loaded.data);
    expect(JSON.parse(await readFile(join(dir, "settings.json"), "utf8")).schemaVersion).toBe(2);
  });

  it("recovers from the backup when the main file is corrupt and preserves the corrupt copy", async () => {
    const store = make({ now: () => 100 });
    await store.save({ name: "a", count: 1 });
    await store.save({ name: "b", count: 2 });
    await writeFile(join(dir, "settings.json"), "{ truncated");
    const result = await make({ now: () => 100 }).load();
    expect(result.status).toBe("recovered_from_backup");
    expect(result.data).toEqual({ name: "a", count: 1 });
    expect(result.preserved).toBe("settings.json.corrupt-100");
    expect(await readFile(join(dir, "settings.json.corrupt-100"), "utf8")).toBe("{ truncated");
    expect((await make().load()).status).toBe("ok");
  });

  it("resets to defaults, preserving the corrupt file, when no backup exists", async () => {
    await writeFile(join(dir, "settings.json"), JSON.stringify({ schemaVersion: 2, data: { name: 5 } }));
    const result = await make({ now: () => 7 }).load();
    expect(result.status).toBe("reset_to_defaults");
    expect(result.data).toEqual({ name: "default", count: 0 });
    expect(await files()).toEqual(["settings.json.corrupt-7"]);
  });

  it("restores from the backup when the main file is missing", async () => {
    const store = make();
    await store.save({ name: "a", count: 1 });
    await store.save({ name: "b", count: 2 });
    await rm(join(dir, "settings.json"));
    const result = await make().load();
    expect(result).toEqual({ data: { name: "a", count: 1 }, status: "recovered_from_backup", preserved: undefined });
  });

  it("refuses to overwrite data written by a newer version", async () => {
    const newer = JSON.stringify({ schemaVersion: 3, data: { future: true } });
    await writeFile(join(dir, "settings.json"), newer);
    const store = make();
    expect((await store.load()).status).toBe("unsupported_version");
    await expect(store.save({ name: "x", count: 1 })).rejects.toMatchObject({ code: "disabled" });
    expect(await readFile(join(dir, "settings.json"), "utf8")).toBe(newer);
  });

  it("rejects data that violates the schema without touching the file", async () => {
    const store = make();
    await store.save({ name: "a", count: 1 });
    await expect(store.save({ name: "a", count: "x" } as never)).rejects.toMatchObject({ code: "invalid_input" });
    expect((await make().load()).data).toEqual({ name: "a", count: 1 });
  });

  it("treats a failed migration as corruption and keeps the original bytes", async () => {
    const bad = JSON.stringify({ schemaVersion: 1, data: { name: 123 } });
    await writeFile(join(dir, "settings.json"), bad);
    const result = await make({ now: () => 9 }).load();
    expect(result.status).toBe("reset_to_defaults");
    expect(await readFile(join(dir, "settings.json.corrupt-9"), "utf8")).toBe(bad);
  });

  it("keeps only the newest corrupt copies", async () => {
    for (let t = 1; t <= 5; t += 1) {
      await writeFile(join(dir, "settings.json"), "garbage");
      await make({ now: () => t, keepCorrupt: 2 }).load();
    }
    expect((await files()).filter((f) => f.includes("corrupt"))).toEqual(["settings.json.corrupt-4", "settings.json.corrupt-5"]);
  });

  it("serializes concurrent saves; the last one wins and no temp files remain", async () => {
    const store = make();
    await Promise.all([1, 2, 3, 4, 5].map((n) => store.save({ name: `n${n}`, count: n })));
    expect((await make().load()).data).toEqual({ name: "n5", count: 5 });
    expect((await files()).filter((f) => f.includes("tmp"))).toEqual([]);
  });

  describe("failure injection during save", () => {
    const steps: Array<[string, keyof FsOps, number]> = [
      ["writing the temp file", "writeFileSynced", 1],
      ["copying the backup", "copyFile", 1],
      ["publishing the backup", "rename", 1],
      ["replacing the main file", "rename", 2],
    ];
    for (const [label, op, n] of steps) {
      it(`keeps the previous document readable when ${label} fails`, async () => {
        await make().save({ name: "a", count: 1 });
        const store = make({ fs: failing(op, n) });
        await expect(store.save({ name: "b", count: 2 })).rejects.toThrow(/injected/);
        const result = await make().load();
        expect(result.data).toEqual({ name: "a", count: 1 });
        expect(result.status).toBe("ok");
        expect((await files()).filter((f) => f.includes("tmp"))).toEqual([]);
      });
    }
  });
});

describe("VersionedStore review regressions", () => {
  const make2 = (overrides: Record<string, unknown> = {}) =>
    new VersionedStore({
      dir,
      name: "settings",
      version: 2,
      schema: v2,
      defaults: () => ({ name: "default", count: 0 }),
      ...overrides,
    });

  it("refuses to save over newer-version data even if load() was never called", async () => {
    const newer = JSON.stringify({ schemaVersion: 3, data: { future: true } });
    await writeFile(join(dir, "settings.json"), newer);
    await expect(make2().save({ name: "x", count: 1 })).rejects.toMatchObject({ code: "disabled" });
    expect(await readFile(join(dir, "settings.json"), "utf8")).toBe(newer);
    expect(await files()).toEqual(["settings.json"]);
  });

  it("save() without load() restores from the backup instead of overwriting it with a corrupt main", async () => {
    await make2().save({ name: "a", count: 1 });
    await make2().save({ name: "b", count: 2 });
    await writeFile(join(dir, "settings.json"), "{ truncated");
    await make2({ now: () => 50 }).save({ name: "c", count: 3 });
    expect((await make2().load()).data).toEqual({ name: "c", count: 3 });
    expect(JSON.parse(await readFile(join(dir, "settings.json.bak"), "utf8")).data).toEqual({ name: "a", count: 1 });
    expect(await readFile(join(dir, "settings.json.corrupt-50"), "utf8")).toBe("{ truncated");
  });

  it("does not replace the valid backup when main is corrupted after the store was checked", async () => {
    const store = make2({ now: () => 60 });
    await store.save({ name: "a", count: 1 });
    await store.save({ name: "b", count: 2 });
    await writeFile(join(dir, "settings.json"), "garbage");
    await store.save({ name: "c", count: 3 });
    expect(JSON.parse(await readFile(join(dir, "settings.json.bak"), "utf8")).data).toEqual({ name: "a", count: 1 });
  });

  it("serializes two instances of the same file and leaves a valid document", async () => {
    const a = make2();
    const b = make2();
    await Promise.all([1, 2, 3, 4].flatMap((n) => [a.save({ name: `a${n}`, count: n }), b.save({ name: `b${n}`, count: n })]));
    const result = await make2().load();
    expect(result.status).toBe("ok");
    expect((await files()).filter((f) => f.includes("tmp"))).toEqual([]);
  });

  it("preserves a corrupt backup too and then reports created consistently", async () => {
    await writeFile(join(dir, "settings.json"), "bad");
    await writeFile(join(dir, "settings.json.bak"), "also bad");
    const first = await make2({ now: () => 5 }).load();
    expect(first.status).toBe("reset_to_defaults");
    expect(await files()).toEqual(["settings.json.corrupt-5", "settings.json.corrupt-5.bak"]);
    expect((await make2().load()).status).toBe("created");
  });

  it("prunes corrupt copies by numeric timestamp and never deletes the copy it just made", async () => {
    for (const t of [9, 10, 11]) {
      await writeFile(join(dir, "settings.json"), "garbage");
      await make2({ now: () => t, keepCorrupt: 2 }).load();
    }
    expect((await files()).filter((f) => f.includes("corrupt"))).toEqual(["settings.json.corrupt-10", "settings.json.corrupt-11"]);
    await writeFile(join(dir, "settings.json"), "garbage");
    const zero = await make2({ now: () => 12, keepCorrupt: 0 }).load();
    expect(zero.preserved).toBe("settings.json.corrupt-12"); // keepCorrupt: 0 still keeps the copy just preserved
    expect((await files()).filter((f) => f.includes("corrupt"))).toEqual(["settings.json.corrupt-12"]);
  });

  it("does not overwrite an older corrupt copy that has the same name", async () => {
    await writeFile(join(dir, "settings.json"), "first");
    await make2({ now: () => 3 }).load();
    await writeFile(join(dir, "settings.json"), "second");
    await make2({ now: () => 3 }).load();
    const copies = (await files()).filter((f) => f.includes("corrupt"));
    expect(copies).toHaveLength(2);
    const contents = await Promise.all(copies.map((f) => readFile(join(dir, f), "utf8")));
    expect(contents.sort()).toEqual(["first", "second"]);
  });
});

describe("independent review findings (S01-T07)", () => {
  const make3 = (overrides: Record<string, unknown> = {}) =>
    new VersionedStore({ dir, name: "settings", version: 2, schema: v2, defaults: () => ({ name: "default", count: 0 }), ...overrides });
  const doc = (schemaVersion: number, data: unknown) => JSON.stringify({ schemaVersion, data });

  it("never rotates over a newer-version backup", async () => {
    const newerBak = doc(3, { future: true });
    await writeFile(join(dir, "settings.json"), doc(2, { name: "a", count: 1 }));
    await writeFile(join(dir, "settings.json.bak"), newerBak);
    const store = make3();
    expect((await store.load()).status).toBe("ok");
    await store.save({ name: "b", count: 2 });
    await store.save({ name: "c", count: 3 });
    expect(await readFile(join(dir, "settings.json.bak"), "utf8")).toBe(newerBak);
    expect((await make3().load()).data).toEqual({ name: "c", count: 3 });
  });

  it("treats valid older data without a migration path as unsupported and leaves it untouched", async () => {
    const old = doc(1, { name: "old" });
    await writeFile(join(dir, "settings.json"), old);
    const store = make3({ keepCorrupt: 0 });
    expect((await store.load()).status).toBe("unsupported_version");
    await expect(store.save({ name: "x", count: 1 })).rejects.toMatchObject({ code: "disabled" });
    expect(await readFile(join(dir, "settings.json"), "utf8")).toBe(old);
    expect(await files()).toEqual(["settings.json"]);
  });

  it("does not lose the only copy when a save fails right after a missing-migration load", async () => {
    const old = doc(1, { name: "old" });
    await writeFile(join(dir, "settings.json"), old);
    await expect(make3({ fs: failing("writeFileSynced", 1) }).save({ name: "x", count: 1 })).rejects.toBeDefined();
    expect(await readFile(join(dir, "settings.json"), "utf8")).toBe(old);
  });

  it("serializes writers that spell the directory differently (case-insensitive key)", async (ctx) => {
    const alias = dir.toUpperCase() === dir ? dir.toLowerCase() : dir.toUpperCase();
    if (!existsSync(alias)) return ctx.skip(); // case-sensitive filesystem: the two spellings are different directories
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const order: string[] = [];
    const gated = (label: string, wait: boolean): FsOps => ({
      ...nodeFs,
      async writeFileSynced(path, data) {
        order.push(label + ":start");
        if (wait) await gate;
        await nodeFs.writeFileSynced(path, data);
        order.push(label + ":end");
      },
    });
    const a = make3({ fs: gated("a", true) });
    const b = make3({ dir: alias, fs: gated("b", false) });
    const first = a.save({ name: "a", count: 1 });
    await new Promise((r) => setTimeout(r, 30));
    const second = b.save({ name: "b", count: 2 });
    await new Promise((r) => setTimeout(r, 30));
    expect(order).toEqual(["a:start"]); // b must wait for a, even through another spelling of the path
    release();
    await Promise.all([first, second]);
    expect(order).toEqual(["a:start", "a:end", "b:start", "b:end"]);
    expect((await make3().load()).data).toEqual({ name: "b", count: 2 });
  });

  it("makes the same-instance two-writer test observe real serialization", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const order: string[] = [];
    const slow: FsOps = {
      ...nodeFs,
      async writeFileSynced(path, data) {
        order.push("write");
        await gate;
        await nodeFs.writeFileSynced(path, data);
      },
    };
    const a = make3({ fs: slow });
    const b = make3({ fs: { ...nodeFs, async writeFileSynced(p: string, d: string) { order.push("b-write"); await nodeFs.writeFileSynced(p, d); } } });
    const p1 = a.save({ name: "a", count: 1 });
    await new Promise((r) => setTimeout(r, 30));
    const p2 = b.save({ name: "b", count: 2 });
    await new Promise((r) => setTimeout(r, 30));
    expect(order).toEqual(["write"]);
    release();
    await Promise.all([p1, p2]);
    expect(order).toEqual(["write", "b-write"]);
  });
});

describe("offline temp cleanup (S01-T07 decision)", () => {
  it("removes only this store's exact temp names and leaves everything else", async () => {
    const { mkdir } = await import("node:fs/promises");
    const store = new VersionedStore({ dir, name: "settings", version: 2, schema: v2, defaults: () => ({ name: "d", count: 0 }) });
    await store.save({ name: "a", count: 1 });
    await store.save({ name: "b", count: 2 });
    const stale = ["settings.json.tmp-123-1-1700000000000", "settings.json.bak.tmp-123-1-1700000000000"];
    const keep = ["other.json.tmp-1-1-1", "settings.json.tmp-abc", "settings.json.tmp-1-1-1.keep", "notes.txt"];
    for (const f of [...stale, ...keep]) await writeFile(join(dir, f), "x");
    await mkdir(join(dir, "settings.json.tmp-9-9-9"));
    const removed = await store.cleanTemps({ quiescent: true });
    expect(removed).toEqual([...stale].sort());
    expect(await files()).toEqual(["notes.txt", "other.json.tmp-1-1-1", "settings.json", "settings.json.bak", "settings.json.tmp-1-1-1.keep", "settings.json.tmp-9-9-9", "settings.json.tmp-abc"]);
    expect((await store.load()).data).toEqual({ name: "b", count: 2 });
  });

  it("refuses to run without the exclusive-access acknowledgement", async () => {
    const store = new VersionedStore({ dir, name: "settings", version: 2, schema: v2, defaults: () => ({ name: "d", count: 0 }) });
    await expect(store.cleanTemps({} as never)).rejects.toMatchObject({ code: "invalid_input" });
  });
});
