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
import { ZelqioError } from "../shared/errors";
import { projectsListRpc, stateDeleteRpc, stateExportRpc, statePurgeRpc } from "../shared/local-state";
import { unwrapResult } from "../shared/rpc";
import { resolveSettings } from "../shared/scoped-settings";
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
  gitWorkflow,
  hasErrors,
  isElevatedMode,
  remoteAuthorization,
  strategy,
  validateSettings,
  workMode,
  type ProjectOverride,
  type ZelqioSettings,
} from "../shared/settings";
import { IssueList, useCatalog, useZelqioSettings } from "./settings-common";
import { messages } from "./translations";

type Props = PluginSurfaceProps;

function slug(label: string): string {
  const base = label.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return /^[a-z]/.test(base) ? base.slice(0, 32) : `r_${base}`.slice(0, 32);
}


const INHERIT = "inherit";
const PICK = "pick";
const FINISHED_DAYS = [7, 14, 30, 90, 180, 365];
const RESULT_DAYS = [0, 7, 30, 90, 365];
const MAX_RUNS = [50, 100, 200, 500, 1000];
const withCurrent = (presets: number[], current: number) => [...new Set([...presets, current])].sort((a, b) => a - b);

/** Drops fields that fall back to the global value, and a confirmation that no longer has an elevated mode to confirm. */
function tidy(override: ProjectOverride): ProjectOverride {
  const { strategy, mode, git, remoteAuthorization, elevatedConfirmed } = override;
  return {
    ...(strategy ? { strategy } : {}),
    ...(mode ? { mode } : {}),
    ...(git?.workflow ? { git: { workflow: git.workflow } } : {}),
    ...(remoteAuthorization ? { remoteAuthorization } : {}),
    elevatedConfirmed: mode !== undefined && isElevatedMode(mode) ? elevatedConfirmed : false,
  };
}

