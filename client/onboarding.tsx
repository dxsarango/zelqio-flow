import type { PluginScreenProps } from "@getpaseo/plugin/client";
import { useTranslation } from "@getpaseo/plugin/client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import type { CatalogProvider, ProviderCatalogData } from "../shared/providers";
import {
  FUNDINGS,
  MODES,
  PROVIDER_USES,
  REMOTE_AUTHORIZATIONS,
  STRATEGIES,
  WORKFLOWS,
  buildSummary,
  defaultSettings,
  elevatedChoices,
  hasErrors,
  validateSettings,
  type ZelqioSettings,
} from "../shared/settings";
import { IssueList, useCatalog, useZelqioSettings } from "./settings-common";
import { messages } from "./translations";

type Theme = PluginScreenProps["theme"];
const STEPS = ["providers", "sources", "strategy", "work", "projects", "summary"] as const;
type Elevated = ReturnType<typeof elevatedChoices>[number];

function Button({ theme, label, onPress, disabled, primary }: { theme: Theme; label: string; onPress(): void; disabled?: boolean; primary?: boolean }) {
  const c = theme.colors;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={{
        paddingVertical: 10,
        paddingHorizontal: 16,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: primary ? c.accent : c.border,
        backgroundColor: primary ? c.accent : c.surface2,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <Text style={{ color: primary ? c.accentForeground : c.foreground }}>{label}</Text>
    </Pressable>
  );
}

/** One-of-many choice rendered as a radio group of chips. */
function Choice<V extends string>({
  theme,
  label,
  value,
  options,
  onChange,
  disabledValues = [],
}: {
  theme: Theme;
  label: string;
  value: V;
  options: ReadonlyArray<{ value: V; label: string; hint?: string }>;
  onChange(value: V): void;
  disabledValues?: readonly V[];
}) {
  const c = theme.colors;
  const selected = options.find((o) => o.value === value);
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={label} style={{ marginTop: 8 }}>
      <Text style={{ color: c.foregroundMuted }}>{label}</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 4 }}>
        {options.map((o) => {
          const on = o.value === value;
          const disabled = disabledValues.includes(o.value);
          return (
            <Pressable
              key={o.value}
              accessibilityRole="radio"
              accessibilityLabel={o.label}
              accessibilityState={{ checked: on, disabled }}
              disabled={disabled}
              onPress={() => onChange(o.value)}
              style={{
                paddingVertical: 6,
                paddingHorizontal: 12,
                borderRadius: 16,
                borderWidth: 1,
                borderColor: on ? c.accent : c.border,
                backgroundColor: on ? c.accent : c.surface1,
                opacity: disabled ? 0.4 : 1,
              }}
            >
              <Text style={{ color: on ? c.accentForeground : c.foreground }}>{o.label}</Text>
            </Pressable>
          );
        })}
      </View>
      {selected?.hint ? <Text style={{ color: c.foregroundMuted, marginTop: 4 }}>{selected.hint}</Text> : null}
    </View>
  );
}

function Check({ theme, label, checked, onChange }: { theme: Theme; label: string; checked: boolean; onChange(v: boolean): void }) {
  const c = theme.colors;
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityLabel={label}
      accessibilityState={{ checked }}
      onPress={() => onChange(!checked)}
      style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 8 }}
    >
      <View
        style={{
          width: 20,
          height: 20,
          borderRadius: 4,
          borderWidth: 1,
          borderColor: c.accent,
          backgroundColor: checked ? c.accent : "transparent",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {checked ? <Text style={{ color: c.accentForeground }}>✓</Text> : null}
      </View>
      <Text style={{ color: c.foreground, flex: 1 }}>{label}</Text>
    </Pressable>
  );
}

function Card({ theme, children }: { theme: Theme; children: ReactNode }) {
  return (
    <View style={{ padding: 12, borderRadius: 8, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.surface1, marginTop: 12 }}>
      {children}
    </View>
  );
}

/** Providers the user selected earlier that Paseo no longer reports; kept visible so they are never replaced silently. */
function missingProviders(draft: ZelqioSettings, catalog: ProviderCatalogData): string[] {
  const known = new Set(catalog.providers.map((p) => p.id));
  return Object.keys(draft.providers).filter((id) => !known.has(id));
}

