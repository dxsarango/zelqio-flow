import type { PaseoApi } from "@getpaseo/client";
import type { AgentPort, AgentSnapshot } from "./run-manager";

type TimelineEntry = { item?: { type?: string; text?: string; name?: string } };

function entriesOf(payload: unknown): TimelineEntry[] {
  const entries = (payload as { entries?: unknown } | null)?.entries;
  return Array.isArray(entries) ? (entries as TimelineEntry[]) : [];
}

/** Adapts the native Paseo SDK to what the run manager needs. Nothing here changes accounts, billing or permissions. */
export function paseoAgentPort(api: () => PaseoApi): AgentPort {
  return {
    async create(input) {
      const handle = await api().agents.create({
        idempotencyKey: input.key,
        config: { provider: `${input.provider}/${input.model}` },
        cwd: input.cwd,
        prompt: input.prompt,
        clientMessageId: input.key,
        title: input.title,
        metadata: input.metadata,
      });
      return { id: handle.id };
    },

    async snapshot(agentId): Promise<AgentSnapshot | null> {
      const result = await api().agents.ref(agentId).refresh();
      const agent = result?.agent;
      if (!agent) return null;
      return {
        id: agentId,
        status: agent.status,
        lastError: typeof agent.lastError === "string" && agent.lastError ? agent.lastError : null,
        pendingPermissions: agent.pendingPermissions?.length ?? 0,
        archived: Boolean(agent.archivedAt),
        restorable: Boolean(agent.persistence) && !agent.providerUnavailable,
        lastUserMessageAt: typeof agent.lastUserMessageAt === "string" ? Date.parse(agent.lastUserMessageAt) || null : null,
      };
    },

    async send(agentId, text, messageId) {
      await api().agents.ref(agentId).send(text, { messageId });
    },

    async lastReply(agentId) {
      const page = await api().agents.ref(agentId).timeline.refetch({ direction: "tail", limit: 40 });
      const replies = entriesOf(page).map(entry => entry.item).filter(item => item?.type === "assistant_message" && item.text);
      return replies.length ? (replies[replies.length - 1]?.text ?? null) : null;
    },

    async firstUserMessage(agentId) {
      const page = await api().agents.ref(agentId).timeline.refetch({ direction: "tail", limit: 200 });
      const first = entriesOf(page).map(entry => entry.item).find(item => item?.type === "user_message" && item.text);
      return first?.text ?? null;
    },

    async recentActivity(agentId) {
      const page = await api().agents.ref(agentId).timeline.refetch({ direction: "tail", limit: 40 });
      const lines: string[] = [];
      for (const entry of entriesOf(page)) {
        const item = entry.item;
        if (!item) continue;
        if (item.type === "assistant_message" && item.text) lines.push(`assistant: ${item.text}`);
        else if (item.type === "user_message" && item.text) lines.push(`user: ${item.text}`);
      }
      return lines.join("\n").slice(-4000);
    },
  };
}
