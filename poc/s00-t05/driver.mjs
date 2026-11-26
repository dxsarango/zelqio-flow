import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

const target = "127.0.0.1:16790";
const bundle = join(dirname(process.execPath), "resources", "app.asar", "node_modules", "@getpaseo");
const { createHostClient } = await import(pathToFileURL(join(bundle, "client/dist/node/index.js")));
const [action, ...args] = process.argv.slice(2);
const client = createHostClient(target, {
  clientId: "zf-poc-t05-driver",
  clientType: "cli",
  appVersion: "0.17.4",
  connectTimeoutMs: 5000,
  reconnect: { enabled: false },
});

await client.connect();
try {
  let result;
  switch (action) {
    case "plugin": {
      const [cwd, workspaceId, callerAgentId] = args;
      result = await client.invokePluginRpc("zf-poc-t05", "poc.create", { cwd, workspaceId, callerAgentId });
      break;
    }
    case "create": {
      const [cwd, workspaceId, title, callerAgentId] = args;
      result = await client.createAgent({
        cwd,
        workspaceId,
        callerAgentId,
        config: { provider: "opencode", model: "opencode/iceman-free", modeId: "plan", title },
      });
      break;
    }
    case "cancel": {
      const [id] = args;
      await client.sendAgentMessage(id, "Reply OK");
      const before = await client.fetchAgentTimeline(id);
      await client.cancelAgent(id);
      const after = await client.fetchAgentTimeline(id);
      result = {
        before: before.agent.status,
        after: after.agent.status,
        entries: after.entries.map(({ item }) => item.type),
      };
      break;
    }
    case "timeline":
      result = await client.fetchAgentTimeline(args[0]);
      break;
    case "provider-subagents":
      result = await client.listProviderSubagents(args[0]);
      break;
    default:
      throw new Error("Invalid probe action");
  }
  console.log(JSON.stringify(result));
} finally {
  await client.close();
}
