import type { PaseoApi } from "@getpaseo/client";
import { relative, isAbsolute, sep } from "node:path";
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
      const options = {
        idempotencyKey: input.key,
        config: { provider: `${input.provider}/${input.model}`, ...(input.thinkingOptionId ? { thinkingOptionId: input.thinkingOptionId } : {}) },
        prompt: input.prompt,
        clientMessageId: input.key,
        autoArchive: false,
        title: input.title,
        metadata: input.metadata,
        ...(input.parentAgentId ? { parent: input.parentAgentId } : {}),
      };
      const handle = input.workspaceId
        ? await api().workspaces.ref(input.workspaceId).agents.create(options)
        : await api().agents.create({ ...options, cwd: input.cwd });
      return { id: handle.id };
    },

    async createWorktree(input) {
      const workspace = await api().workspaces.create({
        idempotencyKey: input.key,
        title: input.branch,
        source: {
          kind: "worktree", action: "branch-off", cwd: input.source, baseBranch: input.baseRef,
          refName: input.baseRef, branchName: input.branch, worktreeSlug: input.key,
        },
      });
      const cwd = workspace.directory ?? (await workspace.refresh())?.workspaceDirectory;
      if (!cwd) throw new Error("Paseo did not return a worktree directory.");
      return { cwd, workspaceId: workspace.id };
    },

    async worktreeInactive(workspaceId, cwd, owners) {
      const terminals = await api().workspaces.ref(workspaceId).terminals.list();
      if (terminals.entries.length > 0) return false;
      let cursor: string | undefined;
      do {
        const result = await api().agents.list({
          filter: { includeBackground: true, includeInternal: true }, page: { limit: 100, cursor },
        });
        for (const { agent } of result.entries) {
          const location = relative(cwd, agent.cwd);
          const sameWorktree = agent.workspaceId === workspaceId ||
            (!isAbsolute(location) && location !== ".." && !location.startsWith(".." + sep));
          if (!sameWorktree) continue;
          if (agent.activeTurn || agent.pendingPermissions?.length || agent.status === "running" || agent.status === "initializing" ||
              (!owners.includes(agent.id) && agent.status !== "closed")) return false;
        }
        if (!result.pageInfo.hasMore) return true;
        const next = result.pageInfo.nextCursor;
        if (!next || next === cursor) return false;
        cursor = next;
      } while (cursor);
      return false;
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
