import type { PluginScreenProps } from "@getpaseo/plugin/client";
import { useRpc, useTranslation } from "@getpaseo/plugin/client";
import { SettingsAction, SettingsRow, SettingsSection, SettingsSelect } from "@getpaseo/plugin/client/ui";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Linking, ScrollView, Text, View } from "react-native";
import type { CatalogProvider } from "../shared/providers";
import { unwrapResult } from "../shared/rpc";
import { STRATEGIES, type ZelqioSettings } from "../shared/settings";
import { runsCancelRpc, runsListRpc } from "../shared/runs";
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

function RunsSection() {
  const { t, locale } = useTranslation(messages);
  const read = useRpc(runsListRpc);
  const stop = useRpc(runsCancelRpc);
  const [failed, setFailed] = useState(false);
  const runs = useQuery({
    queryKey: ["zelqio.runs"],
    queryFn: async () => unwrapResult(await read({})),
    refetchInterval: 10_000,
    retry: false,
  });
  const dates = new Intl.DateTimeFormat(locale, { dateStyle: "short", timeStyle: "short" });
  const list = [...(runs.data?.runs ?? [])].sort((a, b) => b.createdAt - a.createdAt).slice(0, 20);
  return (
    <SettingsSection title={t("runs.title")} testID="zelqio-runs">
      {runs.isPending ? <SettingsRow label={t("runs.loading")} /> : null}
      {runs.isError ? <SettingsRow label={t("runs.unavailable")} /> : null}
      {runs.data && list.length === 0 ? <SettingsRow label={t("runs.empty")} /> : null}
      {list.map((run) => {
        const prUrl = run.delivery?.prUrl;
        const using = run.current ? t("runs.using", { provider: run.current.provider, model: run.current.model }) : "";
        const waiting = run.status === "waiting_quota" && run.resumeAt !== null
          ? t("runs.waitingUntil", { at: dates.format(new Date(run.resumeAt)) })
          : "";
        const detail = run.status === "delivered" ? (run.result ?? "") : run.status === "failed" ? (run.error ?? "") : "";
        const gitHint = [
          run.gitPlan ? t("runs.git.branch", { branch: run.gitPlan.branch }) : "",
          run.delivery?.sha ? run.delivery.sha.slice(0, 12) : "",
          run.delivery?.reason === "review_deferred" ? t("runs.git.deferred") : run.delivery ? t(`runs.git.${run.delivery.state}`) : "",
          run.delivery?.retained ? t("runs.git.retained") : "",
          prUrl,
        ].filter(Boolean).join(" · ");
        const hint = [t(`runs.status.${run.status}`), using, waiting, run.attention ? t("runs.takeover") : "", gitHint, detail.slice(0, 200)]
          .filter(Boolean).join(" · ");
        const active = run.status === "queued" || run.status === "running" || run.status === "waiting_quota";
        return active ? (
          <SettingsAction
            key={run.id}
            label={run.prompt.slice(0, 80)}
            hint={hint}
            actionLabel={t("runs.cancel")}
            onPress={() => {
              setFailed(false);
              stop({ id: run.id }).then((result) => { unwrapResult(result); void runs.refetch(); }, () => setFailed(true));
            }}
          />
        ) : prUrl ? (
          <SettingsAction key={run.id} label={run.title ?? run.prompt.slice(0, 80)} hint={hint}
            actionLabel={t("runs.git.open")} onPress={() => { void Linking.openURL(prUrl).catch(() => undefined); }} />
        ) : (
          <SettingsRow key={run.id} label={run.prompt.slice(0, 80)} hint={hint} />
        );
      })}
      {failed ? <SettingsRow label={t("runs.cancelFailed")} /> : null}
      <SettingsAction label={t("runs.title")} actionLabel={t("runs.refresh")} disabled={runs.isFetching} onPress={() => void runs.refetch()} />
      <SettingsRow label={t("runs.fundingNote")} />
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
        <RunsSection />
        <ProvidersSection />
        <UsageSection />
        <RoutingPreferences />
      </View>
    </ScrollView>
  );
}
