# S00-T02 — Composer contract and initial routing (POC-01, POC-02)

Date: 2026-11-25 (UTC-5). Progress note: **DONE** — all runs below were executed once by the author; stale items are listed under "Not run". Nothing here is product code; the POC plugin under `poc/s00-t02/` is disposable.

Result summary: **POC-01 PASS** for the public-SDK surfaces, opt-in, persistence and draft metadata (with the caveats in "Findings that change the design"). **POC-02 PASS** for creation-hook routing before inference, fail-closed behaviour, manual-change handling and non-opted-in sessions untouched. Several adjacent checks are `NOT RUN` (listed explicitly); a PASS never extends beyond its row.

## Versions and environment

| Item | Value |
|---|---|
| Paseo daemon / app / `@getpaseo/plugin` SDK | 0.17.4 (win32 x64); SDK read from the installed app's bundled `node_modules` |
| Node.js (system) / Electron-as-node | 24.21.0 / 24.20.0 (`ELECTRON_RUN_AS_NODE=1`) |
| Browser used to render the app's web build | Chrome 158.0.8127.37, headless, empty profile |
| OS | Windows 11 Pro 10.0.26200 |
| Reference studied (not installed, not copied) | `DueGin/paseo-ensemble` tag `v0.6.5` (`8b3e4af57fa36ca4f7d1050571d3157179cd6840`), MIT. Used only to confirm that `useComposer().setMetadata` carries draft metadata and that `registerSettings` + `defineSettings` store host settings. No code copied. |
| npm dependencies added | none (zod and the SDK are host-supplied modules; `compiler-esbuild` lists `zod` among `SERVER_HOST_MODULES`) |

Placeholders: `<paseo-install>` = directory containing `Paseo.exe`; `<sandbox>` = directory outside the repository holding the isolated daemon home, fixtures and scratch files; `<repo>` = this repository checkout.

## Isolation

- Own daemon: `paseo daemon config set --home <sandbox>/home-t02 daemon.listen 127.0.0.1:16772`, `pluginsEnabled true`, relay disabled, started with `--home`. Every CLI call used `--home <sandbox>/home-t02`. The POC plugin was installed only there. The regular daemon, its home, plugins, settings and provider auth files were not touched or read.
- The web build of the app (static files from `<paseo-install>/resources/app-dist`, read-only) was served on `127.0.0.1:16773`; the isolated daemon's `daemon.cors.allowedOrigins` (its own `config.json`) got that origin added.
- The app's web build has a built-in default host `localhost:6767` (the regular daemon). The browser was launched with `--host-resolver-rules="MAP localhost ~NOTFOUND"` so that host cannot resolve, and after the run the browser's host registry contained exactly one connection: `directTcp:127.0.0.1:16772`.
- Fixture: `<sandbox>/fixtures/app` (local repo with one commit). No real project used.
- At the end: browser, static server and daemon were stopped (`paseo daemon stop --home …` → `localDaemon: stopped`; ports 16772/16773/9334 closed).

## Inference used

OpenCode free models only (`opencode/mimo-v2.6-flash-free`, `opencode/beam-free`), prompt `Reply OK` (the model replied `OK`). The hook trace recorded 9 `agent.turn.before` events, every one with `provider=opencode`; `paseo ls --home …` lists only `opencode` agents. **No Claude or Codex inference** and no paid API. Requests that *named* `codex/gpt-5.5` were rewritten by the hook before any session existed. The provider usage percentages visible in the app sidebar come from the daemon's usage sources, not from inference. Note: an early version of `run-headless.ps1` launched the GUI-subsystem `Paseo.exe` without piping its output, so PowerShell did not wait and the scenarios ran in the background; this duplicated some free-model prompts (the script now pipes to `Out-String`).

## What was built (disposable)

