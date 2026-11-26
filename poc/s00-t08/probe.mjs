import assert from "node:assert/strict";

const [, , install, workspaceId, step, approvalId] = process.argv;
const path = install.replaceAll("\\", "/");
const clientPath = `file:///${path}/resources/app.asar/node_modules/@getpaseo/client/dist/`;
const { createHostClient } = await import(clientPath + "node/index.js");
const client = createHostClient("127.0.0.1:16800", { clientId: "zelqio-t08", clientType: "cli" });
await client.connect();

try {
  if (step === "prepare") {
    const approval = await client.invokePluginRpc("zelqio-poc-t07", "poc.approval.request", {
      workspaceId,
      requestedBy: "fixture",
    });
    assert.equal(approval.status, "pending");
    console.log(JSON.stringify({ approvalId: approval.id, sha: approval.sha }));
  } else if (step === "after-restart") {
    const approvals = await client.invokePluginRpc("zelqio-poc-t07", "poc.approval.list", {});
    assert.ok(Array.isArray(approvals));
    assert.equal(approvals.some(({ id }) => id === approvalId), false);
    console.log(JSON.stringify({ pendingApprovalRecovered: false }));
  } else if (step === "disabled") {
    await assert.rejects(() => client.invokePluginRpc("zelqio-poc-t07", "poc.approval.list", {}), /plugin.*(?:not|unavailable|disabled|unknown)|no.*handler/i);
    console.log(JSON.stringify({ removedRpcAccessible: false }));
  } else {
    assert.ok(["start-service", "service"].includes(step));
    if (step === "start-service") {
      const started = await client.startWorkspaceScriptWithStatus(workspaceId, "preview");
      assert.equal(started.error, null);
    }
    const listed = await client.listWorkspaceScripts(workspaceId);
    const preview = listed.scripts.find(({ scriptName }) => scriptName === "preview");
    assert.ok(preview);
    console.log(JSON.stringify({ lifecycle: preview.lifecycle }));
  }
} finally {
  await client.close();
}
