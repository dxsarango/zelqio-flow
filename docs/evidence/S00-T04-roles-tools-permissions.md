# S00-T04 — Roles, tools and permissions (POC-04 / POC-05 / POC-06)

Date: 2026-11-25/26 (UTC). Environment: Paseo 0.17.4, `@getpaseo/plugin` 0.17.4 (bundled), Windows 11, Node 24.21, Claude Code 2.1.331, Codex CLI 0.172.0, OpenCode 1.19.6.

> **Progress note** — DONE: all work below (static review, isolated daemon, POC plugin, runtime runs, matrix, write-up). PENDING: none inside this task. Open items belong to G0/ADR (see "Decisions for G0"). The isolated daemon is stopped at the end of the task.

## 1. Result summary

| POC | Verdict | One line |
|---|---|---|
| POC-04 direct agent creation without Agent Profiles | **PASS** | `paseo.agents.create({ agentId?, cwd, config: { provider: "p/model", modeId, thinkingOptionId, options, toolPolicy } })` from a plugin server handler; verified on OpenCode, Claude, Codex. No profile referenced anywhere. |
| POC-05 per-session tools + caller identity + per-call authz (blocking) | **PASS with conditions** | Tools are injected before the first turn through `agent.open.before`, only for agents the plugin registered. The Paseo-MCP route resolves the caller from a URL query parameter and is **spoofable**; the identity-safe route is a **plugin-hosted MCP server with a per-session bearer secret** (verified end to end on OpenCode and Codex, authenticated connect on Claude). OpenCode never shows plugin `tools` to the model. |
| POC-06 restriction matrix | **PASS as matrix; several cells NOT RUN** | Per-session restrictions exist and were verified for Claude (Bash/Task/Agent) and OpenCode (bash). Paseo's own tool set can only be restricted globally per provider. Anti-recursion is technical only for the paths below; otherwise behavioral. |

Fallback status (TECHNICAL-FEASIBILITY): POC-04 and POC-05 did **not** fail, so the blocking fallback is not triggered. POC-05 passes only with the own-MCP route; using the Paseo-MCP route alone for authorization would be a FAIL (check 05.3).

## 2. Isolation and method

- Own daemon: `<sandbox>/home-t04`, `127.0.0.1:16774` (`paseo daemon config set/start --home`). The regular daemon (`127.0.0.1:6767`, same pid before and after) and its home, plugins, profiles and provider auth/config files were not touched or read. Providers are the user's installed CLIs; the isolated daemon did not read credentials (provider CLIs use their own login state, shared by definition).
- In the isolated home only: `pluginsEnabled=true` (plugins are globally off by default), `daemon.mcp.injectIntoAgents` true/false as stated per check, plugin `zf-poc-t04` installed by path.
- Fixtures: `<sandbox>/fixtures/app` (disposable git clone from S00-T01). No real project.
- Static reading: bundled `@getpaseo/{plugin,protocol,server,client,cli}` 0.17.4 JS copied read-only out of the asar with Electron-as-node into `<sandbox>` (not committed). **The bundle ships no `.d.ts`**, so API shapes were verified from runtime JS/zod schemas and by running them; the POC uses `as never` casts where types were unavailable. File references below are relative to `@getpaseo/server/dist/server/server/` unless noted.
- Metadata marks are not authentication (SECURITY.md); no check below relies on one.

## 3. POC-04 — direct creation

