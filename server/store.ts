import { copyFile, mkdir, open, readFile, readdir, rename, rm } from "node:fs/promises";
import { join } from "node:path";
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
  /** How many preserved corrupt copies to keep (the oldest are removed). */
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

/**
 * Versioned JSON document with atomic replace, a one-step backup and corruption recovery.
 *
 * Save order: write temp + flush -> copy current to backup (via temp + rename) -> rename temp over current.
 * A failure at any step leaves the previous document readable (main or backup).
 * Scope: one process. Cross-process locking and power loss during flush on every filesystem are NOT covered.
 */
export class VersionedStore<T> {
  private readonly fs: FsOps;
  private readonly now: () => number;
  private writable = true;
  private queue: Promise<unknown> = Promise.resolve();
  private counter = 0;

  constructor(private readonly options: StoreOptions<T>) {
    this.fs = options.fs ?? nodeFs;
    this.now = options.now ?? Date.now;
  }

  private path(suffix = "") {
    return join(this.options.dir, `${this.options.name}.json${suffix}`);
  }

  /** Serializes operations in this process so two saves never interleave their steps. */
  private enqueue<R>(task: () => Promise<R>): Promise<R> {
    const run = this.queue.then(task, task);
    this.queue = run.catch(() => undefined);
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
        if (!step) return null;
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
    this.writable = true;
    const mainText = await this.fs.readFile(this.path());
    const main = this.decode(mainText);
    if (main === "newer") {
      this.writable = false;
      return { data: this.options.defaults(), status: "unsupported_version" };
    }
    if (main) return { data: main.data, status: main.migrated ? "migrated" : "ok" };

    const backup = this.decode(await this.fs.readFile(this.path(".bak")));
    let preserved: string | undefined;
    if (mainText !== null) preserved = await this.preserveCorrupt();

    if (backup === "newer") {
      this.writable = false;
      return { data: this.options.defaults(), status: "unsupported_version", preserved };
    }
    if (backup) {
      await this.fs.copyFile(this.path(".bak"), this.path(".restore"));
      await this.fs.rename(this.path(".restore"), this.path());
      return { data: backup.data, status: "recovered_from_backup", preserved };
    }
    if (mainText === null && backup === null) return { data: this.options.defaults(), status: "created" };
    return { data: this.options.defaults(), status: "reset_to_defaults", preserved };
  }

  private async preserveCorrupt(): Promise<string> {
    const name = `${this.options.name}.json.corrupt-${this.now()}`;
    await this.fs.rename(this.path(), join(this.options.dir, name));
    const prefix = `${this.options.name}.json.corrupt-`;
    const keep = this.options.keepCorrupt ?? 3;
    const all = (await this.fs.readdir(this.options.dir)).filter((f) => f.startsWith(prefix)).sort();
    for (const old of all.slice(0, Math.max(0, all.length - keep))) await this.fs.rm(join(this.options.dir, old));
    return name;
  }

  save(data: T): Promise<void> {
    return this.enqueue(() => this.saveNow(data));
  }

  private async saveNow(data: T): Promise<void> {
    if (!this.writable) throw new ZelqioError("disabled", "Stored data was written by a newer version; saving is disabled.");
    const parsed = this.options.schema.safeParse(data);
    if (!parsed.success) throw new ZelqioError("invalid_input", "The data does not match the schema.");
    await this.fs.mkdir(this.options.dir);
    const tmp = this.path(`.tmp-${this.now()}-${++this.counter}`);
    const body = JSON.stringify({ schemaVersion: this.options.version, data: parsed.data }, null, 2);
    try {
      await this.fs.writeFileSynced(tmp, body);
      if ((await this.fs.readFile(this.path())) !== null) {
        const bakTmp = this.path(".bak.tmp");
        await this.fs.copyFile(this.path(), bakTmp);
        await this.fs.rename(bakTmp, this.path(".bak"));
      }
      await this.fs.rename(tmp, this.path());
    } catch (error) {
      await this.fs.rm(tmp).catch(() => undefined);
      await this.fs.rm(this.path(".bak.tmp")).catch(() => undefined);
      throw error;
    }
  }
}
