import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { useRpc, useTranslation } from "@getpaseo/plugin/client";
import {
  SettingsAction,
  SettingsRow,
  SettingsSection,
  SettingsSelect,
  SettingsSwitch,
} from "@getpaseo/plugin/client/ui";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { unwrapResult } from "../shared/rpc";
import { rolesListRpc } from "../shared/roles";
import {
  FUNDINGS,
  MODES,
  PROVIDER_USES,
  REMOTE_AUTHORIZATIONS,
  STRATEGIES,
  WORKFLOWS,
  elevatedChoices,
  hasErrors,
  validateSettings,
  type ZelqioSettings,
} from "../shared/settings";
import { IssueList, useCatalog, useZelqioSettings } from "./settings-common";
import { messages } from "./translations";

type Props = PluginSurfaceProps;

function RolesList({ theme }: Pick<Props, "theme">) {
  const { t } = useTranslation(messages);
  const list = useRpc(rolesListRpc);
  const roles = useQuery({ queryKey: ["zelqio.roles"], queryFn: async () => unwrapResult(await list({})) });
  const muted = { color: theme.colors.foregroundMuted };
  if (roles.data) {
    return (
      <>
        {roles.data.roles.map((r) => (
          <SettingsRow key={r.id} label={r.label} hint={r.capabilities.join(", ")} />
        ))}
      </>
    );
  }
  return <Text style={muted}>{roles.isError ? t("prefs.rolesUnavailable") : t("prefs.rolesLoading")}</Text>;
}