export function OnboardingScreen({ theme, layout }: PluginScreenProps) {
  const { t } = useTranslation(messages);
  const store = useZelqioSettings();
  const { catalog, loading: catalogLoading, failed: catalogFailed, retry } = useCatalog();
  const [draft, setDraft] = useState<ZelqioSettings>(defaultSettings());
  const [step, setStep] = useState(0);
  const [confirmed, setConfirmed] = useState<Elevated[]>([]);
  const [done, setDone] = useState(false);
  const scroller = useRef<ScrollView>(null);
  const revision = store.status === "ready" ? store.revision : null;
  const c = theme.colors;
  const text = { color: c.foreground };
  const muted = { color: c.foregroundMuted };

  useEffect(() => {
    scroller.current?.scrollTo({ y: 0, animated: false });
  }, [step]);

  // Start from what is stored (a returning user reviewing setup); a fresh install starts from the defaults.
  useEffect(() => {
    if (store.status === "ready") setDraft(store.values);
  }, [revision]);

  const patch = (change: Partial<ZelqioSettings>) => {
    setDraft((d) => ({ ...d, ...change }));
    setConfirmed([]);
  };
  const setProvider = (id: string, change: Partial<ZelqioSettings["providers"][string]>) =>
    patch({ providers: { ...draft.providers, [id]: { ...(draft.providers[id] ?? { use: "off" as const, funding: "subscription" as const }), ...change } } });

  const frame = (body: ReactNode) => (
    <ScrollView ref={scroller} style={{ flex: 1, backgroundColor: c.surface0 }} contentContainerStyle={{ padding: layout.compact ? 16 : 24, maxWidth: 720 }}>
      <Text accessibilityRole="header" style={{ ...text, fontSize: 20, fontWeight: "600" }}>
        {t("setup.title")}
      </Text>
      <Text style={{ ...muted, marginTop: 8 }}>{t("notice.effects")}</Text>
      {body}
    </ScrollView>
  );

  if (store.status === "loading") return frame(<Text style={{ ...muted, marginTop: 16 }}>{t("state.loading")}</Text>);
  if (store.status === "error") return frame(<Text accessibilityRole="alert" style={{ color: c.statusDanger, marginTop: 16 }}>{t("state.error", { error: store.error })}</Text>);
  if (store.status === "invalid") {
    return frame(
      <View style={{ marginTop: 16, gap: 8 }}>
        <Text accessibilityRole="alert" style={{ color: c.statusDanger }}>{t("state.invalid", { error: store.error })}</Text>
        <View style={{ flexDirection: "row", gap: 8 }}>
          <Button theme={theme} label={t("state.reload")} onPress={() => void store.reload()} />
          <Button theme={theme} label={t("state.reset")} onPress={() => void store.reset()} />
        </View>
      </View>,
    );
  }
  if (done) {
    return frame(
      <Card theme={theme}>
        <Text accessibilityRole="header" style={text}>{t("setup.done.title")}</Text>
        <Text style={muted}>{t("setup.done.body")}</Text>
      </Card>,
    );
  }

  const candidate: ZelqioSettings = { ...draft, onboardingCompleted: true, consumptionOptIn: draft.consumptionOptIn && elevatedChoices(draft).includes("consumption") };
  const issues = catalog ? validateSettings(candidate, catalog) : [];
  const blocking = !catalog || hasErrors(issues);
  const stepName = STEPS[step] ?? "providers";
  const required = elevatedChoices(candidate);
  const allConfirmed = required.every((r) => confirmed.includes(r));
  const canNext = stepName === "providers" ? !!catalog : stepName === "sources" ? !blocking : true;
  const canConfirm = !blocking && allConfirmed && !store.saving;

  async function confirm() {
    if (revision === null || !catalog) return;
    // Re-validate right before saving; never persist a configuration the catalog contradicts.
    if (hasErrors(validateSettings(candidate, catalog)) || !required.every((r) => confirmed.includes(r))) return;
    if (await store.save(candidate, revision)) setDone(true);
  }

  const providerRows = (cat: ProviderCatalogData) => (
    <>
      {cat.providers.map((p) => (
        <ProviderRow key={p.id} theme={theme} provider={p} draft={draft} onChange={(change) => setProvider(p.id, change)} />
      ))}
      {missingProviders(draft, cat).map((id) => (
        <Card key={id} theme={theme}>
          <Text style={text}>{id}</Text>
          <IssueList issues={issues.filter((i) => i.provider === id)} catalog={cat} color={c.statusDanger} warningColor={c.statusWarning} />
          <Choice
            theme={theme}
            label={t("setup.sources.use")}
            value={draft.providers[id]?.use ?? "off"}
            options={PROVIDER_USES.map((u) => ({ value: u, label: t(`options.use.${u}`) }))}
            disabledValues={["primary", "auxiliary"]}
            onChange={(use) => setProvider(id, { use })}
          />
        </Card>
      ))}
    </>
  );

  return frame(
    <View style={{ marginTop: 16 }}>
      <Text style={muted}>{t("setup.stepOf", { current: step + 1, total: STEPS.length })}</Text>
      <Text accessibilityRole="header" style={{ ...text, fontSize: 16, fontWeight: "600", marginTop: 4 }}>
        {t(`setup.steps.${stepName}`)}
      </Text>

      {stepName === "providers" && (
        <>
          <Text style={{ ...muted, marginTop: 8 }}>{t("setup.detect.intro")}</Text>
          {catalogLoading ? <Text style={muted}>{t("providers.loading")}</Text> : null}
          {catalogFailed ? (
            <View style={{ marginTop: 8, gap: 8, alignItems: "flex-start" }}>
              <Text accessibilityRole="alert" style={{ color: c.statusDanger }}>{t("state.catalogUnavailable")}</Text>
              <Button theme={theme} label={t("state.retry")} onPress={retry} />
            </View>
          ) : null}
          {catalog && catalog.providers.length === 0 ? <Text style={{ color: c.statusWarning, marginTop: 8 }}>{t("setup.detect.none")}</Text> : null}
          {catalog?.providers.map((p) => (
            <Card key={p.id} theme={theme}>
              <Text style={text}>{p.label}</Text>
              <Text style={muted}>{t("providers.summary", { status: t(`providers.status.${p.status}`), count: p.models.length })}</Text>
              {p.error ? <Text style={{ color: c.statusWarning }}>{p.error}</Text> : null}
            </Card>
          ))}
        </>
      )}

      {stepName === "sources" && catalog && (
        <>
          <Text style={{ ...muted, marginTop: 8 }}>{t("setup.sources.intro")}</Text>
          {providerRows(catalog)}
          {elevatedChoices(draft).includes("consumption") ? (
            <Card theme={theme}>
              <Check theme={theme} label={t("setup.sources.optIn")} checked={draft.consumptionOptIn} onChange={(v) => patch({ consumptionOptIn: v })} />
            </Card>
          ) : null}
          <IssueList issues={issues.filter((i) => !i.provider || i.code === "consumption_requires_opt_in")} catalog={catalog} color={c.statusDanger} warningColor={c.statusWarning} />
        </>
      )}

      {stepName === "strategy" && (
        <Choice
          theme={theme}
          label={t("setup.summary.strategy")}
          value={draft.strategy}
          options={STRATEGIES.map((s) => ({ value: s, label: t(`options.strategy.${s}`), hint: t(`options.hint.strategy.${s}`) }))}
          onChange={(strategy) => patch({ strategy })}
        />
      )}

      {stepName === "work" && (
        <>
          <Choice
            theme={theme}
            label={t("setup.summary.mode")}
            value={draft.mode}
            options={MODES.map((m) => ({ value: m, label: t(`options.mode.${m}`), hint: t(`options.hint.mode.${m}`) }))}
            onChange={(mode) => patch({ mode })}
          />
          <Choice
            theme={theme}
            label={t("setup.summary.workflow")}
            value={draft.git.workflow}
            options={WORKFLOWS.map((w) => ({ value: w, label: t(`options.workflow.${w}`), hint: t(`options.hint.workflow.${w}`) }))}
            onChange={(workflow) => patch({ git: { workflow } })}
          />
        </>
      )}

      {stepName === "projects" && (
        <>
          <Text style={{ ...muted, marginTop: 8 }}>{t("setup.projects.intro")}</Text>
          <Choice
            theme={theme}
            label={t("setup.summary.remote")}
            value={draft.remoteAuthorization}
            options={REMOTE_AUTHORIZATIONS.map((r) => ({ value: r, label: t(`options.remote.${r}`), hint: t(`options.hint.remote.${r}`) }))}
            onChange={(remoteAuthorization) => patch({ remoteAuthorization })}
          />
        </>
      )}

      {stepName === "summary" && catalog && <Summary theme={theme} candidate={candidate} catalog={catalog} confirmed={confirmed} onConfirm={setConfirmed} blocked={blocking} />}

      {store.saveError ? (
        <View accessibilityRole="alert" style={{ marginTop: 12 }}>
          <Text style={{ color: c.statusDanger }}>{t("state.saveFailed", { error: store.saveError })}</Text>
          <Text style={muted}>{t("state.conflictHint")}</Text>
          <Button theme={theme} label={t("state.reload")} onPress={() => void store.reload()} />
        </View>
      ) : null}

      <View style={{ flexDirection: "row", gap: 8, marginTop: 20, flexWrap: "wrap" }}>
        <Button theme={theme} label={t("setup.nav.back")} disabled={step === 0} onPress={() => setStep(step - 1)} />
        {step < STEPS.length - 1 ? (
          <Button theme={theme} primary label={t("setup.nav.next")} disabled={!canNext} onPress={() => setStep(step + 1)} />
        ) : (
          <Button
            theme={theme}
            primary
            label={store.saving ? t("setup.nav.confirming") : t("setup.nav.confirm")}
            disabled={!canConfirm}
            onPress={() => void confirm()}
          />
        )}
      </View>
    </View>,
  );
}

