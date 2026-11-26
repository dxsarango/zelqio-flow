// Disposable POC (S00-T02). App side: controls in the native composer and New Workspace setup.
import type { PluginClientContext } from "@getpaseo/plugin/client";
import { useComposer, useNewWorkspace, useRpc } from "@getpaseo/plugin/client";
import { settingsRpc } from "@getpaseo/plugin";
import { useEffect, useRef } from "react";
import { Pressable, Text, View } from "react-native";
import { META_KEY, POC_SELECTION, optInSettings, traceRpc, type Orchestration } from "./shared/contract";

const settings = settingsRpc(optInSettings.id);
const MODEL_ID = process_model();
function process_model() { return POC_SELECTION.provider + "/" + POC_SELECTION.model; }

function Row({ theme, label, value, onPress }: { theme: any; label: string; value: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label + ": " + value}
      onPress={onPress}
      style={{ flexDirection: "row", gap: 6, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, backgroundColor: theme.colors.surface2 }}
    >
      <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>{label}:</Text>
      <Text style={{ color: theme.colors.foreground, fontSize: 12 }}>{value}</Text>
    </Pressable>
  );
}

function ComposerControl({ theme }: any) {
  const composer = useComposer();
  const trace = useRpc(traceRpc);
  const readSettings = useRpc(settings.read);
  const writeSettings = useRpc(settings.write);
  const meta = (composer.agent.metadata as any)?.[META_KEY];
  const value: Orchestration = meta?.orchestration === "automatic" ? "automatic" : "disabled";
  const announced = useRef(false);
  useEffect(() => {
    if (announced.current) return;
    announced.current = true;
    void trace({ event: "composer-item-mounted", data: { context: composer.context as any, provider: composer.agent.provider, model: composer.agent.model } });
  }, []);

  async function activate() {
    await composer.setMetadata({ [META_KEY]: { orchestration: "automatic", selection: { ...POC_SELECTION } } });
    // Apply the plugin's selection to the native composer controls (a running agent rejects provider changes).
    await composer.setProvider(POC_SELECTION.provider).catch((e: Error) => trace({ event: "setProvider-rejected", data: { message: e.message } }));
    await composer.setModel(MODEL_ID).catch((e: Error) => trace({ event: "setModel-rejected", data: { message: e.message } }));
    await composer.setMode(POC_SELECTION.modeId).catch((e: Error) => trace({ event: "setMode-rejected", data: { message: e.message } }));
  }

  // Report what the native composer holds, so the run log shows the real state after each change.
  useEffect(() => {
    void trace({ event: "composer-state", data: { provider: composer.agent.provider, model: composer.agent.model, mode: composer.agent.mode, meta: meta ?? null } });
  }, [composer.agent.provider, composer.agent.model, composer.agent.mode, value]);

  // Persisted opt-in: a fresh composer (new page load, new draft) starts from the saved host setting.
  useEffect(() => {
    void (async () => {
      const current = await readSettings({});
      void trace({ event: "settings-read", data: current as any });
      if (current.status === "ready" && (current.values as any)?.orchestration === "automatic" && !meta) await activate();
    })();
  }, []);

  async function toggle() {
    const next: Orchestration = value === "automatic" ? "disabled" : "automatic";
    try {
      if (next === "automatic") await activate();
      else await composer.setMetadata({ [META_KEY]: null });
      const current = await readSettings({});
      if (current.status === "ready") await writeSettings({ revision: current.revision, values: { orchestration: next } });
      void trace({ event: "toggled", data: { next } });
    } catch (e) {
      void trace({ event: "toggle-failed", data: { message: (e as Error).message } });
    }
  }
  return (
    <View style={{ flexDirection: "row", paddingHorizontal: 8, paddingVertical: 4 }}>
      <Row theme={theme} label="Orchestration" value={value === "automatic" ? "Automatic" : "Disabled"} onPress={toggle} />
    </View>
  );
}

function NewWorkspaceControl({ theme }: any) {
  const nw = useNewWorkspace();
  const trace = useRpc(traceRpc);
  const meta = (nw.metadata as any)?.[META_KEY];
  const value: Orchestration = meta?.orchestration === "automatic" ? "automatic" : "disabled";
  const announced = useRef(false);
  useEffect(() => {
    if (announced.current) return;
    announced.current = true;
    void trace({ event: "new-workspace-item-mounted", data: { project: (nw.project as any)?.id ?? null } });
  }, []);
  async function toggle() {
    const next: Orchestration = value === "automatic" ? "disabled" : "automatic";
    await nw.setMetadata({ [META_KEY]: next === "automatic" ? { orchestration: "automatic" } : null });
    void trace({ event: "nw-toggled", data: { next } });
  }
  return (
    <View style={{ flexDirection: "row", paddingHorizontal: 8, paddingVertical: 4 }}>
      <Row theme={theme} label="Orchestration" value={value === "automatic" ? "Automatic" : "Disabled"} onPress={toggle} />
    </View>
  );
}

export default function contribute(client: PluginClientContext) {
  const removers = [
    client.addComposerItem({ id: "orchestration", Component: ComposerControl }),
    client.addNewWorkspaceItem({ id: "orchestration", Component: NewWorkspaceControl }),
  ];
  return () => {
    for (const remove of removers) remove();
  };
}
