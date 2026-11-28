import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { useRpc, useSettings, useTranslation } from "@getpaseo/plugin/client";
import {
  SettingsAction,
  SettingsRow,
  SettingsSection,
  SettingsSelect,
  SettingsSwitch,
} from "@getpaseo/plugin/client/ui";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { ScrollView, Text, TextInput, View } from "react-native";
import { unwrapResult } from "../shared/rpc";
import type { ProviderCatalogData } from "../shared/providers";
import { addCustomRole, capability, removeCustomRole, rolesConfig, rolesListRpc, rolesSettingsDefinition, setCandidates } from "../shared/roles";
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

function slug(label: string): string {
  const base = label.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return /^[a-z]/.test(base) ? base.slice(0, 32) : `r_${base}`.slice(0, 32);
}

/** Lets the user prefer a provider per role and add or remove their own roles. Roles never create Paseo Agent Profiles. */
function RolesEditor({ theme, catalog }: { theme: Props["theme"]; catalog: ProviderCatalogData | null }) {
  const { t } = useTranslation(messages);
  const list = useRpc(rolesListRpc);
  const roles = useQuery({ queryKey: ["zelqio.roles"], queryFn: async () => unwrapResult(await list({})) });
  const store = useSettings(rolesSettingsDefinition);
  const [name, setName] = useState("");
  const [skill, setSkill] = useState<(typeof capability.options)[number]>("implement");
  const [failed, setFailed] = useState(false);
  const muted = { color: theme.colors.foregroundMuted };
  const providers = catalog?.providers.filter((provider) => provider.enabled && provider.status === "ready") ?? [];
  if (!roles.data || store.status !== "ready") {
    return <Text style={muted}>{roles.isError || store.status === "error" ? t("prefs.rolesUnavailable") : t("prefs.rolesLoading")}</Text>;
  }
  const save = (next: Parameters<typeof setCandidates>[0]) => {
    setFailed(false);
    store.save(rolesConfig.parse(next), store.revision).then(() => void roles.refetch(), () => setFailed(true));
  };
  const options = [{ value: "any", label: t("prefs.anyProvider") }, ...providers.map((provider) => ({ value: provider.id, label: provider.label }))];
  const id = slug(name);
  const taken = roles.data.roles.some((role) => role.id === id);
  return (
    <>
      <Text style={muted}>{t("prefs.rolesHint")}</Text>
      {roles.data.roles.map((role) => (
        <View key={role.id}>
          <SettingsSelect
            label={role.label}
            hint={role.capabilities.map((entry) => t(`options.capability.${entry}`)).join(", ")}
            value={role.candidates[0]?.provider ?? "any"}
            options={options}
            onValueChange={(value) => save(setCandidates(store.values, role.id, value === "any" ? [] : [{ provider: value }]))}
          />
          {role.kind === "custom" ? (
            <SettingsAction label={role.label} actionLabel={t("prefs.roleRemove")} onPress={() => save(removeCustomRole(store.values, role.id))} />
          ) : null}
        </View>
      ))}
      <TextInput
        accessibilityLabel={t("prefs.roleName")}
        placeholder={t("prefs.roleName")}
        placeholderTextColor={theme.colors.foregroundMuted}
        value={name}
        onChangeText={setName}
        maxLength={60}
        style={{ color: theme.colors.foreground, borderWidth: 1, borderColor: theme.colors.foregroundMuted, borderRadius: 6, padding: 8, marginTop: 8 }}
      />
      <SettingsSelect
        label={t("prefs.roleCapability")}
        value={skill}
        options={capability.options.map((entry) => ({ value: entry, label: t(`options.capability.${entry}`) }))}
        onValueChange={(value) => setSkill(capability.parse(value))}
      />
      <SettingsAction
        label={t("prefs.addRole")}
        actionLabel={t("prefs.roleAdd")}
        disabled={!name.trim() || taken || store.saving}
        onPress={() => {
          save(addCustomRole(store.values, { id, label: name.trim(), capabilities: [skill], candidates: [] }));
          setName("");
        }}
      />
      {failed ? <Text accessibilityRole="alert" style={{ color: theme.colors.statusDanger }}>{t("prefs.roleSaveFailed")}</Text> : null}
    </>
  );
}

/** Chooses which models of a provider Zelqio Flow may use. The order in which they are turned on is the order of preference. */
function ModelChooser({ provider, authorized, onChange }: {
  provider: ProviderCatalogData["providers"][number];
  authorized: string[] | undefined;
  onChange: (models: string[]) => void;
}) {
  const { t } = useTranslation(messages);
  const [open, setOpen] = useState(false);
  const selectable = provider.models.filter((model) => model.selectable);
  const effective = authorized ?? selectable.filter((model) => model.isDefault).map((model) => model.id);
  return (
    <View>
      <SettingsAction
        label={t("prefs.models", { provider: provider.label })}
        hint={t("prefs.modelsCount", { count: effective.length })}
        actionLabel={t(open ? "prefs.modelsHide" : "prefs.modelsChoose")}
        onPress={() => setOpen(!open)}
      />
      {open ? (
        <>
          <SettingsRow label={t("prefs.modelsHint", { provider: provider.label })} />
          {selectable.map((model) => (
            <SettingsSwitch
              key={model.id}
              label={model.label || model.id}
              value={effective.includes(model.id)}
              onValueChange={(on) => onChange(on ? [...effective, model.id] : effective.filter((id) => id !== model.id))}
            />
          ))}
        </>
      ) : null}
    </View>
  );
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
        <SettingsSwitch label={t("prefs.preventSleep")} hint={t("prefs.preventSleepHint")} value={draft.power.preventSleep} onValueChange={(preventSleep) => set({ power: { preventSleep } })} />
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
              {cur.use !== "off" && entry ? (
                <ModelChooser provider={entry} authorized={cur.models} onChange={(models) => setProvider(id, { models })} />
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
        <RolesEditor theme={theme} catalog={catalog} />
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
