import type { PluginScreenProps } from "@getpaseo/plugin/client";
import { useRpc, useTranslation } from "@getpaseo/plugin/client";
import { SettingsAction, SettingsRow, SettingsSection, SettingsSelect } from "@getpaseo/plugin/client/ui";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import type { CatalogProvider } from "../shared/providers";
import { unwrapResult } from "../shared/rpc";
import { STRATEGIES, type ZelqioSettings } from "../shared/settings";
import { statusRpc } from "../shared/status";
import { displayedUsageStatus, usageListRpc } from "../shared/usage";
import { useCatalog, useZelqioSettings } from "./settings-common";
import { messages } from "./translations";

function RoutingPreferences() {
  const { t } = useTranslation(messages);
  const store = useZelqioSettings();
  const [draft, setDraft] = useState<{ revision: string; strategy: ZelqioSettings["strategy"] }>();
  if (store.status !== "ready") {
    return (
      <SettingsSection title={t("resources.strategyTitle")}>
        <SettingsRow label={t(store.status === "loading" ? "state.loading" : "resources.preferencesUnavailable")} />
      </SettingsSection>
    );
  }
  const selected = draft?.revision === store.revision ? draft.strategy : store.values.strategy;
  return (
    <SettingsSection title={t("resources.strategyTitle")}>
      <SettingsSelect
        label={t("resources.strategyLabel")}
        hint={t(`options.hint.strategy.${selected}`)}
        options={STRATEGIES.map((strategy) => ({ value: strategy, label: t(`options.strategy.${strategy}`) }))}
        value={selected}
        disabled={store.saving}
        onValueChange={(strategy) => setDraft({ revision: store.revision, strategy })}
      />
      {selected !== store.values.strategy ? (
        <SettingsAction
          label={t("resources.unsavedStrategy")}
          actionLabel={t("resources.saveStrategy")}
          disabled={store.saving}
          onPress={() => void store.save({ ...store.values, strategy: selected }, store.revision)}
        />
      ) : null}
      {store.saveError ? <SettingsRow label={t("resources.saveFailed")} /> : null}
    </SettingsSection>
  );
}

function ProvidersSection() {
  const { t } = useTranslation(messages);
  const { catalog, loading, failed, retry } = useCatalog();
  const [showUnavailable, setShowUnavailable] = useState(false);
  const ready = (provider: CatalogProvider) => provider.enabled && provider.status === "ready";
  const available = catalog?.providers.filter(ready) ?? [];
  const unavailable = catalog?.providers.filter((provider) => !ready(provider)) ?? [];
  return (
    <SettingsSection title={t("providers.title")}>
      {loading ? <SettingsRow label={t("providers.loading")} /> : null}
      {failed ? <SettingsAction label={t("providers.unavailable")} actionLabel={t("resources.retry")} onPress={retry} /> : null}
      {catalog && available.length === 0 ? <SettingsRow label={t("resources.noReadyProviders")} /> : null}
      {available.map((provider) => (
        <SettingsRow
          key={provider.id}
          label={provider.label}
          hint={t("providers.summary", { status: t("providers.status.ready"), count: provider.models.filter((model) => model.selectable).length })}
        />
      ))}
      {unavailable.length > 0 ? (
        <SettingsAction
          label={t("resources.unavailableProviders", { count: unavailable.length })}
          actionLabel={t(showUnavailable ? "resources.hide" : "resources.show")}
          onPress={() => setShowUnavailable(!showUnavailable)}
        />
      ) : null}
      {showUnavailable ? unavailable.map((provider) => (
        <SettingsRow
          key={provider.id}
          label={provider.label}
          hint={t(provider.enabled ? `providers.status.${provider.status}` : "resources.disabled")}
        />
      )) : null}
    </SettingsSection>
  );
}

function UsageSection() {
  const { t, locale } = useTranslation(messages);
  const [now, setNow] = useState(Date.now);
  const read = useRpc(usageListRpc);
  const usage = useQuery({
    queryKey: ["zelqio.usage"],
    queryFn: async () => unwrapResult(await read({})),
    staleTime: 30_000,
    refetchInterval: 30_000,
    retry: false,
  });
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, []);
  const reports = usage.data?.reports ?? [];
  const unavailable = usage.isError || usage.data?.status === "unavailable";
  const dates = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" });
  const percent = new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 1 });
  return (
    <SettingsSection title={t("resources.usage")} testID="zelqio-usage">
      {usage.isPending ? <SettingsRow label={t("resources.loadingUsage")} /> : null}
      {unavailable ? <SettingsRow label={t("resources.usageUnavailable")} /> : null}
      {usage.data?.status === "available" && !reports.length ? <SettingsRow label={t("resources.noReports")} /> : null}
      {reports.length ? <SettingsRow label={t("resources.reportScope")} /> : null}
      {reports.map((report, index) => (
        <View key={JSON.stringify([report.sourceId, index])}>
          <SettingsRow
            label={report.sourceId}
            hint={report.fetchedAt ? t("resources.observed", { at: dates.format(new Date(report.fetchedAt)) }) : t("resources.noObservation")}
          />
          {!report.windows.length ? (
            <SettingsRow label={t(report.status === "error" ? "resources.sourceError" : "resources.status.unknown")} />
          ) : null}
          {report.windows.map((window, windowIndex) => {
            const status = displayedUsageStatus(window, report.fetchedAt, !unavailable, now);
            const state = t(`resources.status.${status}`);
            const label = window.durationSeconds === 18_000
              ? t("resources.fiveHours")
              : window.durationSeconds === 604_800 ? t("resources.weekly") : window.id;
            const remaining = (status === "fresh" || status === "exhausted") && window.remainingPct !== null
              ? t("resources.remaining", { value: percent.format(window.remainingPct / 100) })
              : state;
            const reset = window.resetsAt ? t("resources.resetAt", { at: dates.format(new Date(window.resetsAt)) }) : "";
            return <SettingsRow key={JSON.stringify([window.id, windowIndex])} label={label} hint={[remaining, reset].filter(Boolean).join(" · ")} />;
          })}
        </View>
      ))}
      {!usage.isPending ? (
        <SettingsAction
          label={t("resources.paseoReports")}
          actionLabel={t("resources.refresh")}
          disabled={usage.isFetching}
          onPress={() => void usage.refetch()}
        />
      ) : null}
    </SettingsSection>
  );
}

export function StatusScreen({ theme, layout }: PluginScreenProps) {
  const { t } = useTranslation(messages);
  const getStatus = useRpc(statusRpc);
  const status = useQuery({ queryKey: ["zelqio.status"], queryFn: async () => unwrapResult(await getStatus({})) });
  const colors = theme.colors;
  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.surface0 }} contentContainerStyle={{ padding: layout.compact ? 16 : 24 }}>
      <View style={{ width: "100%", maxWidth: 840, alignSelf: "center" }}>
        <Text accessibilityRole="header" style={{ color: colors.foreground, fontSize: 24, fontWeight: "600", marginBottom: 6 }}>
          {t("resources.title")}
        </Text>
        <Text style={{ color: colors.foregroundMuted, marginBottom: 16 }}>
          {status.data
            ? t(status.data.effectsEnabled ? "resources.selectionEnabled" : "resources.selectionInactive")
            : t(status.isError ? "status.unavailable" : "status.loading")}
        </Text>
        <ProvidersSection />
        <UsageSection />
        <RoutingPreferences />
      </View>
    </ScrollView>
  );
}
