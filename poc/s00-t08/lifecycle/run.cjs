const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');

const [install, scratch, phase, gitPath] = process.argv.slice(2);
assert.ok(path.isAbsolute(install ?? '') && path.isAbsolute(scratch ?? ''));
assert.ok(['network', 'workspace'].includes(phase));
assert.ok(!gitPath || path.isAbsolute(gitPath));
assert.ok(phase !== 'workspace' || gitPath, 'Pass the absolute Git executable for the workspace phase');
fs.mkdirSync(scratch);

const system = path.join(process.env.SystemRoot, 'System32');
const exe = path.join(install, 'Paseo.exe');
const resources = path.join(install, 'resources');
const cliEntry = [
  path.join(resources, 'app.asar.unpacked', 'dist', 'daemon', 'node-entrypoint-runner.js'),
  'node-script', path.join(resources, 'app.asar', 'node_modules', '@getpaseo', 'cli', 'dist', 'index.js'),
];

function invoke(file, args, cwd, env, label, allowFailure = false) {
  const result = spawnSync(file, args, { cwd, env, windowsHide: true, encoding: 'utf8', timeout: 45000 });
  if (!allowFailure && result.status !== 0) {
    const details = [result.stderr, result.stdout, result.error?.message].filter(Boolean).join('\n')
      .replaceAll(scratch, '<sandbox>').replaceAll(install, '<paseo-install>').replaceAll(__dirname, '<probe>');
    throw new Error(`${label} exit ${result.status}\n${details}`);
  }
  return result;
}

function tcpTable() {
  const raw = execFileSync(path.join(system, 'netstat.exe'), ['-ano', '-p', 'tcp'], { windowsHide: true, encoding: 'utf8' });
  return raw.split(/\r?\n/).flatMap((line) => {
    const match = line.trim().match(/^TCP\s+(\S+):(\d+)\s+(\S+):(\d+)\s+(\S+)\s+(\d+)$/);
    if (!match) return [];
    const [, local, localPort, remote, remotePort, state, pid] = match;
    return [{ local, localPort: Number(localPort), remote, remotePort: Number(remotePort), state, pid: Number(pid) }];
  });
}

function endpointOwner(rows, port) {
  return rows.find((r) => r.local === '127.0.0.1' && r.localPort === port && r.state === 'LISTENING')?.pid;
}