| # | Check | Result | Evidence |
|---|---|---|---|
| 04.1 | A plugin/server API creates agents with provider, model, mode, thinking | **PASS** | `@getpaseo/client` `createPaseoApi().agents.create` → `daemonClient.createAgent`; `toDaemonAgentCreateOptions` maps `config.provider` (`"provider/model"`), `modeId`, `thinkingOptionId`, `options`→`providerOptions`, `parent`, `prompt`. Plugin handlers receive `{ paseo }` (`plugins/plugin-process.js`). |
| 04.2 | OpenCode: `opencode/<free-model>`, mode `plan` | **PASS** | `agent inspect`: Provider opencode, Model deepseek-v4.1-flash-free, Mode plan, Thinking auto, status idle (no prompt, no inference). |
| 04.3 | Claude: `claude/claude-sonnet-5-5`, mode `default` | **PASS** | Created without prompt; inspect shows Provider claude, Model claude-sonnet-5-5, Mode default. |
| 04.4 | Codex: `codex/gpt-6-luna`, mode `auto`, options `sandbox_mode`, `features.multi_agent_v2` | **PASS** | Created without prompt; inspect shows Provider codex, Model gpt-6-luna, Mode auto (Thinking reports provider default `high`). |
| 04.5 | No Agent Profile used or required | **PASS** | `config.json` of the isolated home has no `agentProfiles`; the create call carries only direct fields. |
| 04.6 | Caller-chosen `agentId` is honored (lets the plugin register a role **before** creation) | **PASS** | Returned id equals the pre-assigned UUID in every creation (`results/events.sanitized.jsonl`, `rpc.create_direct` vs `hook.agent.create.after`). |
| 04.7 | Explicit non-default `thinkingOptionId` applied | **NOT RUN** | Only `auto` (the default) was passed. |
| 04.8 | Changing provider inside an existing session | **NOT RUN** | Out of scope; ROUTING-POLICY already forbids it without a supported mechanism. |
| 04.9 | `agent.create.before` can veto/modify provider/model/mode | **PASS** | Request keys are only `config`, `env`, `metadata` (no agentId, no caller). A hook that throws aborts creation: `Plugin … agent.create.before failed: zf-poc: creation vetoed by plugin policy`; no agent was created. |

Conclusion: POC-04 **PASS**. Limitation: failed creation after pre-registration leaves an orphan registry entry (observed once: `toolPolicy` rejected after `bind`); a real implementation must register-then-create with rollback.

## 4. POC-05 — tools, identity, authorization

Mechanisms found in 0.17.4 (runtime-verified unless stated):
- `server.addHook("agent.open.before", ({ request }) => …)` (legacy alias `server.before("agent.session_open")`) fires on every session open (`reason` create/resume/refresh/import; `purpose` interactive/history) **before the first turn**. It may change only `env`, `tools`, `mcpServers`, `appendSystemPrompt`; changing anything else throws (`plugins/lifecycle/index.js`). `request.agentId` is assigned by the daemon.
- `tools: [defineAgentTool({ name, input: zod, execute(input, { agent, paseo, signal }) })]` live in the plugin process; `ctx.agent.id` comes from the daemon attach map (`agent-manager.js` `executePluginTool`), not from the model.
- Plugin tools are delivered **only through Paseo's native tool channel** and are filtered by the same provider policy as Paseo's own tools (`agent/tools/plugin-tools.js`).

