import { useComposer, type PluginClientContext } from "@getpaseo/plugin/client";
import { Pressable, Text, View } from "react-native";
import { useState } from "react";

function SupervisedSelectionFixture() {
  const composer = useComposer();
  const [failed, setFailed] = useState(false);
  if (composer.context === "agent") return null;
  const { provider, model, mode } = composer.agent;
  const apply = async () => {
    setFailed(false);
    try {
      await composer.setModel("fixture-manual");
    } catch {
      setFailed(true);
    }
  };
  return (
    <View>
      <Text testID="s04-t06-draft-state">{[composer.context, provider, model, mode].join(" | ")}</Text>
      {provider === "s00-t03-catalog" && model !== "fixture-manual" ? (
        <Pressable accessibilityRole="button" accessibilityLabel="Apply fixture recommendation" onPress={() => void apply()}>
          <Text>Apply fixture recommendation</Text>
        </Pressable>
      ) : null}
      {failed ? <Text accessibilityRole="alert">Fixture selection failed</Text> : null}
    </View>
  );
}

/** Install only in a disposable daemon with the synthetic catalog and the creation guard. */
export default function contribute(client: PluginClientContext) {
  return client.addComposerItem({ id: "supervised-selection-fixture", Component: SupervisedSelectionFixture });
}
