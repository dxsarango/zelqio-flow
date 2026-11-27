import type { ProviderEvent, ProviderRegistration } from "@getpaseo/plugin/server/provider";

export function provider(record: (event: string, value: unknown) => void, id = "zelqio-fixture"): ProviderRegistration {
  return {
    id,
    label: id === "zelqio-fixture" ? "Zelqio synthetic fixture" : "Zelqio alternate fixture",
    async status() {
      return { available: true };
    },
    async connect() {
      const listeners = new Set<(event: ProviderEvent) => void>();
      const emit = (event: ProviderEvent) => {
        for (const listener of listeners) listener(event);
      };
      const capabilities = ["prompt.message", "session.persistence"];
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
              models: [{ id: "fixture-default", label: "Fixture default", isDefault: true },
                { id: "fixture-other", label: "Fixture other",
                  thinkingOptions: [{ id: "fixture-think", label: "Fixture thinking" }] }],
              modes: [{ id: "fixture-mode", label: "Fixture mode" }],
              defaultModel: "fixture-default", defaultMode: "fixture-mode",
            } });
            return;
          }
          if (input.type === "session.open") {
            const { requestId, sessionId, config } = input;
            const persistence = input.persistence ?? { version: 1, data: { key: sessionId } };
            record("provider.session.open", { provider: id, sessionId, restored: input.persistence !== undefined,
              handle: persistence.data, model: config.model ?? "fixture-default", mode: config.mode ?? "fixture-mode",
              thinking: config.thinkingOption, options: config.providerOptions });
            emit({ type: "session.opened", requestId, sessionId, cwd: config.cwd, capabilities,
              restoration: "core", persistence });
            emit({ type: "session.ready", requestId, sessionId });
            return;
          }
          if (input.type === "session.close") {
            record("provider.session.close", { sessionId: input.sessionId });
            emit({ type: "session.closed", sessionId: input.sessionId });
            emit({ type: "request.completed", requestId: input.requestId });
            return;
          }
          if (input.type === "session.prompt") {
            const { sessionId, prompt } = input;
            const turnId = prompt.clientMessageId;
            const text = prompt.input.type === "message" ? prompt.input.content
              .filter(part => part.type === "text").map(part => part.text).join("") : "";
            const error = text === "fixture quota" ? { message: "Synthetic usage limit reached", code: "quota_exhausted" }
              : text === "fixture error" ? { message: "Synthetic ordinary failure", code: "fixture_fault" } : undefined;
            record("provider.session.prompt", { provider: id, sessionId, turnId, text });
            emit({ type: "session.prompt_result", sessionId, clientMessageId: turnId, result: { type: "turn", turnId } });
            emit({ type: "session.turn", sessionId, turnId, state: "started" });
            setTimeout(() => {
              emit({ type: "session.turn", sessionId, turnId, state: error ? "failed" : "completed",
                ...(error ? { error } : {}) });
            }, 1500);
            return;
          }
          if ("requestId" in input) emit({ type: "request.completed", requestId: input.requestId });
        },
        async close() {
          listeners.clear();
        },
      };
    },
  };
}
