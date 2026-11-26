import type { PluginServerContext } from "@getpaseo/plugin/server";
import type { ProviderEvent } from "@getpaseo/plugin/server/provider";
import { unavailable } from "@getpaseo/plugin/server/usage";
import { z } from "zod";

const input = z.object({ scenario: z.enum(["available", "unavailable", "error"]) });

export default function contribute(server: PluginServerContext) {
  server.registerProvider({
    id: "s00-t03-catalog",
    label: "S00-T03 catalog fixture",
    async status() {
      return { available: true };
    },
    async connect() {
      const listeners = new Set<(event: ProviderEvent) => void>();
      return {
        version: 1,
        capabilities: [],
        onEvent(listener) {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
        async send(request) {
          if (request.type !== "catalog") throw new Error("Catalog only");
          queueMicrotask(() => {
            for (const listener of listeners) {
              listener({
                type: "catalog",
                requestId: request.requestId,
                catalog: {
                  models: [{
                    id: "fixture-model",
                    label: "Fixture model",
                    contextWindowMaxTokens: 8192,
                    thinkingOptions: [{ id: "low", label: "Low" }],
                    defaultThinkingOptionId: "low",
                  }],
                  modes: [{ id: "review", label: "Review" }],
                  defaultMode: "review",
                  defaultModel: "fixture-model",
                },
              });
            }
          });
        },
        async close() {
          listeners.clear();
        },
      };
    },
  });
  server.registerUsageSource({
    id: "s00-t03-fixture",
    label: "S00-T03 fixture",
    providers: ["codex"],
    input,
    async discover(scope) {
      if (scope.kind !== "global") return [];
      return (["available", "unavailable", "error"] as const).map((scenario) => ({
        key: scenario,
        label: scenario,
        input: { scenario },
      }));
    },
    async fetch(value) {
      const { scenario } = input.parse(value);
      if (scenario === "error") throw new Error("S00-T03 synthetic failure");
      if (scenario === "unavailable") {
        return unavailable({ kind: "no_quota", detail: "S00-T03 synthetic absence" });
      }
      const now = Date.now();
      return {
        status: "available",
        observedAt: new Date(now).toISOString(),
        windows: [
          { id: "zero", label: "Zero", usedPct: 0, remainingPct: 100 },
          { id: "full", label: "Full", usedPct: 100, remainingPct: 0 },
          { id: "unknown", label: "Unknown", usedPct: null },
          {
            id: "timed",
            label: "Timed",
            durationSeconds: 18000,
            resetsAt: new Date(now + 1800000).toISOString(),
          },
        ],
      };
    },
  });
  return () => {};
}

