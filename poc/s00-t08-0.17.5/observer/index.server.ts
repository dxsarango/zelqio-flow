import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout } from "node:timers/promises";
import { defineRpc } from "@getpaseo/plugin";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import type { ProviderCapability, ProviderEvent } from "@getpaseo/plugin/server/provider";
import { z } from "zod";

const hexSha = z.string().regex(/^[a-f0-9]{40}$/);
const memory = "synthetic-unrelated-memory";
const capabilities: ProviderCapability[] = ["prompt.message", "session.persistence", "permission"];

export default function contribute(server: PluginServerContext) {
  const home = process.env.ZF_T08_HOME!;
  const cwd = join(home, "clone");
  const journal = join(home, "provider.ndjson");
  const memoryFile = join(home, "control-memory.txt");
  if (!existsSync(memoryFile)) writeFileSync(memoryFile, memory, { flush: true });
  let volatile = 0;
  function record(event: string, fields: Record<string, unknown> = {}) {
    appendFileSync(journal, JSON.stringify({ event, at: Date.now(), ...fields }) + "\n", { flush: true });
    volatile++;
  }
  server.handle(defineRpc({ name: "fixture.state", input: z.object({}),
    output: z.object({ volatile: z.number(), memory: z.string() }) }),
    () => ({ volatile, memory: readFileSync(memoryFile, "utf8") }));
  server.handle(defineRpc({ name: "fixture.effect", input: z.object({ before: hexSha, after: hexSha }),
    output: z.boolean() }), async ({ before, after }) => {
      writeFileSync(join(cwd, "effect.txt"), "synthetic file effect\n", { flush: true });
      execFileSync(process.env.ZF_T08_GIT!, ["update-ref", "refs/heads/main", after, before], { cwd, windowsHide: true });
      // The runner kills the daemon after observing both effects and before this RPC can report completion.
      return new Promise<boolean>(() => {});
    });
  server.addHook("agent.permission.after", async ({ requestId, resolution }) => {
    record("host.resolved", { requestId, behavior: resolution.behavior });
  });
  server.registerProvider({
    id: "zelqio-fixture",
    label: "Synthetic T08 fixture",
    async status() { return { available: true }; },
    async connect() {
      const listeners = new Set<(event: ProviderEvent) => void>();
      const emit = (event: ProviderEvent) => { for (const listener of listeners) listener(event); };
      const turns = new Map<string, string>();
      const handled = new Set<string>();
      return {
        version: 1,
        capabilities,
        onEvent(listener) {
          listeners.add(listener);
          return () => { listeners.delete(listener); };
        },
        async send(input) {
          if (input.type === "catalog") {
            emit({ type: "catalog", requestId: input.requestId, catalog: {
              models: [{ id: "fixture-default", label: "Fixture", isDefault: true }],
              modes: [{ id: "fixture-mode", label: "Fixture mode" }],
              defaultModel: "fixture-default", defaultMode: "fixture-mode",
            } });
          } else if (input.type === "session.open") {
            const { requestId, sessionId, config } = input;
            record("open", { sessionId, restored: input.persistence !== undefined });
            emit({ type: "session.opened", requestId, sessionId, cwd: config.cwd, capabilities,
              restoration: "core", persistence: input.persistence ?? { version: 1, data: { key: sessionId } } });
            emit({ type: "session.ready", requestId, sessionId });
          } else if (input.type === "session.prompt") {
            const { sessionId, prompt } = input;
            const turnId = prompt.clientMessageId;
            turns.set(sessionId, turnId);
            record("prompt", { sessionId, turnId });
            emit({ type: "session.prompt_result", sessionId, clientMessageId: turnId, result: { type: "turn", turnId } });
            emit({ type: "session.turn", sessionId, turnId, state: "started" });
            emit({ type: "timeline.item", sessionId, item: {
              type: "assistant_message", id: `message-${turnId}`, text: "synthetic-private-message",
            } });
            emit({ type: "session.permission", sessionId, request: {
              id: `request-${turnId}`, name: "synthetic-permission", kind: "other",
              metadata: { credential: "synthetic-credential-sentinel" },
            } });
          } else if (input.type === "session.permission") {
            const { sessionId, permissionId, response } = input;
            record("provider.decision", { sessionId, requestId: permissionId, behavior: response.behavior });
            // Record all deliveries, even if the provider has already completed this permission.
            if (handled.has(permissionId)) return;
            handled.add(permissionId);
            await setTimeout(600);
            emit({ type: "session.permission_resolved", sessionId, permissionId });
            const turnId = turns.get(sessionId);
            if (turnId) emit({ type: "session.turn", sessionId, turnId, state: "completed" });
          } else if (input.type === "session.close") {
            record("close", { sessionId: input.sessionId });
            emit({ type: "session.closed", requestId: input.requestId, sessionId: input.sessionId });
            emit({ type: "request.completed", requestId: input.requestId });
          } else if ("requestId" in input) {
            emit({ type: "request.completed", requestId: input.requestId });
          }
        },
        async close() { listeners.clear(); },
      };
    },
  });
  return () => {};
}
