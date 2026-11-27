import type { PaseoApi } from "@getpaseo/client";
import { expect, it, vi } from "vitest";
import { paseoAgentPort } from "../server/paseo-agent-port";

it("uses a stable native message ID for the initial prompt so Paseo records it in the timeline", async () => {
  const create = vi.fn(async () => ({ id: "agent-1" }));
  const api = { agents: { create } } as unknown as PaseoApi;
  await paseoAgentPort(() => api).create({
    key: "run-1-a1", provider: "fixture-a", model: "fixture-model", cwd: "/fixture", title: "Title",
    prompt: "Original task", metadata: {},
  });
  expect(create).toHaveBeenCalledWith(expect.objectContaining({
    idempotencyKey: "run-1-a1", clientMessageId: "run-1-a1", prompt: "Original task",
  }));
});

it("resumes through the source-less native send API with a stable message ID", async () => {
  const send = vi.fn(async (_text: string, options: { messageId: string; activeTurnBehavior?: string }) => {
    if (options.activeTurnBehavior === "queue") throw new Error("Queue needs an agent sender");
  });
  const ref = vi.fn(() => ({ send }));
  const api = { agents: { ref } } as unknown as PaseoApi;
  await paseoAgentPort(() => api).send("agent-1", "Continue", "run-1-r1");
  expect(ref).toHaveBeenCalledWith("agent-1");
  expect(send).toHaveBeenCalledWith("Continue", { messageId: "run-1-r1" });
});

it("exposes a closed agent's persistence without treating it as archived", async () => {
  const refresh = vi.fn(async () => ({
    agent: { status: "closed", persistence: { provider: "fixture-a" }, archivedAt: null },
  }));
  const api = { agents: { ref: () => ({ refresh }) } } as unknown as PaseoApi;
  const port = paseoAgentPort(() => api);
  expect(await port.snapshot("agent-1")).toMatchObject({ status: "closed", restorable: true, archived: false });
});

it("stops the live turn without reopening an idle or closed session", async () => {
  const refresh = vi.fn()
    .mockResolvedValueOnce({ agent: { status: "running" } })
    .mockResolvedValueOnce({ agent: { status: "idle" } })
    .mockResolvedValueOnce({ agent: { status: "closed" } });
  const reload = vi.fn(async () => null);
  const api = { agents: { ref: () => ({ refresh, reload }) } } as unknown as PaseoApi;
  const port = paseoAgentPort(() => api);
  for (const id of ["running-agent", "idle-agent", "closed-agent"]) await port.stop(id);
  expect(reload).toHaveBeenCalledTimes(1);
});
