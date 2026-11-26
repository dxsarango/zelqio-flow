// Disposable POC (G0 approval persistence). Daemon side: file-backed approval store, fail closed.
// Persistence only. Nothing here authenticates a person: `identity.provenance` is always "none".
import type { PluginServerContext } from "@getpaseo/plugin/server";
import { execCommand } from "@getpaseo/plugin/server";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { consumeRpc, decideRpc, listRpc, requestRpc } from "./shared/contract";

type Status = "pending" | "approved" | "changes_requested" | "consumed" | "stale" | "invalid";
type Rec = {
  id: string; taskId: string; action: string; projectId: string; workspaceId: string; sha: string; policyVersion: string;
  status: Status; reason?: string; createdAt: number; decidedAt?: number; consumedAt?: number;
  identity: { provenance: "none" }; integrity: string;
};
type Store = { version: 1; approvals: Record<string, Rec> };

const policy = () => process.env.ZQ_G0_POLICY_VERSION || "policy-v1";
const storePath = () => {
  const p = process.env.ZQ_G0_APPROVAL_STORE;
  if (!p) throw new Error("approval store not configured: failing closed");
  return p;
};
const digest = (r: Rec) =>
  createHash("sha256").update(JSON.stringify([r.id, r.taskId, r.action, r.projectId, r.workspaceId, r.sha, r.policyVersion, r.status, r.decidedAt ?? null, r.consumedAt ?? null])).digest("hex");
const seal = (r: Rec) => { r.integrity = digest(r); return r; };

let queue: Promise<unknown> = Promise.resolve();
const serial = <T>(work: () => Promise<T>): Promise<T> => { const p = queue.then(work); queue = p.catch(() => undefined); return p; };

async function load(): Promise<Store> {
  try {
    const parsed = JSON.parse(await readFile(storePath(), "utf8"));
    if (parsed?.version !== 1 || typeof parsed.approvals !== "object" || parsed.approvals === null) throw new Error("bad store shape");
    return parsed as Store;
  } catch (e: any) {
    if (e?.code === "ENOENT") return { version: 1, approvals: {} };
    throw new Error("approval store unreadable: failing closed");
  }
}
async function save(s: Store) {
  const target = storePath();
  await mkdir(path.dirname(target), { recursive: true });
  const tmp = `${target}.${randomUUID()}.tmp`;
  try { await writeFile(tmp, JSON.stringify(s), { mode: 0o600 }); await rename(tmp, target); } finally { await rm(tmp, { force: true }); }
}

export default function contribute(server: PluginServerContext) {
  async function workspace(paseo: any, workspaceId: string) {
    const listed: any = await paseo.workspaces.list();
    const arr: any[] = Array.isArray(listed) ? listed : (listed?.workspaces ?? listed?.entries ?? []);
    const w = arr.find((x) => x.id === workspaceId || x.workspaceId === workspaceId);
    if (!w) throw new Error("unknown workspace");
    const sha = (await execCommand("git", ["rev-parse", "HEAD"], { cwd: w.workspaceDirectory, shell: false, timeout: 10000 })).stdout.trim();
    return { projectId: String(w.projectId ?? w.project?.id ?? "?"), sha };
  }

  /** Re-evaluates a record against the live SHA/project/policy and the integrity seal. Returns true when it changed. */
  function evaluate(r: Rec, live: { projectId: string; sha: string }): boolean {
    if (r.status === "invalid" || r.status === "stale" || r.status === "consumed" || r.status === "changes_requested") {
      if (r.integrity !== digest(r)) { r.status = "invalid"; r.reason = "integrity"; return true; }
      return false;
    }
    if (r.integrity !== digest(r)) { r.status = "invalid"; r.reason = "integrity"; return true; }
    const why = r.sha !== live.sha ? "sha" : r.projectId !== live.projectId ? "project" : r.policyVersion !== policy() ? "policy" : null;
    if (why) { r.status = "stale"; r.reason = why; seal(r); return true; }
    return false;
  }
  const matches = (r: Rec, s: any) => r.taskId === s.taskId && r.action === s.action && r.workspaceId === s.workspaceId && r.sha === s.sha && r.policyVersion === s.policyVersion;
  const reject = (m: string): never => { throw new Error(m); };

  server.handle(requestRpc, ({ taskId, action, workspaceId }, { paseo }: any) => serial(async () => {
    const live = await workspace(paseo, workspaceId);
    const store = await load();
    let dirty = false;
    for (const r of Object.values(store.approvals)) {
      if (r.workspaceId === workspaceId) dirty = evaluate(r, live) || dirty;
    }
    const dup = Object.values(store.approvals).find((r) => (r.status === "pending" || r.status === "approved")
      && r.taskId === taskId && r.action === action && r.workspaceId === workspaceId && r.sha === live.sha && r.policyVersion === policy());
    if (dup) { if (dirty) await save(store); return { ...dup, duplicate: true }; }
    const rec = seal({ id: randomUUID(), taskId, action, projectId: live.projectId, workspaceId, sha: live.sha, policyVersion: policy(), status: "pending", createdAt: Date.now(), identity: { provenance: "none" }, integrity: "" });
    store.approvals[rec.id] = rec;
    await save(store);
    return { ...rec, duplicate: false };
  }));

  server.handle(listRpc, (_i, { paseo }: any) => serial(async () => {
    const store = await load();
    let dirty = false;
    const lives = new Map<string, { projectId: string; sha: string }>();
    for (const r of Object.values(store.approvals)) {
      if (!lives.has(r.workspaceId)) lives.set(r.workspaceId, await workspace(paseo, r.workspaceId).catch(() => ({ projectId: "?", sha: "" })));
      dirty = evaluate(r, lives.get(r.workspaceId)!) || dirty;
    }
    if (dirty) await save(store);
    return Object.values(store.approvals);
  }));

  server.handle(decideRpc, ({ id, decision, shown }, { paseo }: any) => serial(async () => {
    const store = await load();
    const r = store.approvals[id] ?? reject("unknown approval");
    const live = await workspace(paseo, r.workspaceId);
    if (evaluate(r, live)) await save(store);
    if (r.status !== "pending") reject("approval not pending: " + r.status + (r.reason ? " (" + r.reason + ")" : ""));
    if (!matches(r, shown) || shown.policyVersion !== policy()) reject("shown values differ from request");
    r.status = decision === "approve" ? "approved" : "changes_requested";
    r.decidedAt = Date.now();
    seal(r);
    await save(store);
    return r;
  }));

  server.handle(consumeRpc, ({ id, shown }, { paseo }: any) => serial(async () => {
    const store = await load();
    const r = store.approvals[id] ?? reject("unknown approval");
    const live = await workspace(paseo, r.workspaceId);
    if (evaluate(r, live)) await save(store);
    if (r.status !== "approved") reject("not approved: " + r.status + (r.reason ? " (" + r.reason + ")" : ""));
    if (!matches(r, shown)) reject("shown values differ from request");
    r.status = "consumed";
    r.consumedAt = Date.now();
    seal(r);
    await save(store);
    // No effect is performed. A product would still need verified actor identity before acting.
    return { bindingValid: true, identityVerified: false, effect: "none", id: r.id };
  }));
  return () => {};
}