`poc/s00-t02/plugin/` — `paseo-plugin.json` (`requirements.paseo ">=0.17.4 <0.18.0"`), `index.client.tsx`, `index.server.ts`, `shared/contract.ts`.
`poc/s00-t02/scripts/` — `driver.mjs` (headless creation through the public `@getpaseo/client` API), `run-headless.ps1`, `serve-app.mjs`, `cdp.mjs` (dependency-free Chrome DevTools Protocol helper), `ui-session.ps1`.

## SDK surfaces verified in 0.17.4 (runtime, not documentation)

The package `@getpaseo/plugin@0.17.4` ships JavaScript only (no `.d.ts`), so types could not be checked; the surfaces below were verified by reading the shipped runtime/app bundle and then exercising them.

| Need | Surface (public SDK) | Evidence |
|---|---|---|
| Control in the **New Agent** composer | `client.addComposerItem({ id, Component })`; inside, `useComposer()` returns `{ context, prompt, attachments, agent: { provider, model, mode, thinking, options, metadata }, setProvider, setModel, setMode, setThinking, setOptions, setMetadata, … }`. In the New Agent tab the item mounted with `context: "draft"`. | UI run, trace `composer-item-mounted` |
| Control in the **New Workspace** screen | `client.addNewWorkspaceItem({ id, Component })` renders in the setup row (project / host / isolation); inside, `useNewWorkspace()` returns `{ host, project, isolation, baseRef, branch, metadata, setMetadata, … }`. The screen's own native composer **also** renders `addComposerItem` items (`context: "new-workspace"`). | UI run |
| Existing agent composer | `addComposerItem` also mounts there (`context: "agent"`). | UI run |
| Persistence | `defineSettings` (scope `host`) + `server.registerSettings`; client reads/writes with `useRpc(settingsRpc(id).read/.write)`. Stored as `<home>/plugin-settings/<plugin-id>/<settings-id>.json`. | file contents below |
| Draft metadata | `composer.setMetadata(patch)` / `newWorkspace.setMetadata(patch)`; top-level keys replace, `null` removes. | traces below |
| Creation hooks | `server.addHook("agent.create.before" \| "workspace.create.before" \| "agent.turn.before" \| "agent.create.after", handler)` (legacy aliases `server.before("agent.create")`, `server.on(...)` also exist). `*.before` creation hooks are awaited (`waits: true`); a returned object replaces the request, `undefined` leaves it, a throw rejects the creation. | `plugins/lifecycle/*.js` read from the installed app; runs below |

The skill reference (`paseo-plugin` SKILL) lists `addComposerPill` for agent composers but does not mention `addComposerItem` / `addNewWorkspaceItem` / `useNewWorkspace`; those were found in the 0.17.4 runtime. Documentation lags the runtime; only what ran is claimed here.

## POC-01 — native composer control, opt-in, draft metadata

| # | Sub-check | Result |
|---|---|---|
| 1.1 | Control "Orchestration: Disabled/Automatic" appears in the native **New Agent** composer (draft) via public SDK only | **PASS** |
| 1.2 | Control appears in the native **New Workspace** setup row (`addNewWorkspaceItem`) and in its native composer (`addComposerItem`) | **PASS** |
| 1.3 | Control appears in an existing agent's composer | **PASS** (render only; `setProvider` on a running agent is rejected by the host: "A running agent cannot change provider." — read in the bundle, not exercised) |
| 1.4 | Toggle by real mouse click switches Disabled ↔ Automatic | **PASS** |
| 1.5 | Opt-in persists across a fresh browser profile (host setting), and `disabled` is persisted too | **PASS** |
| 1.6 | Draft metadata from the composer reaches the creation request (`agent.create.before.request.metadata`) and is stored on the agent | **PASS** |
| 1.7 | Draft metadata from the New Workspace item reaches `workspace.create.before.request.metadata` | **PASS** |
| 1.8 | Workspace-level metadata (New Workspace item) also reaches the initial agent | **FAIL** — they are separate: with the item set to Automatic the initial agent's `agent.create.before` saw `optedIn:false`. A product needs the composer opt-in (agent metadata) or a hook that copies workspace → agent. |
| 1.9 | Plugin sets provider/model/mode on the native composer controls once providers are loaded (`setProvider` → `setModel` → `setMode`, awaited in that order) | **PASS** |
| 1.10 | Same on a **cold** composer applied at mount (persisted default) | **FAIL** — `setProvider("opencode")` rejected with `Unknown or unavailable provider: opencode` (provider list not loaded yet); model/mode applied, provider stayed null, chip showed "Select model". |
| 1.11 | Electron desktop window (as opposed to the same web build in Chrome) | **NOT RUN** |
| 1.12 | Compact/mobile layout, light theme, accessibility labels | **NOT RUN** |
| 1.13 | Type-check against SDK types | **NOT RUN** (no `.d.ts` shipped in 0.17.4; no dependencies installed) |

