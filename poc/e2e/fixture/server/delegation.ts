import { randomUUID } from "node:crypto";
import type { ProviderSessionConfig } from "@getpaseo/plugin/server/provider";

type Trace = (kind: string, fields: Record<string, unknown>) => void;
type ToolName = "zelqio_delegate" | "zelqio_wait" | "zelqio_status" | "zelqio_cancel";
type ToolResponse = { structuredContent?: { id: string }; isError?: boolean; content?: Array<{ text?: string }> };
type Request = (method: string, params?: object) => Promise<unknown>;

function connection(config: ProviderSessionConfig, signal: AbortSignal): Request {
  const server = config.mcpServers.paseo;
  const endpoint = process.env.ZELQIO_E2E_ENDPOINT;
  if (!endpoint || !/^127\.0\.0\.1:168(?:0[1-9]|10)$/.test(endpoint) || server?.type !== "http") {
    throw new Error("Expected an isolated Paseo MCP server");
  }
  const url = new URL(server.url);
  if (url.origin !== `http://${endpoint}` || url.pathname !== "/mcp/agents" || !url.searchParams.get("callerAgentId")) {
    throw new Error("Refusing to call MCP outside the isolated session");
  }
  return async (method, params) => {
    const response = await fetch(url, {
      method: "POST", redirect: "error", signal,
      headers: { ...server.headers, "Content-Type": "application/json", Accept: "application/json, text/event-stream", "MCP-Protocol-Version": "2025-06-18" },
      body: JSON.stringify({ jsonrpc: "2.0", id: randomUUID(), method, params }),
    });
    if (!response.ok) throw new Error(`MCP ${method} failed with HTTP ${response.status}`);
    const body = await response.text();
    const events = response.headers.get("content-type")?.includes("text/event-stream")
      ? body.split(/\r?\n/).filter(line => line.startsWith("data:")).map(line => JSON.parse(line.slice(5)))
      : [JSON.parse(body)];
    const event = events.find(entry => "result" in entry || "error" in entry);
    if (!event?.result) throw new Error(event?.error?.message ?? `Missing MCP reply for ${method}`);
    return event.result;
  };
}

export async function inspectTools(config: ProviderSessionConfig, trace: Trace, signal: AbortSignal): Promise<Request> {
  const request = connection(config, signal);
  const { tools } = await request("tools/list") as { tools: Array<{ name: string; inputSchema: unknown }> };
  trace("tools.list", { tools: tools.filter(tool => tool.name.startsWith("zelqio_")) });
  return request;
}

export async function coordinate(scenario: string, request: Request, trace: Trace) {
  const call = async (name: ToolName, input: object, label = name as string, expectedError = false) => {
    const result = await request("tools/call", { name, arguments: input }) as ToolResponse;
    trace("tool.result", { name, label, input, result });
    if (Boolean(result.isError) !== expectedError) throw new Error(`Unexpected outcome for ${label}: ${JSON.stringify(result.content)}`);
    return result.structuredContent?.id ?? "";
  };
  const assign = (title: string, prompt: string, role: "developer" | "reviewer", dependsOn: string[] = []) =>
    call("zelqio_delegate", { title, prompt, role, capability: role === "developer" ? "implement" : "review", dependsOn }, title);

  switch (scenario) {
    case "main": {
      const first = await assign("writer-one", "[[hold:writer-one]]", "developer");
      await assign("reviewer", "Review the patch", "reviewer");
      await assign("writer-two", "[[hold:writer-two]]", "developer");
      await assign("dependent", "Review after writer-one delivers", "reviewer", [first]);
      await call("zelqio_status", {});
      await call("zelqio_wait", { timeoutSeconds: 30 });
      break;
    }
    case "fallback":
      await assign("survivor", "[[hold:survivor]]", "reviewer");
      await assign("limited", "[[limit]]", "developer");
      await call("zelqio_wait", { timeoutSeconds: 30 });
      break;
    case "bound":
      await call("zelqio_delegate", { title: "unauthorized", prompt: "Should be rejected", provider: "fixture-b" }, "provider argument", true);
      for (let index = 1; index <= 8; index++) {
        await assign(`review-${index}`, "Review the patch", "reviewer");
      }
      await call("zelqio_delegate", { title: "ninth", prompt: "Should be rejected" }, "ninth", true);
      break;
    case "cancel": {
      const child = await assign("cancel-tool", "[[hold:cancel-tool]]", "reviewer");
      await call("zelqio_cancel", { id: child });
      await assign("cancel-writer", "[[hold:cancel-writer]]", "developer");
      await assign("cancel-queued", "Never start", "developer");
      break;
    }
    case "restart":
      await assign("restart-child", "[[hold:restart-child]] [[short-limit]]", "developer");
      break;
    case "inspect":
      break;
    default:
      throw new Error(`Unknown fixture scenario: ${scenario}`);
  }
}
