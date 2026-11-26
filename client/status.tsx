import type { PluginScreenProps } from "@getpaseo/plugin/client";
import { useRpc } from "@getpaseo/plugin/client";
import { useQuery } from "@tanstack/react-query";
import { Text, View } from "react-native";
import { unwrapResult } from "../shared/rpc";
import { statusRpc } from "../shared/status";

export function StatusScreen({ theme, layout }: PluginScreenProps) {
  const getStatus = useRpc(statusRpc);
  const status = useQuery({ queryKey: ["zelqio.status"], queryFn: async () => unwrapResult(await getStatus({})) });
  const text = { color: theme.colors.foreground };
  return (
    <View style={{ flex: 1, padding: layout.compact ? 16 : 24, backgroundColor: theme.colors.surface0 }}>
      <Text style={text}>Zelqio Flow</Text>
      <Text style={text}>
        {status.data
          ? `v${status.data.version} · ${status.data.level} · effects ${status.data.effectsEnabled ? "on" : "off"}`
          : status.error
            ? "Status unavailable"
            : "Loading…"}
      </Text>
    </View>
  );
}