| # | Check | Result | Evidence |
|---|---|---|---|
| 05.1 | Tools attached for a registered agent before its first task | **PASS** | Hook ran with `reason:"create"` at agent creation; MCP `tools/list` for the new worker: 44 tools (42 Paseo + `zf_whoami`, `zf_action`) before any prompt. |
| 05.2 | Unregistered/unmanaged agent untouched | **PASS** | Hook returned `undefined`; same endpoint lists 42 tools for an unregistered agent; calling `zf_*` fails with tool-not-found. |
| 05.3 | Caller identity on the Paseo-MCP route is authentic | **FAIL** | The daemon takes `callerAgentId` from the URL query (`bootstrap.js` ~L1290; `agent/runtime-mcp-config.js` builds `…/mcp/agents?callerAgentId=<id>`). Without a daemon password `isAgentMcpRequestAuthorized` returns `true` for everyone (`auth.js:100`); with a password all agents share one capability token. Runtime: an unrelated process called `zf_action {"action":"delegate"}` with the orchestrator's id and got `ok:delegate`; an arbitrary id (`bogus-id`) obtained the full 42-tool Paseo catalog incl. `create_agent`, `kill_agent`. A worker that can run a shell/HTTP request can do the same. |
| 05.4 | Per-call authorization by role / run / action (Paseo route, real id) | **PASS** | `zf_action`: worker+report → allow; worker+delegate → `deny:role-worker-cannot-delegate`; worker with declared `runId` ≠ registered → `deny:run-mismatch`; orchestrator+delegate → allow. Real Codex call as worker: `deny:role-worker-cannot-delegate` (server log `tool.zf_action`). Model-supplied `runId` is never used as identity. |
| 05.5 | Plugin `tools` end to end through the real provider: Claude | **PASS** | Claude (mode default) called `mcp__paseo__zf_whoami`; native permission prompt (not bypassed); server saw `callerAgentId` = that agent and returned role worker, run run-A. |
| 05.6 | … Codex | **PASS** | Codex called `zf_action` on server `paseo` after a native MCP elicitation; server decision logged with its id. |
| 05.7 | … OpenCode | **FAIL** | The model lists only `paseo_*` built-ins; two prompts confirmed it cannot see `zf_whoami`. Cause (static): the OpenCode bridge plugin builds its tool list once from the global manifest (`agent/providers/opencode/bridge-plugin.bundle.mjs`, `GET /tools` without session), so per-agent plugin tools never appear. |
| 05.8 | Plugin-hosted MCP server with per-session secret via hook `mcpServers` (headers `Authorization: Bearer <random>`) resolves identity from the secret | **PASS** | OpenCode and Codex called `zf_own_whoami`; server returned `{agentId, role}` derived from the token. Claude connected with the token (`initialize`, `tools/list` authenticated as its agent; no call made). Wrong/absent token → HTTP 401 and `ownmcp.denied` logged. |
| 05.9 | Own-MCP route works without the global `mcp.injectIntoAgents` switch | **PASS** | With `daemon.mcp.injectIntoAgents=false` (restart), OpenCode still connected with the bearer and resolved its agent id; the Paseo-route `tools/list` for the same agent failed (no Paseo MCP). |
| 05.10 | Paseo-route plugin tools work with the **default** daemon config | **FAIL** | `mcp.injectIntoAgents` defaults to `false` (`config.js:349`); then `paseoToolPolicy={enabled:false}` and plugin tools are not delivered (observed: managed agent got `-32601 Method not found`). Enabling it is a global, consent-requiring change (SECURITY: no global rule changes without consent) and also exposes all Paseo tools (`create_agent`, `kill_agent`…) to every agent of every provider. |
| 05.11 | `config.toolPolicy.preapproved` can pre-approve a plugin-injected tool | **FAIL** | Rejected: `toolPolicy preapproval 'paseo.zf_whoami' requires MCP server 'paseo' in the same agent request`. Every call needs a native supervised approval (done once by hand per check). Pre-approval with a declared own-MCP server: **NOT RUN**. |
| 05.12 | Role registry survives a plugin reload/restart | **FAIL** (POC is in-memory by design) | After `plugin reload`, a previously managed agent no longer had `zf_*` tools and was absent from the registry. Requirement for POC-12: persist the registry and re-attach on every `agent.open.before` (resume/refresh included). |
| 05.13 | Own-MCP secret is unreadable by other local processes of the same OS user | **NOT RUN** | Not tested; assume a same-user process can read provider launch arguments/environment. The secret prevents model-level and cross-agent spoofing, not a hostile same-user process. |

Conclusion: POC-05 **PASS with conditions**. Authorization-critical Zelqio tools (delegate, integrate, publish…) must be served by the **plugin-hosted MCP server keyed by a per-session secret** (works on all three providers, needs no global setting). Plugin `tools` over the Paseo route are acceptable only for non-sensitive helpers, and never for OpenCode.

## 5. POC-06 — restrictions

