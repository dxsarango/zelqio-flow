import assert from "node:assert/strict";
import { eventually, model, print, provider } from "./client.mjs";

export async function schedule(probe, client, cwd, workspaceId, existingAgentId) {
  assert(existingAgentId);
  async function inspect(id) {
    const result = await client.scheduleInspect({ id });
    assert.equal(result.error, null);
    return result.schedule;
  }
  const flags = ["--cron", "0 0 1 1 *", "--run-now", "--max-runs", "1", "--expires-in", "5m",
    "--cwd", cwd, "--provider", `${provider}/${model}`];
  const discard = probe.checked("schedule", "create", "fixture ok", ...flags, "--name", "auto-archive");
  const retain = probe.checked("schedule", "create", "fixture ok", ...flags, "--name", "keep", "--no-archive-on-finish");
  const heartbeat = await client.scheduleCreate({
    name: "fixture heartbeat", prompt: "fixture ok", cadence: { type: "cron", expression: "0 0 1 1 *" },
    target: { type: "agent", agentId: existingAgentId }, maxRuns: 1,
    expiresAt: new Date(Date.now() + 300_000).toISOString(),
  });
  assert.equal(heartbeat.error, null);
  const heartbeatRun = await client.scheduleRunOnce({ id: heartbeat.schedule.id });
  assert.equal(heartbeatRun.error, null);
  for (const [kind, id] of [["archive", discard.id], ["retain", retain.id], ["heartbeat", heartbeat.schedule.id]]) {
    const result = await eventually(() => inspect(id), row => row.runs.some(run => run.status !== "running"), 35_000);
    const run = result.runs[0];
    const agent = run.agentId ? (await client.fetchAgent({ agentId: run.agentId }))?.agent : null;
    print("schedule-" + kind, { configured: result.target.config?.archiveOnFinish ?? null,
      type: result.target.type, targetAgentId: result.target.agentId, expectedExistingAgentId: existingAgentId,
      run, status: result.status, activeWorkspaceIds: probe.checked("workspace", "ls").map(row => row.workspaceId),
      agentWorkspaceId: agent?.workspaceId, agentArchivedAt: agent?.archivedAt, originalWorkspaceId: workspaceId });
  }
  for (const id of [discard.id, retain.id, heartbeat.schedule.id]) {
    const result = await client.scheduleDelete({ id });
    assert.equal(result.error, null);
  }
}
