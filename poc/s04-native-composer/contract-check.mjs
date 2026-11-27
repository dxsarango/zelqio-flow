// Static contract check of the Paseo plugin SDK type declarations. No dependencies, no daemon.
// Usage: node contract-check.mjs <sdk-0.17.5-root> [<sdk-0.17.4-root>]
// <sdk-root> is the directory that contains node_modules/@getpaseo. Output is one line per check.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const [new_, old] = process.argv.slice(2);
if (!new_) {
  console.error("usage: node contract-check.mjs <sdk-0.17.5-root> [<sdk-0.17.4-root>]");
  process.exit(2);
}
const dist = (root, ...p) => join(root, "node_modules", "@getpaseo", "plugin", "dist", ...p);
const proto = (root, ...p) => join(root, "node_modules", "@getpaseo", "protocol", "dist", ...p);
const read = (f) => readFileSync(f, "utf8");
const sha = (f) => createHash("sha256").update(read(f).replace(/\r\n/g, "\n")).digest("hex").slice(0, 12);
// Body of `export interface <name> ... {` up to its matching brace.
function block(src, header) {
  const start = src.indexOf(header);
  if (start < 0) return null;
  let depth = 0, i = src.indexOf("{", start);
  const begin = i;
  for (; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return src.slice(begin, i + 1);
  }
  return null;
}

const results = [];
const check = (name, ok, detail) => results.push({ name, ok: Boolean(ok), detail });