| # | Check | Result | Evidence |
|---|---|---|---|
| 06.1 | Native Paseo MCP on/off | **PASS** | Global only: `daemon.mcp.injectIntoAgents` / `mcp.enabled`. `injectIntoAgents=false` → agent-scoped catalogs are empty (no Paseo tools, no plugin `tools`; observed `-32601`). The `/mcp/agents` endpoint itself keeps serving callers without `callerAgentId` (top-level catalog of 42 tools listed with no credentials). |
| 06.2 | Provider-level Paseo tool policy | **PASS** | `agents.providers.opencode.paseoTools.disabledTools=["create_agent","send_agent_prompt","kill_agent"]` (applied live) removed them from new sessions; plugin tools unaffected. |
| 06.3 | …per session (managed only) | **FAIL** | Same policy removed them for the unmanaged control agent too; existing agents kept the old policy until reopened. Policy is resolved per provider (`agent/paseo-tool-policy.js`), never per agent. |
| 06.4 | Claude per-session `providerOptions.disallowedTools` | **PASS** | With `["Bash","Task","Agent"]` the model reported no shell tool and no subagent tool (model-reported, one prompt). Schema also allows `allowedTools`, `additionalDirectories`, `extraArgs`, `sandbox` (`claude/options.js`). |
| 06.5 | OpenCode per-session `providerOptions.permission.bash="deny"` | **PASS** | Denied worker: "no bash tool is available"; control worker without it paused on a native `bash` permission (then denied by hand). |
| 06.6 | OpenCode `permission.task="deny"` (native subagent) | **NOT RUN** | Key exists in the strict schema (`opencode/options.js`); not exercised. The schema cannot name `paseo_*` tools, so Paseo's `paseo_create_agent` cannot be denied per session. |
| 06.7 | Codex native subagents (`features.multi_agent_v2:false`) and `sandbox_mode` effect | **NOT RUN** | Options accepted at creation (strict schema, `codex/options.js`); runtime effect not exercised. Codex mode `auto-review` routes approvals through an auto-reviewer subagent (static). Codex has no per-session switch that removes the shell tool. |
| 06.8 | Claude per-session deny of `mcp__paseo__create_agent` etc. | **NOT RUN** | Mechanism exists (`disallowedTools`) but was not exercised (Claude prompt budget). |
| 06.9 | A managed worker can spawn children through Paseo `create_agent` (recursion path) | **FAIL (open by default)** | OpenCode worker called `create_agent` via the endpoint → child created (`parentAgentId` = worker, label `paseo.parent-agent-id`). |
| 06.10 | Technical prevention of 06.9 by the plugin | **PASS** (OpenCode runtime; hook is provider-agnostic) | `agent.create.before` cannot see the parent, but `agent.open.before` receives `labels["paseo.parent-agent-id"]`; throwing there aborted the child (`Plugin … agent.open.before failed: zf-poc: managed agents may not create child sessions`; no agent persisted). The same call from an **unmanaged** agent succeeded (control). |
| 06.11 | Prevention holds against a worker with a shell | **FAIL / NOT RUN** | A shell-capable worker can call the unauthenticated MCP route directly (05.3) and the parent label follows the claimed `callerAgentId`; the CLI path (`PASEO_AGENT_ID` env) was not exercised. Only denying the shell tool, or authenticating the route, closes this. |
| 06.12 | Permission modes enumerated; no escalation as fallback | **PASS** | Claude: plan, default, acceptEdits, **auto**, **bypassPermissions**. Codex: auto, **auto-review**, **full-access** (never prompts, `danger-full-access`). OpenCode modes build/plan plus composer option `auto_accept`. All runs used default supervised modes; MCP tool calls always paused for a native permission, approved individually (4 allowed, 2 denied; none auto). |
| 06.13 | Unmanaged sessions unaffected by plugin logic | **PASS** | Unregistered agents: no tools, no veto, hook returned `undefined`. **Global** knobs (`injectIntoAgents`, provider `paseoTools`) do affect every session. |
| 06.14 | User's own native MCP servers (Claude `settingSources` user/project/local, Codex config) can be disabled per session | **NOT RUN** | Static only: Claude loads user/project/local setting sources (`claude/agent.js` `CLAUDE_SETTING_SOURCES`); no per-session switch found. |
| 06.15 | Daemon pushes provider launch config (headers, URL, `callerAgentId`) into agent processes | **PASS (static)** | `runtime-mcp-config.js`; agent processes can therefore read their own Paseo MCP URL/token. |

## 6. Restriction matrix

Legend: ✔ verified at runtime, ◐ verified in part or by static reading only, ✘ not possible / failed, ○ NOT RUN.

