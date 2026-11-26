const path = require('node:path');
const fs = require('node:fs');
const {pathToFileURL} = require('node:url');

async function main() {
  const root = path.join(path.dirname(process.execPath), 'resources', 'app.asar',
    'node_modules', '@getpaseo', 'client');
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const publicEntry = manifest.exports['.'].default;
  const {createPaseoClient} = await import(pathToFileURL(path.join(root, publicEntry)).href);
  const client = createPaseoClient({url: 'ws://' + process.argv[2] + '/ws'});
  const results = {};
  async function capture(name, call) {
    try {
      results[name] = await call();
    } catch (error) {
      results[name] = {error: error.message, code: error.code};
    }
  }
  try {
    await client.connect();
    await capture('snapshot', () => client.providers.snapshot());
    await capture('ready', () => client.providers.waitForReady({timeoutMs: 20000}));
    await capture('conditionalSnapshot', () =>
      client.providers.snapshot({ifNoneMatch: results.ready?.snapshotHash, requestId: 'conditional'}));
    for (const provider of ['claude', 'codex', 'opencode']) {
      await capture(provider + 'Diagnostic', () => client.providers.diagnostic(provider));
    }
    await capture('usage', () => client.providers.listUsage());
    await capture('usageAgain', () => client.providers.listUsage({requestId: 'repeat'}));
  } finally {
    await client.close();
  }
  console.log(JSON.stringify(results));
}
main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});

