import type { PluginClientContext, PluginSidebarItemProps } from "@getpaseo/plugin/client";
import { SidebarRow } from "@getpaseo/plugin/client/ui";
import { OnboardingScreen } from "./client/onboarding";
import { SettingsScreen } from "./client/settings";
import { StatusScreen } from "./client/status";
import { messages } from "./client/translations";

function StatusItem({ currentScreen, openScreen }: PluginSidebarItemProps) {
  return (
    <SidebarRow
      icon="Workflow"
      active={currentScreen?.screenId === "status"}
      onPress={() => openScreen({ screenId: "status" })}
    />
  );
}

function SetupItem({ currentScreen, openScreen }: PluginSidebarItemProps) {
  return (
    <SidebarRow
      icon="ListChecks"
      active={currentScreen?.screenId === "onboarding"}
      onPress={() => openScreen({ screenId: "onboarding" })}
    />
  );
}

export default function contribute(client: PluginClientContext) {
  client.addScreen({ id: "status", title: messages.message("title"), Component: StatusScreen });
  client.addScreen({ id: "onboarding", title: messages.message("setup.title"), Component: OnboardingScreen });
  client.addSettingsScreen({ id: "settings", title: messages.message("prefs.title"), icon: "Workflow", Component: SettingsScreen });
  client.addSidebarHeaderItem({ id: "status", title: messages.message("title"), Component: StatusItem });
  client.addSidebarHeaderItem({ id: "onboarding", title: messages.message("setup.title"), Component: SetupItem });
  return () => {};
}
