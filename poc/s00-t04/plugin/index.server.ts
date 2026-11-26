import { randomUUID } from "node:crypto";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import { control, createDirect, dump } from "./shared/contracts";
import { action, whoami } from "./server/tools";
import { bind, controlState, events, log, registry } from "./server/state";
import { mintToken, ownMcpConfig, startOwnMcp, stopOwnMcp } from "./server/own-mcp";

export default function contribute(server: PluginServerContext) {
  const ownMcpReady = startOwnMcp();
  // POC-04: direct creation through the SDK. No Agent Profile is referenced.
  server.handle(createDirect, async (input, { paseo }) => {
    const agentId = randomUUID();
    // Register BEFORE creation so the first open of the session already resolves a role.
    if (input.register) bind(agentId, input.role, input.runId);
    log("rpc.create_direct", {
      agentId,
      provider: input.provider,
      modeId: input.modeId ?? null,
      thinkingOptionId: input.thinkingOptionId ?? null,
    });
    const agent = await paseo.agents.create({
      agentId,
      cwd: input.cwd,
      title: input.title,
      prompt: input.prompt,
      config: {
        provider: input.provider,
        modeId: input.modeId,
        thinkingOptionId: input.thinkingOptionId,
        ...(input.options ? { options: input.options } : {}),
        ...(input.toolPolicy ? { toolPolicy: input.toolPolicy } : {}),
      },
    } as never);
    return { agentId: (agent as { id: string }).id, registered: registry.has(agentId) };
  });

  server.handle(dump, async (input) => {
    const out = { events: [...events], registry: [...registry.values()] };
    if (input.clear) events.length = 0;
    return out;
  });

  server.handle(control, async (input) => {
    controlState.vetoCreateWhen = input.vetoCreateWhen;
    controlState.vetoProvider = input.vetoProvider;
    controlState.denyChildrenOfManaged = input.denyChildrenOfManaged;
    log("rpc.control", { ...input });
    return { ok: true };
  });

  // Observe (and optionally veto) every creation: this hook also sees unmanaged agents.
  const offCreateBefore = server.addHook("agent.create.before", async ({ request }: any) => {
    const c = request.config;
    log("hook.agent.create.before", {
      provider: c.provider,
      model: c.model ?? null,
      modeId: c.modeId ?? null,
      thinkingOptionId: c.thinkingOptionId ?? null,
      mcpServerCount: Object.keys(c.mcpServers ?? {}).length,
      envKeys: Object.keys(request.env ?? {}),
      metadataKeys: Object.keys(request.metadata ?? {}),
      requestKeys: Object.keys(request),
    });
    if (controlState.vetoCreateWhen === "provider" && c.provider === controlState.vetoProvider) {
      throw new Error("zf-poc: creation vetoed by plugin policy");
    }
    return undefined;
  });

  const offCreateAfter = server.addHook("agent.create.after", async (event: any) => {
    const a = event.agent ?? event;
    log("hook.agent.create.after", {
      id: a.id,
      provider: a.provider,
      parentAgentId: a.parentAgentId ?? null,
      parentIsManaged: a.parentAgentId ? registry.has(a.parentAgentId) : false,
      selfManaged: registry.has(a.id),
      eventKeys: Object.keys(event),
    });
  });

  // POC-05: attach tools before the session's first turn, only for registered agents.
  const offOpen = server.addHook("agent.open.before", async ({ request }: any) => {
    const binding = registry.get(request.agentId);
    log("hook.agent.open.before", {
      agentId: request.agentId,
      reason: request.reason,
      purpose: request.purpose,
      provider: request.provider,
      labelKeys: Object.keys(request.labels),
      managed: binding !== undefined,
      incomingTools: request.tools.length,
      incomingMcpServers: Object.keys(request.mcpServers),
    });
    const parent = request.labels["paseo.parent-agent-id"];
    if (controlState.denyChildrenOfManaged && parent && registry.has(parent)) {
      log("veto.open.child-of-managed", { agentId: request.agentId, parent });
      throw new Error("zf-poc: managed agents may not create child sessions");
    }
    if (!binding || request.purpose !== "interactive") return undefined; // unmanaged: untouched
    await ownMcpReady;
    const token = mintToken(request.agentId);
    return { ...request, tools: [whoami, action], mcpServers: { ...request.mcpServers, ...ownMcpConfig(token) } } as never;
  });

  const offPermission = server.addHook("agent.permission.before", async (event: any) => {
    log("hook.agent.permission.before", {
      agentId: event.agent?.id ?? null,
      requestKeys: Object.keys(event.request ?? {}),
    });
  });

  return () => {
    offCreateBefore();
    offCreateAfter();
    offOpen();
    offPermission();
    stopOwnMcp();
  };
}
