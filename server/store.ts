import { copyFile, mkdir, open, readFile, readdir, rename, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { ZodType } from "zod";
import { ZelqioError } from "../shared/errors";

/** File operations the store needs; injectable so tests can fail any step. */
export interface FsOps {
  mkdir(path: string): Promise<void>;
  /** Resolves null when the file does not exist. */
  readFile(path: string): Promise<string | null>;
  /** Writes and flushes to disk before resolving. */
  writeFileSynced(path: string, data: string): Promise<void>;
  copyFile(from: string, to: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  rm(path: string): Promise<void>;
  readdir(path: string): Promise<string[]>;
}

export const nodeFs: FsOps = {
  async mkdir(path) {
    await mkdir(path, { recursive: true });
  },
  async readFile(path) {
    try {
      return await readFile(path, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  },
  async writeFileSynced(path, data) {
    const handle = await open(path, "w");
    try {
      await handle.writeFile(data, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
  },
  copyFile: (from, to) => copyFile(from, to),
  rename: (from, to) => rename(from, to),
  async rm(path) {
    await rm(path, { force: true });
  },
  readdir: (path) => readdir(path),
};

export interface Migration {
  /** Version this step upgrades from; it produces `from + 1`. */
  from: number;
  migrate(data: unknown): unknown;
}

export interface StoreOptions<T> {
  dir: string;
  /** File stem, e.g. "settings" -> settings.json. */
  name: string;
  /** Current schema version of the data. */
  version: number;
  schema: ZodType<T>;
  defaults(): T;
  migrations?: Migration[];
  fs?: FsOps;
  now?: () => number;
  /** How many preserved corrupt copies to keep, at least 1 (the oldest are removed). */
  keepCorrupt?: number;
}

export type LoadStatus =
  | "ok" // read and valid
  | "created" // nothing on disk; defaults returned, nothing written yet
  | "migrated" // older version upgraded in memory; call save() to persist
  | "recovered_from_backup" // main was corrupt; the backup was valid and restored
  | "reset_to_defaults" // main (and backup) unusable; corrupt copy preserved; defaults returned
  | "unsupported_version"; // written by a newer version; defaults in memory, writes refused

export interface LoadResult<T> {
  data: T;
  status: LoadStatus;
  /** File name of the preserved corrupt copy, when one was made. */
  preserved?: string;
}

interface Envelope {
  schemaVersion: number;
  data: unknown;
}

function parseEnvelope(text: string): Envelope | null {
  try {
    const value: unknown = JSON.parse(text);
    if (typeof value !== "object" || value === null) return null;
    const { schemaVersion, data } = value as Record<string, unknown>;
    if (typeof schemaVersion !== "number" || !Number.isInteger(schemaVersion) || schemaVersion < 1 || data === undefined) return null;
    return { schemaVersion, data };
  } catch {
    return null;
  }
}

/** One operation queue per file in this process, so separate instances of the same store never interleave steps. */
const queues = new Map<string, Promise<unknown>>();
let unique = 0;

/**
 * Versioned JSON document with atomic replace, a one-step backup and corruption recovery.
 *
 * Save order: (check/recover on first use) -> write temp + flush -> copy a VALID current to backup (via temp + rename)
 * -> rename temp over current. A failure at any step leaves the previous document readable (main or backup).
 * Scope: one process. Cross-process locking, power loss during flush and cleanup of temp files left by a hard kill
 * are NOT covered (stale `.tmp-*` files are harmless and ignored).
 */
export class VersionedStore<T> {
  private readonly fs: FsOps;
  private readonly now: () => number;
  private writable = true;
  /** True once the file on disk was inspected by this instance (load or first save). */
  private checked = false;

  constructor(private readonly options: StoreOptions<T>) {
    this.fs = options.fs ?? nodeFs;
    this.now = options.now ?? Date.now;
  }

  private path(suffix = "") {
    return join(this.options.dir, `${this.options.name}.json${suffix}`);
  }

  private enqueue<R>(task: () => Promise<R>): Promise<R> {
    // Case-insensitive key: on Windows and macOS two spellings of a directory name the same physical file.
    const key = resolve(this.path()).toLowerCase();
    const tail = queues.get(key) ?? Promise.resolve();
    const run = tail.then(task, task);
    const settled = run.then(
      () => undefined,
      () => undefined,
    );
    queues.set(key, settled);
    void settled.then(() => {
      if (queues.get(key) === settled) queues.delete(key);
    });
    return run;
  }

  private decode(text: string | null): { data: T; migrated: boolean } | "newer" | null {
    if (text === null) return null;
    const envelope = parseEnvelope(text);
    if (!envelope) return null;
    if (envelope.schemaVersion > this.options.version) return "newer";
    let data = envelope.data;
    let version = envelope.schemaVersion;
    try {
      while (version < this.options.version) {
        const step = this.options.migrations?.find((m) => m.from === version);
        if (!step) return "newer"; // no safe path to the current version: treat like newer data and leave it untouched
        data = step.migrate(data);
        version += 1;
      }
    } catch {
      return null;
    }
    const parsed = this.options.schema.safeParse(data);
    return parsed.success ? { data: parsed.data, migrated: envelope.schemaVersion !== this.options.version } : null;
  }

  load(): Promise<LoadResult<T>> {
    return this.enqueue(() => this.loadNow());
  }

  private async loadNow(): Promise<LoadResult<T>> {
    await this.fs.mkdir(this.options.dir);
    this.checked = true;
    this.writable = true;
    const mainText = await this.fs.readFile(this.path());
    const main = this.decode(mainText);
    if (main === "newer") {
      this.writable = false;
      return { data: this.options.defaults(), status: "unsupported_version" };
    }
    if (main) return { data: main.data, status: main.migrated ? "migrated" : "ok" };

    const backupText = await this.fs.readFile(this.path(".bak"));
    const backup = this.decode(backupText);
    if (backup === "newer") {
      this.writable = false;
      return { data: this.options.defaults(), status: "unsupported_version" };
    }
    let preserved: string | undefined;
    if (mainText !== null) preserved = await this.preserveCorrupt("");
    if (backup) {
      await this.fs.copyFile(this.path(".bak"), this.path(".restore"));
      await this.fs.rename(this.path(".restore"), this.path());
      return { data: backup.data, status: "recovered_from_backup", preserved };
    }
    if (backupText !== null) preserved = (await this.preserveCorrupt(".bak")) ?? preserved;
    if (mainText === null && backupText === null) return { data: this.options.defaults(), status: "created" };
    return { data: this.options.defaults(), status: "reset_to_defaults", preserved };
  }

  /** Renames an unusable main (or backup) aside, keeping a bounded number of copies. Returns its new name if kept. */
  private async preserveCorrupt(source: "" | ".bak"): Promise<string | undefined> {
    const prefix = `${this.options.name}.json.corrupt-`;
    let name = `${prefix}${this.now()}${source}`;
    if ((await this.fs.readFile(join(this.options.dir, name))) !== null) name = `${prefix}${this.now()}-${++unique}${source}`;
    await this.fs.rename(this.path(source), join(this.options.dir, name));
    const stamp = (file: string) => Number(file.slice(prefix.length).match(/^\d+/)?.[0] ?? 0);
    const all = (await this.fs.readdir(this.options.dir))
      .filter((f) => f.startsWith(prefix))
      .sort((a, b) => stamp(a) - stamp(b) || a.localeCompare(b));
    const keep = Math.max(1, this.options.keepCorrupt ?? 3); // never delete the copy just preserved
    const removed = all.slice(0, Math.max(0, all.length - keep));
    for (const old of removed) await this.fs.rm(join(this.options.dir, old));
    return removed.includes(name) ? undefined : name;
  }

  /**
   * Removes leftover temp files from a hard kill. OFFLINE ONLY: the caller must guarantee that no process is writing
   * this file and none will start meanwhile (`quiescent: true`). Age and process ids cannot prove a writer is dead,
   * so nothing is removed automatically. Only regular files with this store's exact temp names are touched.
   */
  cleanTemps(options: { quiescent: true }): Promise<string[]> {
    if (options.quiescent !== true) return Promise.reject(new ZelqioError("invalid_input", "Cleanup requires exclusive access."));
    return this.enqueue(async () => {
      const stem = `${this.options.name}.json`;
      const pattern = new RegExp(`^${stem.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\.(tmp|bak\\.tmp)-\\d+-\\d+-\\d+$`);
      const removed: string[] = [];
      for (const file of await this.fs.readdir(this.options.dir)) {
        if (!pattern.test(file)) continue;
        try {
          await this.fs.rm(join(this.options.dir, file)); // non-recursive: a directory with this name is left alone
          removed.push(file);
        } catch {
          // Not removable (directory, in use): leave it.
        }
      }
      return removed.sort();
    });
  }

  save(data: T): Promise<void> {
    return this.enqueue(() => this.saveNow(data));
  }

  private async saveNow(data: T): Promise<void> {
    const parsed = this.options.schema.safeParse(data);
    if (!parsed.success) throw new ZelqioError("invalid_input", "The data does not match the schema.");
    // Never write before the file on disk was inspected: it may come from a newer version or be corrupt.
    if (!this.checked) await this.loadNow();
    if (!this.writable) throw new ZelqioError("disabled", "Stored data was written by a newer version; saving is disabled.");
    await this.fs.mkdir(this.options.dir);
    const id = `${process.pid}-${++unique}-${this.now()}`;
    const tmp = this.path(`.tmp-${id}`);
    const bakTmp = this.path(`.bak.tmp-${id}`);
    const body = JSON.stringify({ schemaVersion: this.options.version, data: parsed.data }, null, 2);
    try {
      await this.fs.writeFileSynced(tmp, body);
      const currentText = await this.fs.readFile(this.path());
      if (currentText !== null) {
        const current = this.decode(currentText);
        if (current === "newer") {
          this.writable = false;
          throw new ZelqioError("disabled", "Stored data was written by a newer version; saving is disabled.");
        }
        if (current) {
          // Never rotate over a backup this version cannot read: it may hold the only copy of newer data.
          if (this.decode(await this.fs.readFile(this.path(".bak"))) !== "newer") {
            await this.fs.copyFile(this.path(), bakTmp);
            await this.fs.rename(bakTmp, this.path(".bak"));
          }
        } else {
          // The current file became unusable after it was checked: keep it aside and leave the valid backup alone.
          await this.preserveCorrupt("");
        }
      }
      await this.fs.rename(tmp, this.path());
    } catch (error) {
      await this.fs.rm(tmp).catch(() => undefined);
      await this.fs.rm(bakTmp).catch(() => undefined);
      throw error;
    }
  }
}