| Provider | Tool injection per session | Caller identity | MCP on/off | Per-session override | Native subagents | Shell restriction | Anti-recursion |
|---|---|---|---|---|---|---|---|
| **claude** | ✔ Paseo `tools` (model called it); ✔ own MCP via hook `mcpServers` (authenticated connect) | Paseo route: ✘ spoofable (URL param). Own MCP + bearer: ✔ | Global only (`injectIntoAgents`, provider `paseoTools`); user's own MCP servers ◐ not disableable per session | ✔ `providerOptions` `allowedTools`/`disallowedTools`/`sandbox`/`extraArgs`; modes incl. `auto`/`bypassPermissions` exist | ✔ `Task`/`Agent` deniable per session (model-reported) | ✔ `Bash` deniable per session (model-reported); also deny `PowerShell` ○ | **Technical** if `Bash`+`Task`+`Agent` denied, `mcp__paseo__create_*`/`kill_agent` denied (○) and `agent.open.before` parent-label veto (✔ on OpenCode path). **Behavioral** if the shell is left available |
| **codex** | ✔ Paseo `tools` (called `zf_action`); ✔ own MCP (called `zf_own_whoami`) | Paseo route ✘ spoofable. Own MCP + bearer ✔ | Global only; `~/.codex` servers ◐ not disableable per session | ◐ strict `providerOptions` (`approval_policy`, `sandbox_mode`, `web_search`, `features.multi_agent_v2`) accepted; effect ○ | ○ `multi_agent_v2:false` accepted, effect not run; `auto-review` mode adds a reviewer subagent | ✘ no way to remove the shell; `sandbox_mode` restricts writes (○) | **Behavioral** for shell-capable paths; technical only for the Paseo-MCP creation path via the open-hook veto. Treat as limited |
| **opencode** | ✘ Paseo `tools` invisible to the model (global manifest); ✔ own MCP (called `zf_own_whoami`) | Own MCP + bearer ✔. Native bridge binds OpenCode session→agent in the daemon (static, not URL based) but exposes only the global manifest | Global only | ✔ `providerOptions.permission` per tool (`bash`, `edit`, `task`, `webfetch`…); cannot target `paseo_*` | ○ `permission.task` | ✔ `permission.bash="deny"` (tool removed; control prompted) | **Technical** with bash denied + open-hook parent veto (✔ both). `paseo_create_agent` cannot be denied per session, only globally |

## 7. Modes and providers to block or limit

Block outright for managed workers/orchestrator (SECURITY: no Auto Accept/bypass/full access as fallback):
- Claude modes `bypassPermissions` and `auto`; Codex modes `full-access` and `auto-review`; OpenCode `providerOptions.auto_accept` and any blanket `permission: "allow"`.
- `acceptEdits` (Claude) auto-approves edits: allow only when the project policy permits unattended edits (documented limit).

Require documented limits / explicit consent:
- **Codex**: shell cannot be removed and subagent disabling is unverified → anti-recursion is behavioral on the shell path. Allow as worker only with that limit documented, or exclude until POC-07/05 follow-up proves otherwise.
- **OpenCode**: only via the own-MCP route; Zelqio tools are invisible through plugin `tools`. Recursion control needs `bash` denied plus the open-hook veto.
- **Any provider**: shell-capable workers can reach the unauthenticated Paseo MCP route; either deny the shell, or require a daemon password **and** accept that all agents share one capability token (static, not run). Enabling `daemon.mcp.injectIntoAgents` or editing provider `paseoTools` is a global change affecting unmanaged sessions: do not apply silently.
- Zelqio's own MCP secret protects against model-level and cross-agent spoofing only (05.13 NOT RUN).

## 8. Decisions for G0 / ADR (input only; no scope change made)

1. Authorization-critical tools run on a plugin-hosted MCP server with per-session secrets minted in `agent.open.before`; Paseo-route `tools` only for non-sensitive helpers. Revoke/rotate the secret on every open and on task end.
2. Register agent identity **before** creation (caller-chosen `agentId`), with rollback on failure and persistence across plugin/daemon restart (POC-12).
3. Anti-recursion = (a) never hand workers a Zelqio delegate tool, (b) parent-label veto in `agent.open.before`, (c) per-session denial of shell/native-subagent tools where the provider supports it, (d) otherwise document as behavioral. Do not rely on `callerAgentId` for any security decision.
4. Minimum Paseo version: hooks and `agent.open.before` `tools`/`mcpServers` are present in 0.17.4; do not assume later APIs.

## 9. Reproduction

Placeholders: `<paseo-install>` Paseo install dir, `<sandbox>` scratch dir outside the repo, `<repo>` this checkout. Use Git Bash or PowerShell equivalents; never run `Paseo.exe` without `ELECTRON_RUN_AS_NODE=1`.

