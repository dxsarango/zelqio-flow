import { randomUUID } from "node:crypto";
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
  server.registerProvider(provider(record, "zelqio-fixture-alt"));
  const account = "isolated-fixture-account";
  let remainingPct = 0;
  const resetsAt = new Date(Date.now() + 300_000).toISOString();
  server.registerUsageSource({
    id: "zelqio-fixture",
    label: "Zelqio fixture quota",
    providers: ["zelqio-fixture"],
    input: z.literal(account),
    async discover(scope) {
      if (scope.kind === "session" && scope.provider !== "zelqio-fixture") return [];
      record("usage.discover", { kind: scope.kind });
      return [{ key: account, provider: "zelqio-fixture", input: account }];
    },
    async fetch() {
      record("usage.fetch", { remainingPct, resetsAt });
      return { status: "available", windows: [{ id: "fixture-window", label: "Fixture window", remainingPct, resetsAt }] };
    },
  });
  server.handle(defineRpc({ name: "probe.usage", input: z.object({}), output: z.unknown() }),
    async (_input, { paseo }) => {
      const report = await paseo.providers.listUsage();
      return { report, providerMethods: Object.keys(paseo.providers).sort(), apiKeys: Object.keys(paseo).sort() };
    });
  const usageWatches = new Set<() => void>();
  server.handle(defineRpc({ name: "probe.usage-watch", input: z.object({ active: z.boolean() }), output: z.boolean() }),
    ({ active }, { paseo }) => {
      if (active) usageWatches.add(paseo.providers.subscribe(update => record("providers.subscribe", update)));
      else {
        for (const release of usageWatches) release();
        usageWatches.clear();
      }
      return active;
    });
  server.handle(defineRpc({ name: "probe.usage-reset", input: z.object({}), output: z.number() }), () => {
    remainingPct = 80;
    return remainingPct;
  });
  server.handle(defineRpc({
    name: "probe.create",
    input: z.object({ workspaceId: z.string(), prompt: z.enum(["fixture quota", "fixture error", "fixture child"]).optional(),
      predecessor: z.string().optional(), parent: z.string().optional() }),
    output: z.object({ id: z.string() }),
  }), async ({ workspaceId, prompt, predecessor, parent }, { paseo }) => {
    const workspace = paseo.workspaces.ref(workspaceId);
    const source = predecessor ? await paseo.agents.ref(predecessor).timeline.refetch({
      direction: "tail", limit: 8, wholeTurns: true,
    }) : null;
    // This probe only transfers synthetic transcript entries between fixture agents.
    const carry = source ? JSON.stringify(source.entries) : null;
    const agent = await workspace.agents.create({
      config: predecessor ? { provider: "zelqio-fixture-alt/fixture-default", modeId: "fixture-mode" }
        : { provider: "zelqio-fixture/fixture-other", modeId: "fixture-mode",
          thinkingOptionId: "fixture-think", options: { fixtureLevel: 3 } },
      metadata: { "zelqio-probe.fixture": true, ...(predecessor ? { predecessor } : {}) },
      ...(parent ? { parent } : {}),
      ...(carry ? { prompt: `fixture handoff ${carry}`, clientMessageId: randomUUID() }
        : prompt ? { prompt, clientMessageId: randomUUID() } : {}),
    });
    return { id: agent.id };
  });
  server.handle(defineRpc({ name: "probe.read", input: z.object({ id: z.string() }), output: z.unknown() }),
    async ({ id }, { paseo }) => {
      const agent = paseo.agents.ref(id);
      const { entries } = await agent.timeline.refetch({ direction: "tail", limit: 12, wholeTurns: true });
      return { agent: agent.current(), entries };
    });
  server.handle(defineRpc({ name: "probe.resume",
    input: z.object({ id: z.string(), messageId: z.string() }), output: z.boolean() }),
    async ({ id, messageId }, { paseo }) => {
      await paseo.agents.ref(id).send("fixture resume", { messageId });
      return true;
    });
  server.handle(defineRpc({ name: "probe.archive", input: z.object({ id: z.string() }), output: z.unknown() }),
    ({ id }, { paseo }) => paseo.agents.ref(id).archive());
  server.addHook("agent.create.before", async ({ request }, context) => {
    const { env, ...data } = request;
    record("agent.create.before", { ...data, envKeys: Object.keys(env ?? {}).sort(), contextKeys: Object.keys(context).sort() });
    if (typeof request.metadata?.fixtureReplacement === "string") {
      return { ...request, workspaceId: request.metadata.fixtureReplacement };
    }
  });
  server.addHook("agent.open.before", async ({ request }) => {
    const { env, tools, mcpServers, ...data } = request;
    record("agent.open.before", { ...data, envKeys: Object.keys(env).sort(), toolCount: tools.length,
      mcpKeys: Object.keys(mcpServers).sort() });
  });
  server.addHook("agent.turn.after", async payload => record("agent.turn.after", payload));
  return () => {
    for (const release of usageWatches) release();
  };
}
