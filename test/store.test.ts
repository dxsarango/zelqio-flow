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
        expect(["ok", "recovered_from_backup"]).toContain(result.status);
        expect((await files()).filter((f) => f.includes("tmp"))).toEqual([]);
      });
    }
  });
});
