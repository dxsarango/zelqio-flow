import type { PluginScreenProps } from "@getpaseo/plugin/client";
import { useRpc, useTranslation } from "@getpaseo/plugin/client";
import { useQuery } from "@tanstack/react-query";
import { Text, View } from "react-native";
import { unwrapResult } from "../shared/rpc";
import { statusRpc } from "../shared/status";
import { messages } from "./translations";

export function StatusScreen({ theme, layout }: PluginScreenProps) {
  const { t } = useTranslation(messages);
  const getStatus = useRpc(statusRpc);
  const status = useQuery({ queryKey: ["zelqio.status"], queryFn: async () => unwrapResult(await getStatus({})) });
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
    </View>
  );
}
