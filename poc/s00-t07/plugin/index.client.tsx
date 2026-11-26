// Disposable POC (S00-T07). App side: workspace panel with service info, host info and approve / request-changes.
import type { PluginClientContext, PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import { usePaseo, useRpc, useWorkspace } from "@getpaseo/plugin/client";
import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { decideRpc, getRpc, inspectRpc, requestRpc, traceRpc } from "./shared/contract";

const keysOf = (o: any) => (o && typeof o === "object" ? Object.keys(o).sort() : typeof o);

function Btn({ theme, label, onPress }: { theme: any; label: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress}
      style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, backgroundColor: theme.colors.surface2 }}>
      <Text style={{ color: theme.colors.foreground, fontSize: 13 }}>{label}</Text>
    </Pressable>
  );
}

function Panel({ theme, layout, workspaceId }: PluginWorkspacePanelProps) {
  const paseo: any = usePaseo();
  const trace = useRpc(traceRpc);
  const inspect = useRpc(inspectRpc);
  const request = useRpc(requestRpc);
  const get = useRpc(getRpc);
  const decide = useRpc(decideRpc);
  const wsKeys = useWorkspace(workspaceId, (w: any) => keysOf(w));
  const [approval, setApproval] = useState<any>(null);
  const [msg, setMsg] = useState("");
  const say = (event: string, data: unknown) => { void trace({ event, data: data as any }); };

  useEffect(() => {
    void (async () => {
      say("client.surface", { wsKeys, paseoKeys: keysOf(paseo), hostsKeys: keysOf(paseo?.hosts), compact: layout.compact });
      try { say("client.hosts", await paseo.hosts.list()); } catch (e) { say("client.hosts.error", String(e)); }
      try { say("client.connection", { state: paseo.getConnectionState?.() ?? null }); } catch (e) { say("client.connection.error", String(e)); }
      say("client.env", { origin: typeof location !== "undefined" ? location.origin : null, hostname: typeof location !== "undefined" ? location.hostname : null });
      say("server.inspect", await inspect({ workspaceId }));
    })();
  }, []);

  async function refresh(id: string) { const r: any = await get({ id }); setApproval(r); return r; }
  async function doRequest() { const r: any = await request({ workspaceId, requestedBy: "ui" }); setApproval(r); setMsg("requested " + r.sha.slice(0, 8)); say("ui.request", r); }
  async function doDecide(decision: "approve" | "request_changes") {
    if (!approval) return;
    const shown = { action: approval.action, projectId: approval.projectId, target: approval.target, sha: approval.sha, policyVersion: approval.policyVersion };
    try { const r: any = await decide({ id: approval.id, decision, shown }); setApproval(r); setMsg("decided: " + r.status); say("ui.decide.ok", { status: r.status }); }
    catch (e) { setMsg("rejected: " + (e as Error).message); say("ui.decide.error", { message: (e as Error).message }); await refresh(approval.id).catch(() => {}); }
  }
  const T = { color: theme.colors.foreground, fontSize: 13 } as const;
  return (
    <View style={{ flex: 1, padding: 12, gap: 8, backgroundColor: theme.colors.surface0 }}>
      <Text style={T}>Zelqio POC T07 panel · workspace {workspaceId}</Text>
      <Text style={T}>{approval ? `approval ${approval.id.slice(0, 8)} · ${approval.action} · sha ${approval.sha.slice(0, 8)} · ${approval.policyVersion} · ${approval.status}` : "no approval requested"}</Text>
      <View style={{ flexDirection: "row", gap: 8 }}>
        <Btn theme={theme} label="Request approval" onPress={() => void doRequest()} />
        <Btn theme={theme} label="Approve" onPress={() => void doDecide("approve")} />
        <Btn theme={theme} label="Request changes" onPress={() => void doDecide("request_changes")} />
        <Btn theme={theme} label="Refresh" onPress={() => approval && void refresh(approval.id)} />
      </View>
      <Text style={T}>{msg}</Text>
    </View>
  );
}

export default function contribute(client: PluginClientContext) {
  const remove = client.addWorkspacePanel({ id: "t07", title: "T07 approval", icon: "PanelsTopLeft", context: "workspace", Component: Panel } as any);
  return () => { (remove as any)?.(); };
}
