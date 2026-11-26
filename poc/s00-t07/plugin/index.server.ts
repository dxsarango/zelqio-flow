// Disposable POC (S00-T07). Daemon side: introspection, SHA-bound approval store, trace.
import type { PluginServerContext } from "@getpaseo/plugin/server";
import { execCommand } from "@getpaseo/plugin/server";
import { randomUUID } from "node:crypto";
import { ACTION, POLICY_VERSION, decideRpc, getRpc, inspectRpc, listRpc, requestRpc, traceRpc } from "./shared/contract";

function trace(event: string, data: unknown) {
  console.log("ZQT " + JSON.stringify({ t: Date.now(), event, data }));
}
const keysOf = (o: any) => (o && typeof o === "object" ? Object.keys(o).sort() : typeof o);

type Approval = {
  id: string; action: string; projectId: string; target: string; sha: string; policyVersion: string;
  requestedBy: string; currentSha?: string; validForCurrentSha?: boolean; status: "pending" | "approved" | "changes_requested" | "stale" | "rejected";
  decidedAt?: number; decisionNote?: string;
};
const approvals = new Map<string, Approval>();

export default function contribute(server: PluginServerContext) {
  server.handle(traceRpc, ({ event, data }) => { trace("ui:" + event, data ?? null); return { ok: true }; });

  // Resolve a workspace id to {projectId, cwd} using only the host API (never client-supplied paths).
  async function resolveWorkspace(paseo: any, workspaceId: string) {
    const listed: any = await paseo.workspaces.list();
    const arr: any[] = Array.isArray(listed) ? listed : (listed?.workspaces ?? listed?.entries ?? []);
    const w = arr.find((x) => x.id === workspaceId || x.workspaceId === workspaceId);
    return { w, shape: keysOf(w), listShape: keysOf(listed) };
  }
  const headSha = async (cwd: string) => (await execCommand("git", ["rev-parse", "HEAD"], { cwd, shell: false, timeout: 10000 })).stdout.trim();

  server.handle(inspectRpc, async ({ workspaceId }, { paseo }: any) => {
    const out: any = { paseoKeys: keysOf(paseo), workspacesKeys: keysOf(paseo.workspaces), projectsKeys: keysOf(paseo.projects), hostsKeys: keysOf(paseo.hosts), terminalsKeys: keysOf(paseo.terminals), agentsKeys: keysOf(paseo.agents), configKeys: keysOf(paseo.config) };
    out.platform = process.platform;
    if (workspaceId) {
      const r = await resolveWorkspace(paseo, workspaceId);
      out.workspaceShape = r.shape; out.listShape = r.listShape;
      try { const h = paseo.workspaces.ref(workspaceId); out.workspaceHandleKeys = keysOf(h); } catch (e) { out.refError = String(e); }
      try { out.hosts = await paseo.hosts.list(); } catch (e) { out.hostsError = String(e); }
      out.workspaceSample = r.w ? JSON.parse(JSON.stringify(r.w, (k, v) => (typeof v === "string" && v.length > 200 ? v.slice(0, 200) : v))) : null;
    }
    trace("inspect", out);
    return out;
  });

  server.handle(requestRpc, async ({ workspaceId, requestedBy }, { paseo }: any) => {
    const { w } = await resolveWorkspace(paseo, workspaceId);
    if (!w) throw new Error("unknown workspace");
    const cwd: string = w.workspaceDirectory;
    const rec: Approval = {
      id: randomUUID(), action: ACTION, projectId: String(w.projectId ?? w.project?.id ?? "?"), target: workspaceId,
      sha: await headSha(cwd), policyVersion: POLICY_VERSION, requestedBy, status: "pending",
    };
    approvals.set(rec.id, rec);
    trace("approval.requested", rec);
    return rec;
  });

  // Re-reads the SHA every time: a new commit makes a pending approval stale without any event.
  async function current(paseo: any, rec: Approval): Promise<Approval> {
    const { w } = await resolveWorkspace(paseo, rec.target);
    const sha = w ? await headSha(w.workspaceDirectory) : "";
    rec.currentSha = sha;
    rec.validForCurrentSha = sha === rec.sha && (rec.status === "pending" || rec.status === "approved");
    if (rec.status === "pending" && sha !== rec.sha) { rec.status = "stale"; trace("approval.stale", { id: rec.id, was: rec.sha, now: sha }); }
    return rec;
  }
  server.handle(getRpc, async ({ id }, { paseo }: any) => { const r = approvals.get(id); if (!r) throw new Error("unknown approval"); return await current(paseo, r); });
  server.handle(listRpc, async (_i, { paseo }: any) => { const all = []; for (const r of approvals.values()) all.push(await current(paseo, r)); return all; });

  server.handle(decideRpc, async ({ id, decision, shown }, ctx: any) => {
    const rec = approvals.get(id);
    // The handler context has no caller identity: record exactly what it does contain.
    const ctxKeys = keysOf(ctx);
    if (!rec) { trace("approval.decide.rejected", { id, reason: "unknown", ctxKeys }); throw new Error("unknown approval"); }
    await current(ctx.paseo, rec);
    const mismatch = (Object.keys(shown) as (keyof typeof shown)[]).filter((k) => (shown as any)[k] !== (rec as any)[k === "target" ? "target" : k]);
    if (rec.status !== "pending") { trace("approval.decide.rejected", { id, reason: "status:" + rec.status, ctxKeys }); throw new Error("approval not pending: " + rec.status); }
    if (mismatch.length) { rec.status = "rejected"; trace("approval.decide.rejected", { id, reason: "mismatch", mismatch, ctxKeys }); throw new Error("shown values differ from request: " + mismatch.join(",")); }
    rec.status = decision === "approve" ? "approved" : "changes_requested";
    rec.decidedAt = Date.now();
    trace("approval.decided", { id, decision, ctxKeys, rec });
    return rec;
  });
  return () => {};
}