Observed details (sanitized):

- Persisted setting file (`<home>/plugin-settings/zelqio-poc-t02/optin.json`): `{"version":1,"values":{"orchestration":"automatic"}}` after the first toggle; `…"disabled"}` after toggling off. A fresh Chrome profile then mounted the composer already in `Automatic` (trace: `settings-read … "orchestration":"automatic"` followed by `composer-state … meta:{"orchestration":"automatic","selection":{…}}`).
- The client draft store also keeps draft metadata across a page reload within the same profile (composer remounted with `meta` already set).
- Model ids in the composer are `provider/model` (`opencode/mimo-v2.6-flash-free`); setting the bare id `mimo-v2.6-flash-free` landed on a different model (`Nemotron 3.5 Lightning Free`). Changing provider resets model and mode, so order and ids matter.
- UI facts: `Orchestration: Disabled` rendered in both rows on New workspace; screenshot-level checks were done locally and are not committed (they contain the local host name).

**Conclusion POC-01:** the opt-in control can live in the native composer (New Agent, New Workspace, existing agents) and in the New Workspace setup row using only public plugin surfaces on 0.17.4; opt-in persists via host settings; draft metadata reaches creation. Do not rely on the plugin to *apply* the selection to the composer at mount, and do not assume workspace metadata reaches the agent.
**If a row fails:** 1.8 → carry the opt-in on the agent metadata (composer item) and add a `workspace.create.before` copy step; 1.10 → the TECHNICAL-FEASIBILITY fallback applies ("resolve in the draft and re-check at creation; block if not reliable") — in this POC the creation hook is the authority, so no UX change is needed.

## POC-02 — creation hook applies provider/model/mode before the first prompt

Mechanism (read from the installed daemon code `agent/agent-manager.js`, `createAgentInternal`): `await pluginLifecycle.before("agent.create.before", { config, env, metadata })` runs **before** `client.createSession(...)` (provider session creation) and before `registerSession`; the prompt is sent only after creation returns. A hook may change `config.provider/model/modeId` (only `cwd` is locked), may replace `metadata`, and a throw rejects creation (`Plugin <id> agent.create.before failed: <message>`).

