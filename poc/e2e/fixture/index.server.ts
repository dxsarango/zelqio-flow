import { randomUUID } from "node:crypto";
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { defineRpc } from "@getpaseo/plugin";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import type { ProviderEvent, ProviderRegistration, ProviderSessionConfig } from "@getpaseo/plugin/server/provider";
import { z } from "zod";
import { coordinate, inspectTools } from "./server/delegation";

const providers = ["fixture-a", "fixture-b"] as const;
type Provider = typeof providers[number];
const quota = z.object({ remainingPct: z.number().min(0).max(100), resetsAt: z.iso.datetime().nullable() });
type Quota = z.infer<typeof quota>;
const limitError = { message: "You've hit your usage limit. Try again in 1 minute.", code: "usage_limit_exceeded" };
const limitReply = "You've hit your limit · resets in 1 minute";

function fixtureProvider(
  id: Provider,
  read: () => Quota,
  exhaust: (short: boolean) => void,
  trace: (kind: string, fields: Record<string, unknown>) => void,
  released: (gate: string) => boolean,
): ProviderRegistration {
  const model = `${id}-model`;
  const capabilities = ["prompt.message", "session.persistence"];
  return {
    id, label: id,
    async status() { return { available: true }; },
    async connect() {
      const listeners = new Set<(event: ProviderEvent) => void>();
      const configs = new Map<string, ProviderSessionConfig>();
      const active = new Map<string, { turnId: string; controller: AbortController }>();
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
              configs.set(sessionId, config);
              const persistence = input.persistence ?? { version: 1, data: { key: sessionId } };
              trace("session.open", { provider: id, sessionId, model: config.model, restored: input.persistence !== undefined,
                delegationGuidance: config.systemPrompt?.includes("Use zelqio_delegate") ?? false });
              emit({ type: "session.opened", requestId, sessionId, cwd: config.cwd, capabilities, restoration: "core", persistence });
              emit({ type: "session.ready", requestId, sessionId });
              break;
            }
            case "session.close":
              active.get(input.sessionId)?.controller.abort();
              configs.delete(input.sessionId);
              trace("session.close", { sessionId: input.sessionId });
              emit({ type: "session.closed", sessionId: input.sessionId });
              emit({ type: "request.completed", requestId: input.requestId });
              break;
            case "session.interrupt": {
              const turn = active.get(input.sessionId);
              if (turn) {
                turn.controller.abort();
                emit({ type: "session.turn", sessionId: input.sessionId, turnId: turn.turnId, state: "canceled" });
              }
              trace("session.interrupt", { sessionId: input.sessionId, turnId: turn?.turnId });
              emit({ type: "request.completed", requestId: input.requestId });
              break;
            }
            case "session.prompt": {
              const { sessionId, prompt } = input;
              const turnId = prompt.clientMessageId;
              const text = prompt.input.type === "message" ? prompt.input.content
                .filter(part => part.type === "text").map(part => part.text).join("") : "";
              const exhaustedAtStart = read().remainingPct === 0;
              trace("prompt", { provider: id, sessionId, turnId, text });
              emit({ type: "session.prompt_result", sessionId, clientMessageId: turnId, result: { type: "turn", turnId } });
              emit({ type: "session.turn", sessionId, turnId, state: "started" });
              const controller = new AbortController();
              const turn = { turnId, controller };
              active.set(sessionId, turn);
              const { signal } = controller;
              const turnTrace = (kind: string, fields: Record<string, unknown>) => trace(kind, { sessionId, turnId, ...fields });
              void (async () => {
                await delay(500, undefined, { signal });
                const scenario = /^\[\[delegation:([a-z]+)\]\]$/.exec(text)?.[1];
                const report = text.startsWith("The delegated tasks finished.");
                if (process.env.ZELQIO_E2E_ENDPOINT) {
                  const request = await inspectTools(configs.get(sessionId)!, turnTrace, signal);
                  if (scenario) await coordinate(scenario, request, turnTrace);
                }
                const gate = /\[\[hold:([a-z-]+)\]\]/.exec(text)?.[1];
                if (gate && !text.startsWith("You are continuing a task")) {
                  const deadline = Date.now() + 45_000;
                  while (!released(gate)) {
                    if (Date.now() >= deadline) throw new Error(`Fixture gate timed out: ${gate}`);
                    await delay(50, undefined, { signal });
                  }
                }
                const notice = id === "fixture-a" && text.includes("[[limit-reply]]");
                const short = id === "fixture-a" && text.includes("[[short-limit]]");
                const limit = id === "fixture-a" && (text.includes("[[limit]]") || notice || short);
                if (limit) exhaust(short);
                if (!notice && (limit || !scenario && !report && exhaustedAtStart)) {
                  emit({ type: "session.turn", sessionId, turnId, state: "failed", error: short ? { ...limitError, message: "Usage limit exceeded." } : limitError });
                  return;
                }
                emit({ type: "timeline.item", sessionId, item: {
                  id: randomUUID(), type: "assistant_message", text: notice ? limitReply : report ? "delegation integrated"
                    : scenario ? "coordination paused" : `done by ${id}`,
                } });
                emit({ type: "session.turn", sessionId, turnId, state: "completed" });
              })().catch(error => {
                if (!signal.aborted) {
                  const message = error instanceof Error ? error.message : "Fixture failed";
                  turnTrace("fixture.error", { message });
                  emit({ type: "session.turn", sessionId, turnId, state: "failed", error: { message, code: "fixture_error" } });
                }
              }).finally(() => {
                if (active.get(sessionId) === turn) active.delete(sessionId);
              });
              break;
            }
            default:
              if ("requestId" in input) emit({ type: "request.completed", requestId: input.requestId });
          }
        },
        async close() {
          for (const { controller } of active.values()) controller.abort();
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
    server.registerProvider(fixtureProvider(id, () => read(id), short => {
      write(id, { remainingPct: 0, resetsAt: short ? null : new Date(Date.now() + 60_000).toISOString() });
    }, trace, gate => existsSync(join(dir, `release-${gate}`))));
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
      trace("agent.create", { id: agent.id, provider: agent.provider, metadata: agent.metadata, parentAgentId: agent.parentAgentId });
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
