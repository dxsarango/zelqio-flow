const fs = require('node:fs');
const path = require('node:path');
const {spawnSync} = require('node:child_process');

const [install, home, phase = 'baseline'] = process.argv.slice(2);
const endpoint = '127.0.0.1:16773';
if (!path.isAbsolute(install ?? '') || !path.isAbsolute(home ?? '') || fs.existsSync(home)) {
  throw new Error('Pass the installation directory and a new absolute disposable home.');
}
const profile = path.join(home, 'profile');
const appData = path.join(profile, 'AppData');
const systemRoot = process.env.SystemRoot;
const system32 = path.join(systemRoot, 'System32');
const env = {
  SystemRoot: systemRoot,
  ComSpec: path.join(system32, 'cmd.exe'),
  PATH: [system32, systemRoot].join(';'),
  PATHEXT: '.COM;.EXE;.BAT;.CMD',
  USERPROFILE: profile,
  APPDATA: path.join(appData, 'Roaming'),
  LOCALAPPDATA: path.join(appData, 'Local'),
  TEMP: path.join(profile, 'Temp'),
  TMP: path.join(profile, 'Temp'),
  XDG_CONFIG_HOME: path.join(profile, 'config'),
  XDG_DATA_HOME: path.join(profile, 'data'),
  XDG_CACHE_HOME: path.join(profile, 'cache'),
  ELECTRON_RUN_AS_NODE: '1',
  PASEO_NODE_ENV: 'production',
  PASEO_CLI: path.join(install, 'resources', 'bin', 'paseo.cmd'),
};
for (const name of ['APPDATA', 'LOCALAPPDATA', 'TEMP', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'XDG_CACHE_HOME']) {
  fs.mkdirSync(env[name], {recursive: true});
}
const exe = path.join(install, 'Paseo.exe');
const resources = path.join(install, 'resources');
const entry = [
  '--disable-warning=DEP0040',
  path.join(resources, 'app.asar.unpacked', 'dist', 'daemon', 'node-entrypoint-runner.js'),
  'node-script',
  path.join(resources, 'app.asar', 'node_modules', '@getpaseo', 'cli', 'dist', 'index.js'),
];
const rows = [];
function sanitize(value) {
  if (Array.isArray(value)) return value.map(sanitize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) =>
      [key, /^(account|accountId|serverId|hostname|pid|requestId|token|icon|iconSvg)$/i.test(key)
        ? '<redacted>' : sanitize(item)]));
  }
  if (typeof value !== 'string') return value;
  return value.replaceAll(home, '<sandbox>').replaceAll(install, '<paseo-install>')
    .replace(/\b[A-Z]:[\\/][^\r\n"'<>]+/gi, '<path>')
    .replace(/("(?:hostname|pid)":\s*)(?:"[^\r\n"]*"|\d+)/gi, '$1"<redacted>"')
    .replace(/\bPID \d+/gi, 'PID <redacted>')
    .replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, '<email>');
}
function run(name, args, required = false, sdk = false) {
  const result = spawnSync(exe, sdk ? args : [...entry, ...args], {
    env, cwd: profile, windowsHide: true, encoding: 'utf8', timeout: 95000,
  });
  let output = result.stdout?.trim();
  try { output = JSON.parse(output); } catch {}
  const row = {name, timestamp: new Date().toISOString(), exit: result.status, output};
  if (result.stderr?.trim() || result.error) row.error = result.stderr?.trim() || result.error.message;
  rows.push(sanitize(row));
  console.log(name, result.status);
  if (required && result.status !== 0) throw new Error(name + ' failed');
}
const local = ['--home', home];
const target = ['--host', endpoint];
let started = false;
try {
  run('configure listen', ['daemon', 'config', 'set', ...local, 'daemon.listen', endpoint], true);
  run('disable relay', ['daemon', 'config', 'set', ...local, 'daemon.relay.enabled', 'false'], true);
  run('disable dictation', ['daemon', 'config', 'set', ...local, 'features.dictation.enabled', 'false'], true);
  run('disable voice mode', ['daemon', 'config', 'set', ...local, 'features.voiceMode.enabled', 'false'], true);
  if (phase === 'synthetic') {
    run('enable local plugins', ['daemon', 'config', 'set', ...local, 'pluginsEnabled', 'true'], true);
  }
  run('start', ['daemon', 'start', ...local, '--timeout', '45'], true);
  started = true;
  run('provider ls', ['provider', 'ls', ...target, '--json'], true);
  for (const provider of ['claude', 'codex', 'opencode', 's00-t03-unknown']) {
    run('models ' + provider, ['provider', 'models', provider, ...target, '--thinking', '--json']);
  }
  run('usage ls', ['usage', 'ls', ...target, '--json']);
  run('usage ls refresh', ['usage', 'ls', ...target, '--refresh', '--json']);
  run('plugin ls', ['plugin', 'ls', ...target, '--json']);
  run('sdk', [path.join(__dirname, 'sdk.cjs'), endpoint], false, true);
  run('usage inspect unknown', ['usage', 'inspect', 's00-t03-unknown', ...target, '--json']);
  if (phase === 'synthetic') {
    run('install local source', ['plugin', 'install', path.join(__dirname, 'local-source'), ...target, '--json'], true);
    run('fixture plugin status', ['plugin', 'ls', 's00-t03-quota-probe', ...target, '--json']);
    run('fixture models', ['provider', 'models', 's00-t03-catalog', ...target, '--thinking', '--json']);
    run('fixture usage fresh', ['usage', 'ls', ...target, '--refresh', '--json']);
    run('fixture usage inspect', ['usage', 'inspect', 's00-t03-fixture:available', ...target, '--json']);
    run('fixture usage cached', ['usage', 'ls', ...target, '--json']);
    run('fixture sdk', [path.join(__dirname, 'sdk.cjs'), endpoint], false, true);
    run('fixture usage refreshed', ['usage', 'ls', ...target, '--refresh', '--json']);
  }
} finally {
  run('stop', ['daemon', 'stop', ...local]);
  const filename = phase === 'synthetic' ? 'isolated-synthetic.json' : 'isolated-cli.json';
  fs.writeFileSync(path.join(__dirname, 'fixtures', started ? filename : 'startup-failure.json'),
    JSON.stringify(rows, null, 2) + '\n');
}






