# POC S00-T04 (disposable)

Throwaway code that backs `docs/evidence/S00-T04-roles-tools-permissions.md`. Not product code; do not reuse without review.

- `plugin/` — Paseo plugin (`zf-poc-t04`): direct agent creation RPC, `agent.open.before` tool/MCP injection, role registry, per-call authorization, plugin-hosted MCP server with per-session bearer secret, veto experiments. No npm dependencies (`zod` and `@getpaseo/plugin` are host modules in Paseo 0.17.4).
- `driver/rpc.mjs` — invokes a plugin RPC on the isolated daemon (uses the installed Paseo bundle read-only via Electron-as-node).
- `driver/mcp.mjs` — talks to the daemon agent-MCP endpoint like a provider process (MCP SDK client from the installed bundle).
- `results/` — sanitized event log emitted by the plugin (`ZF_POC_LOG`) and the inference log.

Placeholders: `<paseo-install>` = Paseo install dir; `<sandbox>` = scratch dir outside the repo; `<repo>` = this checkout. The isolated daemon uses `<sandbox>/home-t04` on `127.0.0.1:16774` and must never be pointed at the regular Paseo home. Reproduction steps are in the evidence document.
