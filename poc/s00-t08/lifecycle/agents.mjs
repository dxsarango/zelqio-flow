import assert from 'node:assert/strict';
import { appendFileSync, closeSync, fsyncSync, openSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const [install, port, step, ...args] = process.argv.slice(2);
assert.match(port, /^1683[0-9]$/);
const bundle = join(install, 'resources', 'app.asar', 'node_modules', '@getpaseo');
const { createHostClient } = await import(pathToFileURL(join(bundle, 'client/dist/node/index.js')));
const client = createHostClient(`127.0.0.1:${port}`, {
  clientId: 'zf-lifecycle-probe', clientType: 'cli', appVersion: '0.17.4',
  connectTimeoutMs: 5000, reconnect: { enabled: false },
});
const key = 'zelqio.lifecycle';
const taskId = 'fixture-task';
const runId = 'fixture-run';

function append(journal, event) {
  const fd = openSync(journal, 'a');
  try {
    appendFileSync(fd, JSON.stringify({ schemaVersion: 1, taskId, runId, ...event }) + '\n');
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

function loadJournal(journal) {
  const events = readFileSync(journal, 'utf8').trim().split('\n').map(JSON.parse);
  assert.ok(events.every((event) => event.schemaVersion === 1 && event.taskId === taskId && event.runId === runId));
  const created = events.filter(({ event }) => event === 'created');
  assert.equal(new Set(created.map(({ role }) => role)).size, created.length);
  const aliases = new Map(created.map(({ agentId, role }) => [agentId, role]));
  const alias = (id) => id ? aliases.get(id) ?? 'unknown' : null;
  const journalEvents = events.map((entry) => entry.event === 'created'
    ? ['created', entry.role, alias(entry.originalParentId)]
    : [entry.event, alias(entry.workerId), alias(entry.previousRootId), alias(entry.replacementRootId)]);
  return { created, alias, journalEvents };
}

async function probe() {
  if (step === 'product-control') {
    const approvals = await client.invokePluginRpc('zelqio-poc-t07', 'poc.approval.list', {});
    assert.deepEqual(approvals, []);
    console.log(JSON.stringify({ executed: true, pendingCount: approvals.length }));
  } else if (step === 'create') {
    const [cwd, workspaceId, role, journal, callerAgentId] = args;
    assert.ok(['root', 'same', 'cross', 'detached', 'replacement', 'newChild'].includes(role));
    const metadata = { taskId, runId, role };
    const agent = await client.createAgent({
      cwd, workspaceId, callerAgentId,
      config: { provider: 'mock', title: `Fixture ${role}` },
      metadata: { [key]: metadata },
    });
    assert.ok(agent.id);
    assert.equal(agent.workspaceId, workspaceId);
    assert.deepEqual(agent.metadata[key], metadata);
    append(journal, { event: 'created', role, agentId: agent.id, workspaceId, originalParentId: callerAgentId ?? null });
    console.log(JSON.stringify({ id: agent.id }));
  } else if (step === 'handoff') {
    const [journal, workerId, previousRootId, replacementRootId] = args;
    const logicalOwner = { taskId, runId, role: 'cross', previousRootId, replacementRootId };
    const metadata = await client.setAgentMetadata(workerId, { [key]: logicalOwner });
    assert.deepEqual(metadata[key], logicalOwner);
    append(journal, { event: 'handoff', workerId, previousRootId, replacementRootId });
    console.log(JSON.stringify({ metadataUpdated: true }));
  } else if (step === 'snapshot') {
    const [journal] = args;
    const { created, alias, journalEvents } = loadJournal(journal);
    const agents = {};
    for (const { role, agentId, workspaceId } of created) {
      const payload = await client.fetchAgentTimeline(agentId);
      const { agent, entries } = payload;
      assert.ok(agent, `missing fixture agent ${role}`);
      const metadata = agent.metadata?.[key];
      assert.equal(agent.workspaceId, workspaceId);
      assert.equal(entries.length, 0);
      agents[role] = {
        archived: Boolean(agent.archivedAt),
        nativeParent: alias(agent.labels?.['paseo.parent-agent-id']),
        metadataMatches: metadata?.taskId === taskId && metadata?.runId === runId && metadata?.role === role,
        logicalOwner: alias(metadata?.replacementRootId),
        previousLogicalOwner: alias(metadata?.previousRootId),
        emptyTimeline: true,
      };
    }
    console.log(JSON.stringify({ agents, journalEvents }));
  } else {
    throw new Error('Unknown fixture action');
  }
}

if (step === 'history') {
  console.log(JSON.stringify(loadJournal(args[0]).journalEvents));
} else {
  await client.connect();
  try {
    await probe();
  } finally {
    await client.close();
  }
}