async function checkPort(port) {
  const server = net.createServer();
  await new Promise((resolve, reject) => server.listen({ host: '127.0.0.1', port, exclusive: true }, resolve).once('error', reject));
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

async function withDaemon(name, port, { speech = false, instrument = false, plugins = false }, action) {
  await checkPort(port);
  const root = path.join(scratch, name);
  const home = path.join(root, 'daemon');
  const profile = path.join(root, 'profile');
  const eventFile = path.join(root, 'network.ndjson');
  const env = {
    SystemRoot: process.env.SystemRoot,
    ComSpec: path.join(system, 'cmd.exe'),
    PATH: [system, process.env.SystemRoot, ...(gitPath ? [path.dirname(gitPath)] : [])].join(';'),
    PATHEXT: '.COM;.EXE;.BAT;.CMD',
    USERPROFILE: profile,
    APPDATA: path.join(profile, 'AppData', 'Roaming'),
    LOCALAPPDATA: path.join(profile, 'AppData', 'Local'),
    TEMP: path.join(profile, 'Temp'),
    TMP: path.join(profile, 'Temp'),
    XDG_CONFIG_HOME: path.join(profile, 'config'),
    XDG_DATA_HOME: path.join(profile, 'data'),
    XDG_CACHE_HOME: path.join(profile, 'cache'),
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: path.join(profile, 'gitconfig'),
    ELECTRON_RUN_AS_NODE: '1',
    PASEO_NODE_ENV: phase === 'workspace' ? 'development' : 'production',
  };
  for (const key of ['APPDATA', 'LOCALAPPDATA', 'TEMP', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'XDG_CACHE_HOME']) {
    fs.mkdirSync(env[key], { recursive: true });
  }
  const endpoint = `127.0.0.1:${port}`;
  const cli = (...args) => invoke(exe, [...cliEntry, ...args], profile, env, args.slice(0, 2).join(' ')).stdout.trim();
  const request = (...args) => JSON.parse(cli(...args, '--host', endpoint, '--json'));
  const local = ['--home', home];
  const configure = (key, value) => cli('daemon', 'config', 'set', key, value, ...local);
  const start = () => {
    const daemonEnv = instrument ? {
      ...env,
      NODE_OPTIONS: `--require="${path.join(__dirname, 'network.cjs').replaceAll('\\', '/')}"`,
      ZF_FIXTURE_NETWORK_EVENTS: eventFile,
    } : env;
    invoke(exe, [...cliEntry, 'daemon', 'start', ...local, '--timeout', '30'], profile, daemonEnv, 'daemon start');
  };
  const stop = () => cli('daemon', 'stop', ...local);
  const client = (step, ...args) => JSON.parse(invoke(exe, [path.join(__dirname, 'agents.mjs'), install, String(port), step, ...args],
    profile, env, `client ${step}`).stdout.trim());
  const git = (cwd, ...args) => invoke(gitPath, ['-C', cwd, ...args], profile, env, `git ${args[0]}`).stdout.trim();
  const version = cli('--version');
  assert.equal(version, '0.17.4');
  configure('daemon.listen', endpoint);
  configure('daemon.relay.enabled', 'false');
  configure('features.dictation.enabled', String(speech));
  configure('features.voiceMode.enabled', 'false');
  configure('pluginsEnabled', String(plugins));

  try {
    start();
    await action({ root, home, request, client, git, profile, env, start, stop, eventFile });
  } finally {
    stop();
    await checkPort(port);
    console.log(JSON.stringify({ phase: name, listenerClosed: true }));
  }
}

async function network() {
  const cases = [
    { name: 'platform-silent', speech: false, plugins: false },
    { name: 'product-silent', speech: false, plugins: true },
    { name: 'platform-speech', speech: true, plugins: false },
    { name: 'product-speech', speech: true, plugins: true },
  ];
  for (const [index, options] of cases.entries()) {
    const port = 16830 + index;
    await withDaemon(options.name, port, { ...options, instrument: true }, async ({ home, eventFile, request, client }) => {
      const initial = tcpTable();
      const owner = endpointOwner(initial, port);
      assert.ok(owner, 'The IPv4 listener owner must be identified independently');
      const collect = (rows) => rows.filter((row) => row.pid === owner && row.state === 'ESTABLISHED'
        && !/^(?:127\.|\[::1\]$)/.test(row.remote));
      const samples = collect(initial);
      if (options.plugins) {
        const poc = path.resolve(__dirname, '../..');
        for (const plugin of ['s00-t02', 's00-t07']) {
          request('plugin', 'install', path.join(poc, plugin, 'plugin'));
        }
        assert.deepEqual(client('product-control'), { executed: true, pendingCount: 0 });
      }
      for (let sample = 0; sample < 14; sample += 1) {
        samples.push(...collect(tcpTable()));
        await delay(200);
      }
      const log = ['daemon.log', 'paseo.log'].filter((filename) => fs.existsSync(path.join(home, filename)))
        .map((filename) => fs.readFileSync(path.join(home, filename), 'utf8')).join('\n');
      const events = fs.existsSync(eventFile)
        ? fs.readFileSync(eventFile, 'utf8').trim().split('\n').map(JSON.parse).filter((row) => row.pid === owner)
        : [];
      const sockets = events.filter(({ event }) => event === 'nonloopback-socket');
      const toCounts = (rows) => Object.fromEntries([...new Set(rows.map((row) => row.destination))]
        .sort().map((destination) => [destination, rows.filter((row) => row.destination === destination).length]));
      const matched = (socket) => samples.some((row) => row.localPort === socket.localPort && row.remotePort === socket.remotePort);
      console.log(JSON.stringify({ phase: options.name, speech: options.speech, productRpc: options.plugins,
        listenerOwnerInstrumented: events.some(({ event }) => event === 'preloaded'),
        ownerRequests: toCounts(events.filter(({ event }) => event === 'request')),
        ownerNonloopbackRequests: toCounts(sockets),
        establishedSocketCount: new Set(samples.map((row) => row.localPort)).size,
        matchedSockets: toCounts(sockets.filter(matched)),
        matchedRemotePorts: [...new Set(sockets.filter(matched).map((row) => row.remotePort))],
        speechLogRead: Boolean(log), speechDownloadStarted: log.includes('Starting background download for missing local speech models'),
      }));
    });
  }
}

async function workspace() {
  const port = 16834;
  await withDaemon('workspace', port, {}, async ({ root, home, request, client, git, profile, env, start, stop }) => {
    const repo = path.join(root, 'repo');
    const dirty = path.join(root, 'dirty');
    const clean = path.join(root, 'clean');
    fs.mkdirSync(repo);
    git(repo, 'init', '-q', '-b', 'main');
    git(repo, 'worktree', 'add', '--orphan', '-b', 'test/dirty', dirty);
    git(repo, 'worktree', 'add', '--orphan', '-b', 'test/clean', clean);
    const sentinel = path.join(dirty, 'untracked.txt');
    const staged = path.join(dirty, 'staged.txt');
    const ignored = path.join(dirty, 'ignored.txt');
    fs.writeFileSync(sentinel, 'keep untracked\n');
    fs.writeFileSync(staged, 'keep staged\n');
    fs.writeFileSync(ignored, 'keep ignored\n');
    fs.appendFileSync(path.join(repo, '.git', 'info', 'exclude'), '\nignored.txt\n');
    git(dirty, 'add', '--', 'staged.txt');
    const object = git(dirty, 'rev-parse', ':staged.txt');
    git(repo, 'update-ref', 'refs/tags/fixture-blob', object);
    const status = (cwd) => git(cwd, 'status', '--porcelain=v1', '--untracked-files=all', '--ignored=matching');
    const listed = (cwd) => git(repo, 'worktree', 'list', '--porcelain').split(/\r?\n/)
      .includes(`worktree ${cwd.replaceAll('\\', '/')}`);
    const common = (cwd) => fs.realpathSync(git(cwd, 'rev-parse', '--path-format=absolute', '--git-common-dir'));
    assert.equal(common(dirty), common(repo));
    assert.equal(common(clean), common(repo));
    const register = (directory) => {
      const result = request('workspace', 'create', '--isolation', 'local', '--path', directory);
      assert.ok(result.workspaceId && fs.realpathSync(result.cwd) === fs.realpathSync(directory));
      return result.workspaceId;
    };
    const local = register(repo);
    const dirtyId = register(dirty);
    const cleanId = register(clean);
    assert.equal(new Set([local, dirtyId, cleanId]).size, 3);
    const registry = path.join(home, 'projects', 'workspaces.json');
    const loadRegistry = () => JSON.parse(fs.readFileSync(registry, 'utf8'));
    const fixtureCheckout = (directory, name) => {
      const expected = path.join(fs.realpathSync(root), name);
      assert.equal(fs.realpathSync(directory), expected);
      assert.equal(path.dirname(expected), fs.realpathSync(root));
      return expected;
    };
    const externalArchive = (directory, id) => {
      const row = loadRegistry().find(({ workspaceId }) => workspaceId === id);
      assert.equal(row.kind, 'worktree');
      assert.equal(row.isPaseoOwnedWorktree, false);
      assert.equal(row.worktreeManagerPluginId ?? null, null);
      assert.equal(fs.realpathSync(row.cwd), fs.realpathSync(directory));
      assert.ok(listed(directory));
      assert.ok(request('workspace', 'ls').some(({ workspaceId }) => workspaceId === id));
      const result = request('workspace', 'archive', id);
      assert.equal(result.status, 'archived');
      assert.ok(fs.existsSync(directory) && listed(directory));
      assert.ok(loadRegistry().find(({ workspaceId }) => workspaceId === id)?.archivedAt);
      assert.ok(!request('workspace', 'ls').some(({ workspaceId }) => workspaceId === id));
    };

    const beforeDirty = status(dirty);
    assert.match(beforeDirty, /A  staged\.txt/);
    assert.match(beforeDirty, /\?\? untracked\.txt/);
    assert.match(beforeDirty, /!! ignored\.txt/);
    externalArchive(dirty, dirtyId);
    const reject = invoke(gitPath, ['-C', repo, 'worktree', 'remove', fixtureCheckout(dirty, 'dirty')],
      profile, env, 'dirty worktree remove', true);
    assert.equal(reject.status, 128);
    assert.match(reject.stderr, /contains modified or untracked files/);
    assert.equal(status(dirty), beforeDirty);
    assert.equal(fs.readFileSync(sentinel, 'utf8'), 'keep untracked\n');
    assert.equal(fs.readFileSync(staged, 'utf8'), 'keep staged\n');
    assert.equal(fs.readFileSync(ignored, 'utf8'), 'keep ignored\n');
    assert.ok(listed(dirty));
    console.log(JSON.stringify({ phase: 'cleanup-dirty', registration: 'local', kind: 'worktree', paseoOwnsCheckout: false, archivedRecord: true,
      directoryRetainedByArchive: true, nonforcedGitExit: reject.status, sentinelFilesIntact: true }));

    externalArchive(clean, cleanId);
    assert.equal(status(clean), '');
    git(repo, 'worktree', 'remove', fixtureCheckout(clean, 'clean'));
    assert.ok(!listed(clean) && !fs.existsSync(clean));
    assert.ok(listed(repo) && listed(dirty));
    assert.equal(git(repo, 'rev-parse', 'refs/tags/fixture-blob'), object);
    console.log(JSON.stringify({ phase: 'cleanup-clean', registration: 'local', kind: 'worktree', paseoOwnsCheckout: false, archivedRecord: true,
      directoryRetainedByArchive: true, removedByNonforcedGit: true, repoDirtyWorktreeAndFixtureRefRetained: true }));

    const crossDirectory = path.join(root, 'cross');
    fs.mkdirSync(crossDirectory);
    git(crossDirectory, 'init', '-q', '-b', 'main');
    const crossId = register(crossDirectory);
    const journal = path.join(root, 'logical-history.ndjson');
    const create = (cwd, workspaceId, role, parent) => client('create', cwd, workspaceId, role, journal, ...(parent ? [parent] : [])).id;
    const original = create(repo, local, 'root');
    create(repo, local, 'same', original);
    const crossAgent = create(crossDirectory, crossId, 'cross', original);
    const manual = create(crossDirectory, crossId, 'detached', original);
    const replacement = create(repo, local, 'replacement');
    create(crossDirectory, crossId, 'newChild', replacement);
    assert.deepEqual(client('handoff', journal, crossAgent, original, replacement), { metadataUpdated: true });
    const before = client('snapshot', journal);
    for (const worker of ['same', 'cross', 'detached']) assert.equal(before.agents[worker].nativeParent, 'root');
    assert.equal(before.agents.cross.logicalOwner, 'replacement');
    assert.equal(before.agents.newChild.nativeParent, 'replacement');
    console.log(JSON.stringify({ phase: 'lineage-before', ...before }));

    request('agent', 'detach', manual);
    const detached = client('snapshot', journal);
    assert.deepEqual(detached.agents.detached, { ...before.agents.detached, nativeParent: null });
    assert.equal(request('agent', 'archive', original).status, 'archived');
    const after = client('snapshot', journal);
    assert.equal(after.agents.root.archived, true);
    assert.equal(after.agents.same.archived, true);
    assert.equal(after.agents.same.nativeParent, 'root');
    assert.deepEqual(after.agents.cross, { ...before.agents.cross, nativeParent: null });
    assert.deepEqual(after.agents.newChild, before.agents.newChild);
    assert.deepEqual(after.agents.detached, detached.agents.detached);
    assert.ok(Object.values(after.agents).every(({ metadataMatches }) => metadataMatches));
    console.log(JSON.stringify({ phase: 'lineage-after', ...after }));

    stop();
    await checkPort(port);
    assert.deepEqual(client('history', journal), after.journalEvents);
    console.log(JSON.stringify({ phase: 'lineage-offline', journalRecoveredWithoutDaemon: true }));
    start();
    const recovered = client('snapshot', journal);
    assert.deepEqual(recovered, after);
    console.log(JSON.stringify({ phase: 'lineage-restart', identicalSnapshotAndJournal: true }));
  });
}

(phase === 'network' ? network() : workspace()).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