/** Per-project overrides, with the effective values and where each one comes from. */
function ProjectOverrides({ draft, set, theme }: { draft: ZelqioSettings; set: (change: Partial<ZelqioSettings>) => void; theme: Props["theme"] }) {
  const { t } = useTranslation(messages);
  const list = useRpc(projectsListRpc);
  const known = useQuery({ queryKey: ["zelqio.projects"], queryFn: async () => unwrapResult(await list({})), retry: false });
  const muted = { color: theme.colors.foregroundMuted };
  const names = new Map((known.data?.projects ?? []).map((project) => [project.key, project.name]));
  const keys = Object.keys(draft.projects).sort();
  const addable = (known.data?.projects ?? []).filter((project) => !keys.includes(project.key));
  const inherit = { value: INHERIT, label: t("prefs.scopes.inherit") };
  const update = (key: string, change: Partial<ProjectOverride>) =>
    set({ projects: { ...draft.projects, [key]: tidy({ ...draft.projects[key], ...change }) } });
  const remove = (key: string) => set({ projects: Object.fromEntries(Object.entries(draft.projects).filter(([other]) => other !== key)) });
  const label = (key: string) => names.get(key) ?? key;
  return (
    <>
      <Text style={muted}>{t("prefs.scopes.hint")}</Text>
      <SettingsRow label={t("prefs.scopes.globalValues")} hint={t("prefs.scopes.effective", {
        strategy: t(`options.strategy.${draft.strategy}`), mode: t(`options.mode.${draft.mode}`),
        workflow: t(`options.workflow.${draft.git.workflow}`), remote: t(`options.remote.${draft.remoteAuthorization}`),
      })} />
      {known.isError ? <Text style={muted}>{t("prefs.scopes.unavailable")}</Text> : null}
      {keys.length === 0 ? <Text style={muted}>{t("prefs.scopes.none")}</Text> : null}
      {keys.map((key) => {
        const override = draft.projects[key];
        const resolved = resolveSettings(draft, { project: key });
        const from = (field: keyof typeof resolved.sources) => t(`prefs.scopes.source.${resolved.sources[field]}`);
        return (
          <View key={key} style={{ marginTop: 12 }}>
            <Text accessibilityRole="header" style={{ color: theme.colors.foreground, fontWeight: "600" }}>{label(key)}</Text>
            {label(key) !== key ? <Text style={muted} numberOfLines={1}>{key}</Text> : null}
            <SettingsSelect
              label={t("prefs.strategy")}
              value={override.strategy ?? INHERIT}
              options={[inherit, ...STRATEGIES.map((s) => ({ value: s, label: t(`options.strategy.${s}`) }))]}
              onValueChange={(value) => update(key, { strategy: value === INHERIT ? undefined : strategy.parse(value) })}
            />
            <SettingsSelect
              label={t("prefs.mode")}
              value={override.mode ?? INHERIT}
              options={[inherit, ...MODES.map((m) => ({ value: m, label: t(`options.mode.${m}`) }))]}
              onValueChange={(value) => update(key, { mode: value === INHERIT ? undefined : workMode.parse(value) })}
            />
            {override.mode && isElevatedMode(override.mode) ? (
              <SettingsSwitch
                label={t("prefs.scopes.confirmElevated", { mode: t(`options.mode.${override.mode}`) })}
                hint={t("prefs.scopes.confirmElevatedHint")}
                value={override.elevatedConfirmed}
                onValueChange={(elevatedConfirmed) => update(key, { elevatedConfirmed })}
              />
            ) : null}
            <SettingsSelect
              label={t("prefs.workflow")}
              value={override.git?.workflow ?? INHERIT}
              options={[inherit, ...WORKFLOWS.map((w) => ({ value: w, label: t(`options.workflow.${w}`) }))]}
              onValueChange={(value) => update(key, { git: value === INHERIT ? undefined : { workflow: gitWorkflow.parse(value) } })}
            />
            <SettingsSelect
              label={t("prefs.remote")}
              value={override.remoteAuthorization ?? INHERIT}
              options={[inherit, ...REMOTE_AUTHORIZATIONS.map((r) => ({ value: r, label: t(`options.remote.${r}`) }))]}
              onValueChange={(value) => update(key, { remoteAuthorization: value === INHERIT ? undefined : remoteAuthorization.parse(value) })}
            />
            <SettingsRow
              label={t("prefs.scopes.effective", {
                strategy: `${t(`options.strategy.${resolved.values.strategy}`)} (${from("strategy")})`,
                mode: `${t(`options.mode.${resolved.values.mode}`)} (${from("mode")})`,
                workflow: `${t(`options.workflow.${resolved.values.workflow}`)} (${from("workflow")})`,
                remote: `${t(`options.remote.${resolved.values.remoteAuthorization}`)} (${from("remoteAuthorization")})`,
              })}
            />
            {resolved.notes.map((note) => (
              <Text key={note.code} accessibilityRole="alert" style={{ color: theme.colors.statusWarning }}>{t(`prefs.scopes.notes.${note.code}`)}</Text>
            ))}
            <SettingsAction label={label(key)} actionLabel={t("prefs.scopes.remove")} onPress={() => remove(key)} />
          </View>
        );
      })}
      {addable.length > 0 ? (
        <SettingsSelect
          label={t("prefs.scopes.add")}
          value={PICK}
          options={[{ value: PICK, label: t("prefs.scopes.addPick") }, ...addable.map((project) => ({ value: project.key, label: project.name ?? project.key }))]}
          onValueChange={(value) => {
            if (value !== PICK) set({ projects: { ...draft.projects, [value]: tidy({ elevatedConfirmed: false }) } });
          }}
        />
      ) : null}
    </>
  );
}