function ProviderRow({
  theme,
  provider,
  draft,
  onChange,
}: {
  theme: Theme;
  provider: CatalogProvider;
  draft: ZelqioSettings;
  onChange(change: Partial<ZelqioSettings["providers"][string]>): void;
}) {
  const { t } = useTranslation(messages);
  const current = draft.providers[provider.id] ?? { use: "off" as const, funding: "subscription" as const };
  const usable = provider.enabled && provider.status === "ready";
  return (
    <Card theme={theme}>
      <Text style={{ color: theme.colors.foreground, fontWeight: "600" }}>{provider.label}</Text>
      <Text style={{ color: theme.colors.foregroundMuted }}>{t("providers.summary", { status: t(`providers.status.${provider.status}`), count: provider.models.length })}</Text>
      {provider.error ? <Text style={{ color: theme.colors.statusWarning }}>{provider.error}</Text> : null}
      {!usable ? <Text style={{ color: theme.colors.statusWarning }}>{t("setup.sources.notReady")}</Text> : null}
      <Choice
        theme={theme}
        label={t("setup.sources.use")}
        value={current.use}
        options={PROVIDER_USES.map((u) => ({ value: u, label: t(`options.use.${u}`) }))}
        disabledValues={usable ? [] : ["primary", "auxiliary"]}
        onChange={(use) => onChange({ use })}
      />
      {current.use !== "off" ? (
        <Choice
          theme={theme}
          label={t("setup.sources.funding")}
          value={current.funding}
          options={FUNDINGS.map((f) => ({ value: f, label: t(`options.funding.${f}`) }))}
          onChange={(funding) => onChange({ funding })}
        />
      ) : null}
    </Card>
  );
}

