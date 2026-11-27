import { useComposer, type PluginClientContext } from "@getpaseo/plugin/client";
import { Pressable, Text, View } from "react-native";
import { useState } from "react";

function FixtureDraft() {
  const composer = useComposer();
  const [error, setError] = useState("");
  if (composer.context !== "draft" || composer.agent.provider !== "zelqio-fixture") return null;
  const apply = async () => {
    try {
      await composer.setModel("fixture-other");
      await composer.setMetadata({ "zelqio-probe.draft": true });
    } catch (problem) {
      setError(String(problem));
    }
  };
  return (
    <View>
      <Text testID="probe-draft-state">{JSON.stringify({ context: composer.context,
        model: composer.agent.model, metadata: composer.agent.metadata, error })}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="Apply fixture draft" onPress={() => void apply()}>
        <Text>Apply fixture draft</Text>
      </Pressable>
    </View>
  );
}

export default function contribute(client: PluginClientContext) {
  return client.addComposerItem({ id: "fixture-draft", Component: FixtureDraft });
}
