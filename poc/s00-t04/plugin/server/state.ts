import { appendFileSync } from "node:fs";

export interface Binding {
  agentId: string;
  role: string;
  runId: string;
  allowed: string[];
  issuedAt: string;
}

const ROLE_ACTIONS: Record<string, string[]> = {
  orchestrator: ["report", "delegate"],
  worker: ["report"],
};

export const registry = new Map<string, Binding>();
export const events: unknown[] = [];
export const controlState = {
  vetoCreateWhen: "none" as "none" | "provider",
  vetoProvider: undefined as string | undefined,
  denyChildrenOfManaged: false,
};

export function bind(agentId: string, role: string, runId: string): Binding {
  const binding: Binding = {
    agentId,
    role,
    runId,
    allowed: ROLE_ACTIONS[role] ?? [],
    issuedAt: new Date().toISOString(),
  };
  registry.set(agentId, binding);
  return binding;
}

export function log(kind: string, data: Record<string, unknown>): void {
  const entry = { t: new Date().toISOString(), kind, ...data };
  events.push(entry);
  const file = process.env.ZF_POC_LOG;
  if (file) appendFileSync(file, `${JSON.stringify(entry)}\n`);
}
