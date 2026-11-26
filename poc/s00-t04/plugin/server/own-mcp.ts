import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import { log, registry } from "./state";

// POC-05b: plugin-hosted MCP server. Identity comes from a per-session bearer secret that the
// daemon passes to the provider through the launch-only `mcpServers` hook field, not from a
// URL query parameter that any local process can choose.
const tokens = new Map<string, string>(); // token -> agentId
let server: Server | null = null;
let port = 0;

export function mintToken(agentId: string): string {
  for (const [token, id] of tokens) if (id === agentId) tokens.delete(token); // revoke previous
  const token = randomUUID();
  tokens.set(token, agentId);
  return token;
}

export function ownMcpConfig(token: string) {
  return {
    zf_own: {
      type: "http" as const,
      url: `http://127.0.0.1:${port}/mcp`,
      headers: { Authorization: `Bearer ${token}` },
    },
  };
}

export async function startOwnMcp(): Promise<void> {
  server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const auth = req.headers.authorization ?? "";
      const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
      const agentId = tokens.get(token) ?? null;
      let msg: any = {};
      try {
        msg = JSON.parse(raw || "{}");
      } catch {
        /* ignore */
      }
      log("ownmcp.request", { httpMethod: req.method, rpc: msg.method ?? null, hasAuth: auth !== "", agentId });
      const reply = (result: unknown, code = 200) => {
        res.writeHead(code, { "content-type": "application/json" });
        res.end(JSON.stringify({ jsonrpc: "2.0", id: msg.id ?? null, result }));
      };
      if (req.method !== "POST") return void res.writeHead(405).end();
      if (typeof msg.method === "string" && msg.method.startsWith("notifications/")) {
        return void res.writeHead(202).end();
      }
      if (msg.method === "initialize") {
        return reply({
          protocolVersion: msg.params?.protocolVersion ?? "2025-06-18",
          capabilities: { tools: {} },
          serverInfo: { name: "zf-own-mcp", version: "0" },
        });
      }
      if (!agentId) {
        log("ownmcp.denied", { rpc: msg.method ?? null });
        res.writeHead(401, { "content-type": "application/json" });
        return void res.end(JSON.stringify({ error: "unauthorized" }));
      }
      if (msg.method === "tools/list") {
        return reply({
          tools: [
            {
              name: "zf_own_whoami",
              description: "Return the identity the Zelqio POC server derived from the session bearer secret.",
              inputSchema: { type: "object", properties: {} },
            },
          ],
        });
      }
      if (msg.method === "tools/call") {
        const b = registry.get(agentId);
        log("ownmcp.tool", { tool: msg.params?.name ?? null, agentId, role: b?.role ?? null });
        return reply({ content: [{ type: "text", text: JSON.stringify({ agentId, role: b?.role ?? null }) }] });
      }
      return reply({});
    });
  });
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  port = (server!.address() as { port: number }).port;
  log("ownmcp.listening", { port });
}

export function stopOwnMcp(): void {
  server?.close();
  server = null;
}
