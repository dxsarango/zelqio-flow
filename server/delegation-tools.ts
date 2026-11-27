import { z } from "zod";
import { defineAgentTool, type AgentToolDefinition } from "@getpaseo/plugin/server";
import { capability } from "../shared/roles";

const reference = z.string().regex(/^[A-Za-z0-9_.-]{1,128}$/);

export interface ChildSummary {
  id: string;
  title: string;
  status: "queued" | "running" | "waiting_quota" | "delivered" | "failed" | "cancelled";
  provider?: string;
  model?: string;
  result?: string | null;
  error?: string | null;
}

/** What the coordinator tools need from the run manager. Every call is made on behalf of one coordinator agent. */
export interface DelegationPort {
  delegate(coordinatorAgentId: string, input: {
    title: string;
    prompt: string;
    role: string;
    capability: z.infer<typeof capability>;
    complexity?: "low" | "medium" | "high";
    dependsOn: string[];
  }): Promise<ChildSummary>;
  children(coordinatorAgentId: string): Promise<ChildSummary[]>;
  cancel(coordinatorAgentId: string, childId: string): Promise<ChildSummary>;
}

const MAX_TEXT = 3000;

function text(children: ChildSummary[]): string {
  if (children.length === 0) return "No delegated tasks yet.";
  return children.map(child => {
    const where = child.provider ? ` on ${child.provider}/${child.model ?? "?"}` : "";
    const detail = child.status === "delivered" ? `\n${(child.result ?? "").slice(0, MAX_TEXT)}`
      : child.status === "failed" ? ` — ${child.error ?? "failed"}` : "";
    return `- ${child.id} [${child.status}]${where}: ${child.title}${detail}`;
  }).join("\n");
}

/**
 * Tools offered to a coordinator agent. Only a coordinator gets them: delegated agents do not, so delegation cannot
 * recurse. Zelqio Flow chooses the model of every delegated task from the models the user authorized; the coordinator
 * names the work and its role, never a provider.
 */
export function delegationTools(port: DelegationPort): AgentToolDefinition[] {
  return [
    defineAgentTool({
      name: "zelqio_delegate",
      title: "Delegate a task",
      description: "Delegate one self-contained task to another agent. Zelqio Flow picks the best authorized model for the role. Use dependsOn with ids returned earlier to run a task only after those tasks are delivered. Returns the task id.",
      input: z.strictObject({
        title: z.string().trim().min(1).max(120),
        prompt: z.string().trim().min(1).max(12_000),
        role: reference.default("developer"),
        capability: capability.default("implement"),
        complexity: z.enum(["low", "medium", "high"]).optional(),
        dependsOn: z.array(reference).max(10).default([]),
      }),
      async execute(input, { agent }) {
        try {
          const child = await port.delegate(agent.id, input);
          return { text: `Delegated ${child.id} (${child.status}).`, structuredContent: child };
        } catch (error) {
          return { isError: true, text: error instanceof Error ? error.message : "Could not delegate the task." };
        }
      },
    }),
    defineAgentTool({
      name: "zelqio_status",
      title: "Status of delegated tasks",
      description: "List the delegated tasks with their status, the model they run on and, once delivered, their result.",
      input: z.strictObject({}),
      async execute(_input, { agent }) {
        const children = await port.children(agent.id);
        return { text: text(children), structuredContent: children };
      },
    }),
    defineAgentTool({
      name: "zelqio_wait",
      title: "Wait for delegated tasks",
      description: "Wait until every delegated task is delivered, failed or stopped, or until the timeout. Returns the same listing as zelqio_status.",
      input: z.strictObject({ timeoutSeconds: z.number().int().min(1).max(600).default(120) }),
      async execute(input, { agent, signal }) {
        const deadline = Date.now() + input.timeoutSeconds * 1000;
        for (;;) {
          const children = await port.children(agent.id);
          const open = children.some(child => child.status === "queued" || child.status === "running" || child.status === "waiting_quota");
          if (!open || Date.now() >= deadline || signal.aborted) return { text: text(children), structuredContent: children };
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      },
    }),
    defineAgentTool({
      name: "zelqio_cancel",
      title: "Stop a delegated task",
      description: "Stop coordinating one delegated task that is not finished.",
      input: z.strictObject({ id: reference }),
      async execute(input, { agent }) {
        try {
          const child = await port.cancel(agent.id, input.id);
          return { text: `Stopped ${child.id}.`, structuredContent: child };
        } catch (error) {
          return { isError: true, text: error instanceof Error ? error.message : "Could not stop the task." };
        }
      },
    }),
  ];
}