const composer = read(dist(new_, "client", "composer.d.ts"));
const contracts = read(dist(new_, "client", "contracts.d.ts"));
const buttons = read(dist(new_, "client", "buttons.d.ts"));
const lifecycle = read(dist(new_, "server", "lifecycle.d.ts"));
const messages = read(proto(new_, "messages.d.ts"));
const pluginComposer = block(composer, "export interface PluginComposer {");
const members = [...pluginComposer.matchAll(/^\s{4}(?:readonly )?(\w+)[(:?]/gm)].map((m) => m[1]);

check("C1 PluginComposer top-level members", true, members.join(","));
check("C1 no submit/send/before-send member in PluginComposer",
  !members.some((m) => /submit|send|beforeSend|onSend|intercept/i.test(m)), "members listed above");
const agentBlock = block(pluginComposer, "readonly agent: {");
check("C1 composer.agent has no provenance field (source/origin/explicit/default)",
  !/source|origin|explicit|isDefault|provenance/i.test(agentBlock), agentBlock.replace(/\s+/g, " ").slice(0, 160));
check("C1 composer exposes no draft or workspace identity", !/draftId|workspaceId|composerId|\bid\b/.test(pluginComposer),
  "no id-like member in PluginComposer");
check("C1 composer does not expose a locked state (only command rejection)", !/locked/i.test(pluginComposer),
  "lock is documented as command rejection only");
check("C1 composer pill requires agentId (running agent only)",
  /interface PluginComposerPillContribution[^{]*\{\s*agentId: string;/.test(buttons), "PluginComposerPillContribution.agentId: string");
check("C1 addComposerItem contributes for every composer context",
  /addComposerItem\(contribution: PluginComposerItemContribution\)/.test(contracts), "single registration, context in useComposer()");
const slashStart = contracts.indexOf("export type PluginClientSlashCommandContribution");
const slash = contracts.slice(slashStart, contracts.indexOf("export type SettingsState", slashStart));
check("C1 client slash commands exist only for workspace|agent context (no draft context)",
  /context: "workspace"/.test(slash) && /context: "agent"/.test(slash) && !/context: "draft"/.test(slash), "slash command contexts");

const reqs = block(lifecycle, "export interface PluginHookRequests {");
const create = block(reqs, '"agent.create.before": {');
check("S1 agent.create.before request fields", true, create.replace(/\/\*\*[\s\S]*?\*\//g, "").replace(/\s+/g, " "));
check("S1 agent.create.before carries workspaceId (read-only) and metadata", /readonly workspaceId: string \| null/.test(create) && /metadata\?:/.test(create), "");
check("S1 agent.create.before carries no prompt and no provenance", !/prompt|provenance|origin|source/i.test(create), "");
const events = block(lifecycle, "export interface PluginHookEvents {");
check("S2 agent.turn.before is an event, not a request (cannot change config)",
  /"agent.turn.before"/.test(events) && !/"agent.turn.before"/.test(reqs), "declared in PluginHookEvents only");
check("S3 workspace.create.before request is the protocol WorkspaceCreateRequest",
  /"workspace.create.before": Omit<WorkspaceCreateRequest/.test(reqs), "");
check("S3 protocol FirstAgentContext declares an optional prompt (population at runtime NOT RUN)",
  /FirstAgentContextSchema[\s\S]{0,80}prompt: z\.ZodOptional<z\.ZodString>/.test(messages), "");
const sessionConfig = block(read(proto(new_, "agent-types.d.ts")), "export interface AgentSessionConfig {");
check("S4 AgentSessionConfig has optional model (absent for SDK callers that omit it) and no provenance",
  /model\?: string/.test(sessionConfig) && !/provenance|origin/i.test(sessionConfig), "");

// Option D: what a plugin can do to create an agent itself (client SDK shared by the plugin API).
const sdk = read(join(new_, "node_modules", "@getpaseo", "client", "dist", "index.d.ts"));
const createOptions = block(sdk, "export interface PaseoAgentCreateOptions {");
check("D3 create options carry config, cwd, prompt, metadata, idempotencyKey and agentId",
  ["config: PaseoAgentConfig", "cwd: string", "prompt?: string", "metadata?:", "idempotencyKey?: string", "agentId?: string"].every((f) => createOptions.includes(f)), "");
const agentConfig = block(sdk, "export interface PaseoAgentConfig {");
check("D3 agent config carries provider/model, modeId, thinkingOptionId, options, toolPolicy, mcpServers",
  ["provider: string", "modeId?", "thinkingOptionId?", "options?", "toolPolicy?", "mcpServers?"].every((f) => agentConfig.includes(f)), "");
check("D3 prompt is optional, so an agent can be created idle and verified before the first message", /prompt\?: string/.test(createOptions), "");
const handle = block(sdk, "export interface PaseoAgentHandle {");
check("D3 agent handle exposes send, options, runtimeInfo, metadata, availableModes and refresh",
  ["send(text: string", "readonly options:", "readonly runtimeInfo:", "readonly metadata:", "readonly availableModes:", "refresh("].every((f) => handle.includes(f)), "");
check("D3 workspaces.create accepts a first agent and workspace.agents.create exists",
  /agent\?: Omit<PaseoAgentCreateOptions/.test(sdk) && /agents: \{\s*create\(options: PaseoWorkspaceAgentCreateOptions\)/.test(sdk), "");
check("D3 the plugin client context offers screens, workspace panels and Command Center items",
  ["addScreen(", "addWorkspacePanel(", "addCommandCenterItem("].every((f) => contracts.includes(f)), "");

if (old) {
  for (const f of ["composer.d.ts", "new-workspace.d.ts", "contracts.d.ts", "buttons.d.ts"]) {
    const a = sha(dist(old, "client", f)), b = sha(dist(new_, "client", f));
    check(`D1 client/${f} identical between versions`, a === b, `${a} vs ${b}`);
  }
  const lifeOld = read(dist(old, "server", "lifecycle.d.ts"));
  const oldCreate = block(block(lifeOld, "export interface PluginHookRequests {"), '"agent.create.before": {');
  check("D2 0.17.4 agent.create.before has no workspaceId", !/workspaceId/.test(oldCreate), "");
}

let failed = 0;
for (const r of results) {
  if (!r.ok) failed++;
  console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}${r.detail ? "  | " + r.detail : ""}`);
}
console.log(`${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
