import type { PluginComposerItemProps } from "@getpaseo/plugin/client";
import { useComposer, useTranslation } from "@getpaseo/plugin/client";
import { useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { draftOrchestration, orchestrationMetadataPatch } from "../shared/orchestration";
import { messages } from "./translations";

export function DraftOrchestrationControl({ theme }: PluginComposerItemProps) {
  const composer = useComposer();
  const { t } = useTranslation(messages);
  const pending = useRef(false);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  if (composer.context === "agent") return null;

  const mode = draftOrchestration(composer.agent.metadata);
  const colors = theme.colors;
  const automatic = mode === "automatic";

  const toggle = async () => {
    if (pending.current) return;
    pending.current = true;
    setSaving(true);
    setFailed(false);
    try {
      await composer.setMetadata(orchestrationMetadataPatch(automatic ? "disabled" : "automatic"));
    } catch {
      setFailed(true);
    } finally {
      pending.current = false;
      setSaving(false);
    }
  };

  return (
    <View style={{ flexShrink: 1 }}>
      <Pressable
        testID="zelqio-orchestration-draft"
        accessibilityRole="switch"
        accessibilityLabel={t("orchestration.title")}
        accessibilityHint={t("orchestration.inactive")}
        accessibilityState={{ checked: automatic, disabled: saving }}
        aria-checked={automatic}
        disabled={saving}
        onPress={() => void toggle()}
        style={({ pressed }) => ({
          alignSelf: "flex-start",
          minHeight: 40,
          justifyContent: "center",
          borderRadius: 8,
          borderWidth: 1,
          borderColor: colors.border,
          backgroundColor: pressed || automatic ? colors.surface2 : colors.surface0,
          paddingHorizontal: 10,
          opacity: saving ? 0.65 : 1,
        })}
      >
        <Text style={{ color: colors.foreground, fontSize: 13 }}>
          {t("orchestration.control", { mode: t(`orchestration.${mode}`) })}
        </Text>
      </Pressable>
      {automatic || failed ? (
        <Text accessibilityRole={failed ? "alert" : undefined} style={{ color: failed ? colors.statusDanger : colors.foregroundMuted, fontSize: 12, marginTop: 3 }}>
          {t(failed ? "orchestration.saveFailed" : "orchestration.inactive")}
        </Text>
      ) : null}
    </View>
  );
}
