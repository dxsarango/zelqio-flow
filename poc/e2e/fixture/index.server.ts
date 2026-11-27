import { randomUUID } from "node:crypto";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { defineRpc } from "@getpaseo/plugin";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import type { ProviderEvent, ProviderRegistration } from "@getpaseo/plugin/server/provider";
import { z } from "zod";

const providers = ["fixture-a", "fixture-b"] as const;
type Provider = typeof providers[number];
const quota = z.object({ remainingPct: z.number().min(0).max(100), resetsAt: z.iso.datetime().nullable() });
type Quota = z.infer<typeof quota>;
const limitError = { message: "You've hit your usage limit. Try again in 1 minute.", code: "usage_limit_exceeded" };
const limitReply = "You've hit your limit · resets in 1 minute";

function fixtureProvider(
  id: Provider,
  read: () => Quota,
  exhaust: () => void,
  trace: (kind: string, fields: Record<string, unknown>) => void,
): ProviderRegistration {
  const model = `${id}-model`;
  const capabilities = ["prompt.message", "session.persistence"];
  return {
    id, label: id,
    async status() { return { available: true }; },
    async connect() {
      const listeners = new Set<(event: ProviderEvent) => void>();
      const timers = new Set<ReturnType<typeof setTimeout>>();
      const emit = (event: ProviderEvent) => {
        for (const listener of listeners) listener(event);
      };
      return {
        version: 1, capabilities,
        onEvent(listener) {
          listeners.add(listener);
          return () => { listeners.delete(listener); };
        },
        async send(input) {
          switch (input.type) {
            case "catalog":
              emit({ type: "catalog", requestId: input.requestId, catalog: {
                models: [{ id: model, label: model, isDefault: true }],
                modes: [{ id: "fixture-mode", label: "Fixture mode" }],
                defaultModel: model, defaultMode: "fixture-mode",
              } });
              break;
            case "session.open": {
              const { requestId, sessionId, config } = input;
              const persistence = input.persistence ?? { version: 1, data: { key: sessionId } };
              trace("session.open", { provider: id, sessionId, model: config.model, restored: input.persistence !== undefined });
              emit({ type: "session.opened", requestId, sessionId, cwd: config.cwd, capabilities, restoration: "core", persistence });
              emit({ type: "session.ready", requestId, sessionId });
              break;
            }
            case "session.close":
              emit({ type: "session.closed", sessionId: input.sessionId });
              emit({ type: "request.completed", requestId: input.requestId });
              break;
            case "session.prompt": {
              const { sessionId, prompt } = input;
              const turnId = prompt.clientMessageId;
              const text = prompt.input.type === "message" ? prompt.input.content
                .filter(part => part.type === "text").map(part => part.text).join("") : "";
              trace("prompt", { provider: id, sessionId, turnId, text });
              emit({ type: "session.prompt_result", sessionId, clientMessageId: turnId, result: { type: "turn", turnId } });
              emit({ type: "session.turn", sessionId, turnId, state: "started" });
              const timer = setTimeout(() => {
                timers.delete(timer);
                const notice = id === "fixture-a" && text.includes("[[limit-reply]]");
                const limit = id === "fixture-a" && (text.includes("[[limit]]") || notice);
                if (limit) exhaust();
                if (!notice && (limit || read().remainingPct === 0)) {
                  emit({ type: "session.turn", sessionId, turnId, state: "failed", error: limitError });
                  return;
                }
                emit({ type: "timeline.item", sessionId, item: {
                  id: randomUUID(), type: "assistant_message", text: notice ? limitReply : `done by ${id}`,
                } });
                emit({ type: "session.turn", sessionId, turnId, state: "completed" });
              }, 500);
              timers.add(timer);
              break;
            }
            default:
              if ("requestId" in input) emit({ type: "request.completed", requestId: input.requestId });
          }
        },
        async close() {
          for (const timer of timers) clearTimeout(timer);
          listeners.clear();
        },
      };
    },
  };
}

export default function contribute(server: PluginServerContext) {
  const dir = process.env.ZELQIO_E2E_FIXTURE;
  if (!dir) throw new Error("This fixture requires an isolated runner");
  const trace = (kind: string, fields: Record<string, unknown>) => {
    appendFileSync(join(dir, "trace.jsonl"), JSON.stringify({ kind, ...fields }) + "\n");
  };
  const file = (provider: Provider) => join(dir, `${provider}.json`);
  const read = (provider: Provider) => quota.parse(JSON.parse(readFileSync(file(provider), "utf8")));
  const write = (provider: Provider, values: Quota) => writeFileSync(file(provider), JSON.stringify(values));
  for (const id of providers) {
    server.registerProvider(fixtureProvider(id, () => read(id), () => {
      write(id, { remainingPct: 0, resetsAt: new Date(Date.now() + 60_000).toISOString() });
    }, trace));
    server.registerUsageSource({
      id, label: id, providers: [id], input: z.literal(id),
      async discover(scope) {
        if (scope.kind === "session" && scope.provider !== id) return [];
        return [{ key: id, provider: id, input: id }];
      },
      async fetch() {
        return { status: "available", windows: [{ id: "fixture-window", label: "Fixture window", ...read(id) }] };
      },
    });
  }
  server.handle(defineRpc({
    name: "fixture.quota", input: quota.extend({ provider: z.enum(providers) }), output: z.boolean(),
  }), ({ provider, ...values }) => {
    write(provider, values);
    return true;
  });
  const removeCreate = server.addHook("agent.create.after", async ({ agent }) => {
    if (agent.provider === "fixture-a" || agent.provider === "fixture-b") {
      trace("agent.create", { id: agent.id, provider: agent.provider, metadata: agent.metadata });
    }
  });
  const removeTurn = server.addHook("agent.turn.after", async ({ agent, turnId, outcome }) => {
    if (agent.provider === "fixture-a" || agent.provider === "fixture-b") {
      trace("agent.turn", { id: agent.id, turnId, outcome });
    }
  });
  return () => {
    removeTurn();
    removeCreate();
  };
}