export function SettingsScreen({ theme, layout }: Props) {
  const { t } = useTranslation(messages);
  const store = useZelqioSettings();
  const { catalog, failed: catalogFailed, retry } = useCatalog();
  const [draft, setDraft] = useState<ZelqioSettings | null>(null);
  const [confirmedElevated, setConfirmedElevated] = useState(false);
  const revision = store.status === "ready" || store.status === "invalid" ? store.revision : null;
  const c = theme.colors;

  useEffect(() => {
    setDraft(store.status === "ready" ? store.values : null);
    setConfirmedElevated(false);
  }, [revision]);

  const wrap = (body: React.ReactNode) => (
    <ScrollView style={{ flex: 1, backgroundColor: c.surface0 }} contentContainerStyle={{ padding: layout.compact ? 16 : 24, maxWidth: 720 }}>
      {body}
    </ScrollView>
  );

  if (store.status === "loading") return wrap(<Text style={{ color: c.foregroundMuted }}>{t("state.loading")}</Text>);
  if (store.status === "error") return wrap(<Text accessibilityRole="alert" style={{ color: c.statusDanger }}>{t("state.error", { error: store.error })}</Text>);
  if (store.status === "invalid") {
    return wrap(
      <SettingsSection title={t("prefs.sections.general")}>
        <SettingsRow label={t("state.invalid", { error: store.error })} />
        <SettingsAction label={t("state.reload")} actionLabel={t("state.reload")} onPress={() => void store.reload()} />
        <SettingsAction label={t("state.reset")} actionLabel={t("state.reset")} onPress={() => void store.reset()} />
      </SettingsSection>,
    );
  }
  if (!draft) return wrap(<Text style={{ color: c.foregroundMuted }}>{t("state.loading")}</Text>);

  const saved = store.values;
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  // Pay-per-use opt-in only persists while some provider still uses it.
  const candidate: ZelqioSettings = { ...draft, consumptionOptIn: draft.consumptionOptIn && elevatedChoices(draft).includes("consumption") };
  const issues = catalog ? validateSettings(candidate, catalog) : [];
  const elevated = elevatedChoices(candidate);
  const newlyElevated = elevated.filter((e) => !elevatedChoices(saved).includes(e));
  const needsConfirm = newlyElevated.length > 0;
  const canSave = dirty && !!catalog && !hasErrors(issues) && (!needsConfirm || confirmedElevated) && !store.saving;
  const set = (change: Partial<ZelqioSettings>) => {
    setDraft({ ...draft, ...change });
    setConfirmedElevated(false);
  };
  const setProvider = (id: string, change: Partial<ZelqioSettings["providers"][string]>) =>
    set({ providers: { ...draft.providers, [id]: { ...(draft.providers[id] ?? { use: "off" as const, funding: "subscription" as const }), ...change } } });
  const providerIds = [...new Set([...(catalog?.providers.map((p) => p.id) ?? []), ...Object.keys(draft.providers)])];

  return wrap(
    <View>
      <Text accessibilityRole="header" style={{ color: c.foreground, fontSize: 20, fontWeight: "600" }}>{t("prefs.title")}</Text>
      <Text style={{ color: c.foregroundMuted, marginTop: 8 }}>{t("notice.effects")}</Text>

      <SettingsSection title={t("prefs.sections.general")}>
        <SettingsRow label={t(saved.onboardingCompleted ? "prefs.setupDone" : "prefs.setupPending")} hint={t("prefs.setupHint")} />
      </SettingsSection>

      <SettingsSection title={t("prefs.sections.providers")}>
        {catalogFailed ? <SettingsAction label={t("state.catalogUnavailable")} actionLabel={t("state.retry")} onPress={retry} /> : null}
        {providerIds.map((id) => {
          const entry = catalog?.providers.find((p) => p.id === id);
          const cur = draft.providers[id] ?? { use: "off" as const, funding: "subscription" as const };
          const usable = !!entry && entry.enabled && entry.status === "ready";
          return (
            <View key={id}>
              <SettingsSelect
                label={entry?.label ?? id}
                hint={entry ? t("providers.summary", { status: t(`providers.status.${entry.status}`), count: entry.models.length }) : undefined}
                value={cur.use}
                options={PROVIDER_USES.filter((u) => u === "off" || usable || cur.use === u).map((u) => ({ value: u, label: t(`options.use.${u}`) }))}
                onValueChange={(use) => setProvider(id, { use })}
              />
              {cur.use !== "off" ? (
                <SettingsSelect
                  label={`${entry?.label ?? id} · ${t("setup.sources.funding")}`}
                  value={cur.funding}
                  options={FUNDINGS.map((f) => ({ value: f, label: t(`options.funding.${f}`) }))}
                  onValueChange={(funding) => setProvider(id, { funding })}
                />
              ) : null}
            </View>
          );
        })}
        <SettingsSwitch label={t("prefs.optIn")} hint={t("prefs.optInHint")} value={draft.consumptionOptIn} onValueChange={(consumptionOptIn) => set({ consumptionOptIn })} />
        <SettingsSelect
          label={t("prefs.strategy")}
          hint={t(`options.hint.strategy.${draft.strategy}`)}
          value={draft.strategy}
          options={STRATEGIES.map((s) => ({ value: s, label: t(`options.strategy.${s}`) }))}
          onValueChange={(strategy) => set({ strategy })}
        />
      </SettingsSection>

      <SettingsSection title={t("prefs.sections.roles")}>
        <Text style={{ color: c.foregroundMuted }}>{t("prefs.rolesHint")}</Text>
        <RolesList theme={theme} />
      </SettingsSection>

      <SettingsSection title={t("prefs.sections.modes")}>
        <SettingsSelect
          label={t("prefs.mode")}
          hint={t(`options.hint.mode.${draft.mode}`)}
          value={draft.mode}
          options={MODES.map((m) => ({ value: m, label: t(`options.mode.${m}`) }))}
          onValueChange={(mode) => set({ mode })}
        />
      </SettingsSection>

      <SettingsSection title={t("prefs.sections.git")}>
        <SettingsSelect
          label={t("prefs.workflow")}
          hint={t(`options.hint.workflow.${draft.git.workflow}`)}
          value={draft.git.workflow}
          options={WORKFLOWS.map((w) => ({ value: w, label: t(`options.workflow.${w}`) }))}
          onValueChange={(workflow) => set({ git: { workflow } })}
        />
      </SettingsSection>

      <SettingsSection title={t("prefs.sections.projects")}>
        <SettingsSelect
          label={t("prefs.remote")}
          hint={`${t(`options.hint.remote.${draft.remoteAuthorization}`)} ${t("prefs.remoteHint")}`}
          value={draft.remoteAuthorization}
          options={REMOTE_AUTHORIZATIONS.map((r) => ({ value: r, label: t(`options.remote.${r}`) }))}
          onValueChange={(remoteAuthorization) => set({ remoteAuthorization })}
        />
      </SettingsSection>

      <SettingsSection title={t("prefs.sections.about")}>
        <Text style={{ color: c.foregroundMuted }}>{t("prefs.aboutPrivacy")}</Text>
      </SettingsSection>

      <IssueList issues={issues} catalog={catalog} color={c.statusDanger} warningColor={c.statusWarning} />
      {needsConfirm ? (
        <SettingsSwitch
          label={t("prefs.confirmElevated")}
          hint={t("prefs.confirmElevatedHint", { choices: newlyElevated.map((e) => t(`setup.summary.elevatedName.${e}`)).join(", ") })}
          value={confirmedElevated}
          onValueChange={setConfirmedElevated}
        />
      ) : null}
      {store.saveError ? (
        <View accessibilityRole="alert">
          <Text style={{ color: c.statusDanger }}>{t("state.saveFailed", { error: store.saveError })}</Text>
          <SettingsAction label={t("state.conflictHint")} actionLabel={t("state.reload")} onPress={() => void store.reload()} />
        </View>
      ) : null}
      {dirty ? <Text style={{ color: c.statusWarning }}>{t("prefs.unsaved")}</Text> : null}
      <SettingsAction
        label={store.saving ? t("state.saving") : t("prefs.save")}
        actionLabel={t("prefs.save")}
        disabled={!canSave}
        onPress={() => void store.save(candidate, store.revision)}
      />
      <SettingsAction label={t("prefs.discard")} actionLabel={t("prefs.discard")} disabled={!dirty} onPress={() => setDraft(saved)} />
    </View>,
  );
}
