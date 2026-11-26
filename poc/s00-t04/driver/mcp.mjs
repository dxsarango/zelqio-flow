// Usage (Electron-as-node, read-only use of the installed Paseo bundle):
//   ELECTRON_RUN_AS_NODE=1 <paseo-install>/Paseo.exe mcp.mjs <listen> <callerAgentId|-> list
//   ELECTRON_RUN_AS_NODE=1 <paseo-install>/Paseo.exe mcp.mjs <listen> <callerAgentId|-> call <tool> '<json-args>'
// Talks to the ISOLATED daemon's agent MCP endpoint the same way a provider process would
// (MCP SDK streamable-HTTP client, callerAgentId in the URL query). No inference involved.
import { pathToFileURL } from "node:url";

const [listen, caller, mode, tool, rawArgs = "{}"] = process.argv.slice(2);
const nm = `${process.env.LOCALAPPDATA.split(String.fromCharCode(92)).join("/")}/Programs/Paseo/resources/app.asar/node_modules/@modelcontextprotocol/sdk/dist/esm`;
const { Client } = await import(pathToFileURL(`${nm}/client/index.js`).href);
const { StreamableHTTPClientTransport } = await import(
  pathToFileURL(`${nm}/client/streamableHttp.js`).href
);

const url = new URL(`http://${listen}/mcp/agents`);
if (caller && caller !== "-") url.searchParams.set("callerAgentId", caller);
const client = new Client({ name: "zf-poc-t04", version: "0" });
await client.connect(new StreamableHTTPClientTransport(url));
try {
  if (mode === "list") {
    const { tools } = await client.listTools();
    console.log(JSON.stringify(tools.map((t) => t.name)));
  } else {
    const result = await client.callTool({ name: tool, arguments: JSON.parse(rawArgs) });
    console.log(JSON.stringify(result));
  }
} finally {
  await client.close();
}
