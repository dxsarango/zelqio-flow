# S00-T01 — Product and environment baseline

Date: 2026-11-25 (UTC-5). Result: **PASS** (preparation task; no product capability validated here).

## Pinned versions (reference environment)

| Component | Version | How observed |
|---|---|---|
| Paseo desktop / daemon | 0.17.4 (win32 x64) | `paseo --version`, `paseo daemon status --json` |
| Paseo plugin SDK (`@getpaseo/plugin`) | 0.17.4 | package.json bundled with the installed app |
| Other bundled `@getpaseo/*` | cli, client, protocol, server, relay, highlight: 0.17.4 | same |
| Node.js | 24.21.0 | `node --version` |
| Git | 2.50.1 (Windows) | `git --version` |
| GitHub CLI | 2.101.0 | `gh --version` |
| Provider CLIs | Claude Code 2.1.331, Codex CLI 0.172.0, OpenCode 1.19.6 | `--version` |
| OS | Windows 11 Pro 10.0.26200 | — |

Minimum supported Paseo version is **not** decided (ADR-001 at G0). Nothing documented for newer Paseo versions is assumed to exist in 0.17.4.

## Scope review

PRD, TECHNICAL-FEASIBILITY, ARCHITECTURE, WORK-MODES, GIT-POLICY, SECURITY, PRIVACY and PLAN were read for consistency. `tools/check-planning.mjs` verifies tasks.json (63 tasks, unique ids, valid dependencies, acyclic) against PLAN.md (63 rows, equal dependencies). No contradictions found that block S00. Note: the 17 POCs in TECHNICAL-FEASIBILITY are all `NOT RUN` before this task.

## Isolated test environment (outside the repository, not committed)

- Separate daemon home (`<sandbox>/home`) with its own `config.json`: `daemon.listen = 127.0.0.1:16767`, relay disabled. Started with `paseo daemon start --home <sandbox>/home`; `status` reports its own pid/serverId, version 0.17.4, `desktopManaged: false`. The regular daemon (127.0.0.1:6767) kept its own pid and listen address.
- Disposable fixtures (`<sandbox>/fixtures`): a local bare remote and a clone with one commit (`README.md`, `a.ts`, `b.ts`). No real project or remote is used.
- Provider availability reported by the isolated daemon: claude, codex, copilot, opencode available (as reported by `status`; authentication/quota not exercised).

## Findings useful for later POCs (observations, not validations)

- The bundled CLI exposes `--home` on `daemon start|run|status|stop|config`, which makes isolated daemons practical.
- 0.17.4 bundles built-in plugins named `*-usage-source` (claude, codex, grok, ...): relevant to POC-03; contents not yet inspected.
- Whether the isolated daemon shares provider credentials/config with the regular home (POC-13/16) is **not yet verified**.

## Limitations

Nothing was run against providers (no inference, no quota consumed). The isolated daemon was left running for S00 POCs and must be stopped at the end of S00.
