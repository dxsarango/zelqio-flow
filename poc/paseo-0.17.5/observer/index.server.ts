import { copyFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { defineRpc } from "@getpaseo/plugin";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import { z } from "zod";
import { provider } from "./server/provider";

export default function contribute(server: PluginServerContext) {
  const observations: unknown[] = [];
  const record = (hook: string, value: unknown) => {
    observations.push({ hook, value });
  };
  server.handle(defineRpc({ name: "probe.observations", input: z.object({}), output: z.array(z.unknown()) }),
    () => observations);
  server.registerProvider(provider(record));
  server.addHook("agent.create.before", async ({ request }, context) => {
    const { env, ...data } = request;
    record("agent.create.before", { ...data, envKeys: Object.keys(env ?? {}).sort(), contextKeys: Object.keys(context).sort() });
    if (request.metadata?.testManaged === true) {
      return { ...request, metadata: { ...request.metadata, managed: "probe-set" } };
    }
  });
  server.addHook("agent.open.before", async ({ request }) => {
    const { env, tools, mcpServers, ...data } = request;
    record("agent.open.before", { ...data, envKeys: Object.keys(env).sort(), toolCount: tools.length,
      mcpKeys: Object.keys(mcpServers).sort() });
    if (request.reason === "resume" && existsSync(join(request.cwd, "deny-resume"))) {
      throw new Error("probe resume denied");
    }
  });
  for (const hook of ["agent.create.after", "agent.close.after", "agent.archive.after", "agent.turn.before",
    "agent.turn.after", "workspace.create.after"] as const) {
    server.addHook(hook, async payload => record(hook, payload));
  }
  server.addHook("command.run.before", async ({ request }) => {
    const { env, ...data } = request;
    record("command.run.before", { ...data, envKeys: Object.keys(env).sort() });
    if (request.purpose !== "teardown") return;
    if (existsSync(join(request.cwd, "copy-before-teardown"))) {
      for (const name of ["dirty.txt", "untracked.txt"]) {
        copyFileSync(join(request.cwd, name), join(request.cwd, "..", `probe-preserved-${name}`));
      }
    }
    if (existsSync(join(request.cwd, "deny-teardown"))) throw new Error("probe teardown denied");
  });
  server.addHook("workspace.archive.after", async payload => {
    record("workspace.archive.after", { ...payload, checkoutExists: existsSync(payload.workspace.cwd) });
    if (payload.workspace.name === "throw-after") throw new Error("probe after-hook throw");
  });
  return () => {};
}
