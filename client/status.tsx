import type { PluginScreenProps } from "@getpaseo/plugin/client";
import { useRpc, useTranslation } from "@getpaseo/plugin/client";
import { useQuery } from "@tanstack/react-query";
import { Text, View } from "react-native";
import { unwrapResult } from "../shared/rpc";
import { providersListRpc } from "../shared/providers";
import { statusRpc } from "../shared/status";
import { messages } from "./translations";

export function StatusScreen({ theme, layout }: PluginScreenProps) {
  const { t } = useTranslation(messages);
  const getStatus = useRpc(statusRpc);
  const status = useQuery({ queryKey: ["zelqio.status"], queryFn: async () => unwrapResult(await getStatus({})) });
  const listProviders = useRpc(providersListRpc);
  const providers = useQuery({ queryKey: ["zelqio.providers"], queryFn: async () => unwrapResult(await listProviders({})) });
  const text = { color: theme.colors.foreground };
  const data = status.data;
  return (
    <View style={{ flex: 1, padding: layout.compact ? 16 : 24, backgroundColor: theme.colors.surface0 }}>
      <Text accessibilityRole="header" style={text}>
        {t("title")}
      </Text>
      {data ? (
        <>
          <Text style={text}>{t("status.version", { version: data.version })}</Text>
          <Text style={text}>{t(`status.level.${data.level}`)}</Text>
          <Text style={text}>{t(data.effectsEnabled ? "status.effects.on" : "status.effects.off")}</Text>
        </>
      ) : (
        <Text style={text}>{status.error ? t("status.unavailable") : t("status.loading")}</Text>
      )}
      <Text accessibilityRole="header" style={{ ...text, marginTop: 16 }}>
        {t("providers.title")}
      </Text>
      {providers.data ? (
        providers.data.providers.length === 0 ? (
          <Text style={text}>{t("providers.empty")}</Text>
        ) : (
          providers.data.providers.map((p) => (
            <View key={p.id}>
              <Text style={text}>{p.label}</Text>
              <Text style={text}>{t("providers.summary", { status: t(`providers.status.${p.status}`), count: p.models.length })}</Text>
              {p.error ? <Text style={text}>{p.error}</Text> : null}
            </View>
          ))
        )
      ) : (
        <Text style={text}>{providers.error ? t("providers.unavailable") : t("providers.loading")}</Text>
      )}
    </View>
  );
}