function Summary({
  theme,
  candidate,
  catalog,
  confirmed,
  onConfirm,
  blocked,
}: {
  theme: Theme;
  candidate: ZelqioSettings;
  catalog: ProviderCatalogData;
  confirmed: Elevated[];
  onConfirm(next: Elevated[]): void;
  blocked: boolean;
}) {
  const { t } = useTranslation(messages);
  const c = theme.colors;
  const summary = buildSummary(candidate, catalog);
  const row = (label: string, value: string) => (
    <View style={{ flexDirection: "row", gap: 8, marginTop: 4, flexWrap: "wrap" }}>
      <Text style={{ color: c.foregroundMuted }}>{label}:</Text>
      <Text style={{ color: c.foreground }}>{value}</Text>
    </View>
  );
  return (
    <>
      <Card theme={theme}>
        <Text accessibilityRole="header" style={{ color: c.foreground, fontWeight: "600" }}>{t("setup.summary.providers")}</Text>
        {summary.providers.map((p) => (
          <Text key={p.id} style={{ color: c.foreground, marginTop: 4 }}>
            {`${p.label} · ${t(`options.use.${p.use}`)} · ${t(`options.funding.${p.funding}`)} · ${t(p.usable ? "setup.summary.usable" : "setup.summary.notUsable")}`}
          </Text>
        ))}
        {row(t("setup.summary.strategy"), t(`options.strategy.${summary.strategy}`))}
        {row(t("setup.summary.mode"), t(`options.mode.${summary.mode}`))}
        {row(t("setup.summary.workflow"), t(`options.workflow.${summary.workflow}`))}
        {row(t("setup.summary.remote"), t(`options.remote.${summary.remoteAuthorization}`))}
      </Card>
      <IssueList issues={summary.issues} catalog={catalog} color={c.statusDanger} warningColor={c.statusWarning} />
      {summary.elevated.length > 0 ? (
        <Card theme={theme}>
          <Text accessibilityRole="header" style={{ color: c.statusWarning, fontWeight: "600" }}>{t("setup.summary.elevated")}</Text>
          {summary.elevated.map((choice) => (
            <Check
              key={choice}
              theme={theme}
              label={t("setup.summary.confirmChoice", { choice: t(`setup.summary.elevatedName.${choice}`) })}
              checked={confirmed.includes(choice)}
              onChange={(v) => onConfirm(v ? [...confirmed, choice] : confirmed.filter((x) => x !== choice))}
            />
          ))}
        </Card>
      ) : null}
      {blocked ? <Text style={{ color: c.statusDanger, marginTop: 8 }}>{t("setup.summary.blocked")}</Text> : null}
    </>
  );
}
