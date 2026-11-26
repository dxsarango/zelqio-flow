import type { PluginServerContext } from "@getpaseo/plugin/server";
import { zelqioSettingsDefinition } from "../shared/settings";

/** Registers the plugin settings with the Paseo SDK (host scope). The SDK owns storage, revisions and migration. */
export function registerZelqioSettings(server: Pick<PluginServerContext, "registerSettings">) {
  return server.registerSettings(zelqioSettingsDefinition);
}