```
P=<paseo-install>/resources/bin/paseo.cmd; H=<sandbox>/home-t04; L=127.0.0.1:16774
$P daemon config set --home $H daemon.listen $L
$P daemon config set --home $H pluginsEnabled true
$P daemon config set --home $H daemon.mcp.injectIntoAgents true      # false for check 05.9/05.10
export ZF_POC_LOG=<sandbox>/events.jsonl
$P daemon start --home $H
$P plugin install <repo>/poc/s00-t04/plugin --home $H                 # id zf-poc-t04
export ELECTRON_RUN_AS_NODE=1
R="<paseo-install>/Paseo.exe <repo>/poc/s00-t04/driver/rpc.mjs $H $L zf-poc-t04"
M="<paseo-install>/Paseo.exe <repo>/poc/s00-t04/driver/mcp.mjs $L"
C='"cwd":"<sandbox>/fixtures/app"'
$R poc.create_direct '{"role":"worker","runId":"run-A","provider":"opencode/<free-model>","modeId":"plan",'$C'}'   # 04.1-04.6
$P agent inspect <agentId> --home $H --json
$M <agentId> list                                                     # 05.1 (44 tools) ; unregistered id -> 42
$M <agentId> call zf_action '{"action":"delegate"}'                   # 05.4 deny for worker
$M <orchestratorId> call zf_action '{"action":"delegate"}'            # 05.3 spoof from an unrelated process -> ok
$R poc.control '{"denyChildrenOfManaged":true}'                       # 06.10
$M <workerId> call create_agent '{"provider":"opencode/<free-model>","initialPrompt":"Reply OK","background":true}'
$P daemon config set --home $H agents.providers '{"opencode":{"paseoTools":{"disabledTools":["create_agent"]}}}'   # 06.2/06.3
$P daemon config unset --home $H agents.providers
$R poc.create_direct '{...,"provider":"opencode/<free-model>","options":{"permission":{"bash":"deny"}}}'           # 06.5
$R poc.create_direct '{...,"provider":"claude/claude-sonnet-5-5","modeId":"default","options":{"disallowedTools":["Bash","Task","Agent"]}}'  # 04.3/06.4
$P agent send <id> "<prompt>" --home $H ; $P permit ls --home $H --json ; $P permit allow|deny <agentId> <requestId> --home $H
$P daemon stop --home $H                                              # always at the end
```

Model ids come from `paseo provider models <provider> --home $H`; they change over time.

## 10. Commands actually run (all with `--home <sandbox>/home-t04`, host `127.0.0.1:16774`)

`paseo --version`; `daemon config set|unset` (listen, pluginsEnabled, daemon.mcp.injectIntoAgents, agents.providers); `daemon start|stop|status`; `plugin install|ls|logs|reload`; `provider models <p>`; `agent ls|inspect|send|logs`; `permit ls|allow|deny`; driver `rpc.mjs` (RPCs `poc.create_direct`, `poc.dump`, `poc.control`); driver `mcp.mjs` (`list`, `call`); `curl` against the plugin MCP port (401 checks). Read-only extraction of the bundled `@getpaseo/*` JS with Electron-as-node.

## 11. Inference used

Claude: 2 trivial prompts (tool call; tool-category listing). Codex: 2 trivial prompts (tool calls). OpenCode free models: 8 trivial prompts. No paid API/credits, no Auto Accept/bypass; every tool permission was individually allowed (4) or denied (2) by hand. Log: `poc/s00-t04/results/inference-log.txt`; plugin events: `poc/s00-t04/results/events.sanitized.jsonl`.

## 12. Limitations

- Type definitions are not shipped in the bundle; shapes come from runtime JS and execution. Behavior is specific to 0.17.4.
- Provider-level claims about what a model "has" (Claude Bash/Task absence, OpenCode bash absence) are model-reported from a single prompt each, not from the provider's tool manifest.
- Single OS user, loopback only; no relay, remote hosts, or daemon password were exercised.
- `agent.open.before` veto was exercised through OpenCode only; Claude/Codex use the same daemon code path but were not run.
- Untested cells are marked NOT RUN above and must not be read as PASS. The isolated daemon runs a background speech-model download of its own (observed in its log); it is not part of Zelqio and no traffic inspection was done here (POC-16).