| # | Sub-check | Result |
|---|---|---|
| 2.1 | Hook runs before the provider session exists and before the first prompt reaches inference (trace ordering `before` → `create.after` → `turn.before`, real prompt on OpenCode free) | **PASS** |
| 2.2 | Hook rewrites provider/model/mode: request named `codex/gpt-5.5`, agent was created as `opencode/mimo-v2.6-flash-free`, mode `plan`; no Codex session/turn | **PASS** |
| 2.3 | Opted-in creation from the real UI (New Workspace and New Agent) keeps the plugin's selection (`action: applied`) and the first turn runs on that provider | **PASS** |
| 2.4 | Manual change after selection is respected (headless: selection mimo, request `beam-free`; UI: picked "Beam Free" in the native picker) → agent created and run on `beam-free`, `manualOverride:true` recorded | **PASS** |
| 2.5 | Selection failure (hook throws) → creation rejected, no agent created, no `agent.turn.before`, with an initial prompt attached | **PASS** |
| 2.6 | Selection resolves to an unavailable provider (`pi`) or unknown provider → creation rejected, **no fallback** to another provider; agent count unchanged (11 → 11) | **PASS** |
| 2.7 | Normal (non-opted-in) session untouched: hook returns `undefined`, config unchanged, agent metadata empty, same provider/model/mode as requested (headless and UI, composer `Disabled`) | **PASS** |
| 2.8 | Plugin not running / disabled / crashed at creation time (expected: no hook → request proceeds with the composer's own selection, i.e. fail-**open** for the plugin as a whole) | **NOT RUN** |
| 2.9 | Slow or hanging hook (timeout behaviour) | **NOT RUN** |
| 2.10 | Hook ordering with several plugins | **NOT RUN** |

Evidence (sanitized; `t` is epoch ms; excerpts from the plugin trace, `paseo plugin logs zelqio-poc-t02`):

```
agent.create.before  {"optedIn":true,"incoming":{"provider":"codex","model":"gpt-5.5","modeId":null},"action":"applied","applied":{"provider":"opencode","model":"mimo-v2.6-flash-free","modeId":"plan"}}   t=1795667283392
agent.create.after   {"provider":"opencode"}                                                                                                                                                    t=1795667284656
agent.turn.before    {"provider":"opencode","metaOrchestration":"automatic"}                                                                                                                    t=1795667284662
agent.create.before  {"optedIn":true,"incoming":{"provider":"opencode","model":"beam-free","modeId":"plan"},"action":"manual-override-respected","selection":{"model":"mimo-v2.6-flash-free",…}}
agent.create.before  {"optedIn":true,"incoming":{"provider":"codex","model":"gpt-5.5","modeId":null},"action":"fail-closed"}      -> DRV rejected: "Plugin zelqio-poc-t02 agent.create.before failed: zelqio-poc: routing selection failed; agent not created"
agent.create.before  {…,"applied":{"provider":"pi",…}}                -> DRV rejected: "Provider 'pi' is not available. Available providers: claude, codex, copilot, opencode. …"
agent.create.before  {…,"applied":{"provider":"no-such-provider",…}}  -> DRV rejected: "Unknown provider 'no-such-provider'. Configured providers: claude, codex, copilot, opencode, pi, omp, antigravity, muse."
agent.create.before  {"optedIn":false,"incoming":{"provider":"opencode","model":"opencode/mimo-v2.6-flash-free","modeId":"plan"},"action":"untouched"}   (UI, composer Disabled; agent metadata empty)
workspace.create.before {"hasMeta":true,"orchestration":"automatic","agentMetaKeys":[]}                                                       (New Workspace item = Automatic; initial agent then untouched)
```

Hook-before-create to first-turn spacing in the real-prompt run: 1.27 s to `create.after`, 6 ms more to `agent.turn.before`; the only provider that ever received a turn was `opencode`.

**Conclusion POC-02:** a plugin can apply provider/model/mode in `agent.create.before` before any provider session or prompt exists, can fail closed by throwing, cannot be bypassed by an invalid selection (the daemon rejects it), and leaves non-opted-in sessions untouched. "Manual change after selection" is only detectable by comparing the final request with a selection recorded in draft metadata; the POC does so and respects the user's choice.
**Limitations:** the guarantee depends on the plugin running (row 2.8 NOT RUN, expected fail-open); the model id may arrive as `provider/model` or bare, so comparisons must normalise (the first UI run mis-flagged a match as manual until the POC normalised both forms — that fix is in the committed plugin); the selection logic itself is a constant here, not a router.
**If this fails in a later version:** TECHNICAL-FEASIBILITY fallback — "resolve in the draft and check again at creation; block if not reliable".

## Findings that change the design

1. Two separate metadata namespaces: composer (agent) and New Workspace (workspace). The opt-in must be read from the agent request; a workspace-level opt-in needs an explicit copy.
2. The composer applies provider/model/mode asynchronously; applying at mount races the provider list. Treat composer state as a hint and the creation hook as authoritative.
3. Model ids differ in shape between composer (`provider/model`) and API callers (bare); normalise.
4. Fail-closed is real for hook errors and invalid decisions, but not for "plugin down" (not tested; expected fail-open).
5. Docs lag runtime: `addComposerItem`, `addNewWorkspaceItem`, `useNewWorkspace` exist in 0.17.4 but are not in the plugin-authoring reference consulted. The minimum Paseo version (ADR-001) must be decided with these surfaces in mind; `requirements.paseo` of the POC is `>=0.17.4 <0.18.0` because nothing earlier was tested.

## Reproduction (independent reviewer)

Prerequisites: Paseo 0.17.4 installed, Chrome, Node ≥ 22, a local git fixture repo. Never run `Paseo.exe` without `ELECTRON_RUN_AS_NODE=1`; never point any step at the regular daemon (`~/.paseo`, port 6767).

```powershell
# 0. Isolated daemon (own home and port)
$cli = "<paseo-install>\resources\bin\paseo.cmd"; $home_ = "<sandbox>\home-t02"
& $cli daemon config set --home $home_ daemon.listen 127.0.0.1:16772
& $cli daemon config set --home $home_ pluginsEnabled true
& $cli daemon start --home $home_
# 1. Install the POC plugin ONLY into that home
& $cli plugin install "<repo>\poc\s00-t02\plugin" --home $home_
& $cli plugin ls --home $home_              # expect: zelqio-poc-t02  running
# 2. POC-02 headless scenarios (no Claude/Codex inference; one trivial OpenCode free-model prompt)
<repo>\poc\s00-t02\scripts\run-headless.ps1 -Install "<paseo-install>" -Sandbox "<sandbox>"
#    expect DRV lines: normal=created beam-free; optin_applied/optin_rewrite=created opencode/mimo-v2.6-flash-free (appliedBy hook);
#    optin_manual=created beam-free (manualOverride); fail_closed=rejected; bad_decision=rejected x2; first_prompt=created, then a turn on opencode
# 3. POC-01 UI (same web build as the app, rendered headless against the isolated daemon only)
#    add "http://127.0.0.1:16773" to daemon.cors.allowedOrigins in <sandbox>/home-t02/config.json, then: & $cli reload --home $home_
node <repo>\poc\s00-t02\scripts\serve-app.mjs "<paseo-install>\resources\app-dist" 16773     # background
<repo>\poc\s00-t02\scripts\ui-session.ps1 -Sandbox "<sandbox>"                                  # fresh Chrome, connects only 127.0.0.1:16772
node <repo>\poc\s00-t02\scripts\cdp.mjs 9334 eval "document.body.innerText"                     # expect 'Orchestration: … Disabled|Automatic' twice on New workspace
#    click the control (cdp.mjs … clickxy <x> <y>), open a New Agent tab, type a prompt and Enter; read results with:
& $cli plugin logs zelqio-poc-t02 --home $home_
# 4. Cleanup
& $cli daemon stop --home $home_             # also stop the static server and the Chrome that uses <sandbox>\chrome-profile
```

Note: `paseo.cmd` and `Paseo.exe` write to stdout normally; when scripting `Paseo.exe` (GUI subsystem) pipe its output (`| Out-String`) or PowerShell will not wait for it.

## Not run / open

Electron window itself; compact/mobile layout and theming; plugin-down and hook-timeout behaviour (2.8, 2.9); multiple plugins; Windows-only (no macOS/Linux); relay/remote hosts; type-checking against SDK types; authentication/quota behaviour of Claude/Codex (deliberately not exercised); persistence of opt-in across a daemon restart (the host settings file is on disk, but a restart was not performed).