/** Retention of the plugin's local run state, and the manual actions on it. Actions apply right away, not on Save. */
function LocalData({ draft, set, theme, dirty }: { draft: ZelqioSettings; set: (change: Partial<ZelqioSettings>) => void; theme: Props["theme"]; dirty: boolean }) {
  const { t } = useTranslation(messages);
  const purge = useRpc(statePurgeRpc);
  const exportRuns = useRpc(stateExportRpc);
  const remove = useRpc(stateDeleteRpc);
  const [message, setMessage] = useState<string | null>(null);
  const [exported, setExported] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const muted = { color: theme.colors.foregroundMuted };
  const retention = draft.retention;
  const days = (count: number) => t("prefs.retention.days", { count });
  const act = async (work: () => Promise<string>) => {
    setBusy(true);
    setMessage(null);
    try {
      setMessage(await work());
    } catch (error) {
      setMessage(t(error instanceof ZelqioError && error.code === "disabled" ? "prefs.retention.deleteBlocked" : "prefs.retention.failed"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Text style={muted}>{t("prefs.retention.privacy")}</Text>
      <SettingsSelect
        label={t("prefs.retention.finishedDays")}
        hint={t("prefs.retention.finishedHint")}
        value={String(retention.finishedDays)}
        options={withCurrent(FINISHED_DAYS, retention.finishedDays).map((n) => ({ value: String(n), label: days(n) }))}
        onValueChange={(value) => set({ retention: { ...retention, finishedDays: Number(value) } })}
      />
      <SettingsSelect
        label={t("prefs.retention.resultDays")}
        hint={t("prefs.retention.resultHint")}
        value={String(retention.resultDays)}
        options={withCurrent(RESULT_DAYS, retention.resultDays).map((n) => ({ value: String(n), label: n === 0 ? t("prefs.retention.none") : days(n) }))}
        onValueChange={(value) => set({ retention: { ...retention, resultDays: Number(value) } })}
      />
      <SettingsSelect
        label={t("prefs.retention.maxRuns")}
        value={String(retention.maxFinishedRuns)}
        options={withCurrent(MAX_RUNS, retention.maxFinishedRuns).map((n) => ({ value: String(n), label: t("prefs.retention.runs", { count: n }) }))}
        onValueChange={(value) => set({ retention: { ...retention, maxFinishedRuns: Number(value) } })}
      />
      <SettingsAction
        label={t("prefs.retention.cleanNow")}
        actionLabel={t("prefs.retention.clean")}
        disabled={busy || dirty}
        onPress={() => void act(async () => {
          const result = unwrapResult(await purge({}));
          return t("prefs.retention.cleaned", { runs: result.removedRuns, results: result.clearedResults, attempts: result.removedAttempts });
        })}
      />
      <SettingsAction
        label={t("prefs.retention.exportLabel")}
        hint={t("prefs.retention.exportHint")}
        actionLabel={t("prefs.retention.export")}
        disabled={busy}
        onPress={() => void act(async () => {
          const result = unwrapResult(await exportRuns({}));
          setExported(JSON.stringify(result, null, 2));
          return t("prefs.retention.exported", { count: result.records.length, rejected: result.rejected });
        })}
      />
      {exported ? <Text selectable style={{ color: theme.colors.foreground, fontFamily: "monospace", fontSize: 12 }}>{exported}</Text> : null}
      <SettingsAction
        label={t("prefs.retention.deleteAll")}
        hint={t("prefs.retention.deleteHint")}
        actionLabel={t(confirming ? "prefs.retention.deleteConfirm" : "prefs.retention.delete")}
        disabled={busy}
        onPress={() => {
          if (!confirming) {
            setConfirming(true);
            return;
          }
          setConfirming(false);
          void act(async () => {
            const result = unwrapResult(await remove({ confirm: true }));
            setExported(null);
            return t("prefs.retention.deleted", { count: result.deletedFiles });
          });
        }}
      />
      {message ? <Text accessibilityRole="alert" style={muted}>{message}</Text> : null}
    </>
  );
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

      <SettingsSection title={t("prefs.sections.scopes")}>
        <ProjectOverrides draft={draft} set={set} theme={theme} />
      </SettingsSection>

      <SettingsSection title={t("prefs.sections.retention")}>
        <LocalData draft={draft} set={set} theme={theme} dirty={dirty} />
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
