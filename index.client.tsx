import type { PluginClientContext, PluginSidebarItemProps } from "@getpaseo/plugin/client";
import { SidebarRow } from "@getpaseo/plugin/client/ui";
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

export default function contribute(client: PluginClientContext) {
  client.addScreen({ id: "status", title: messages.message("title"), Component: StatusScreen });
  client.addSidebarHeaderItem({ id: "status", title: messages.message("title"), Component: StatusItem });
  return () => {};
}
