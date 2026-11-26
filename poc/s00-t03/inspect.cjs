const fs = require('node:fs');
const path = require('node:path');

const resources = path.join(path.dirname(process.execPath), 'resources');
const bundled = path.join(resources, 'app.asar', 'node_modules', '@getpaseo');
const mode = process.argv[2];
const relative = process.argv[3];

if (mode === 'read') {
  console.log(fs.readFileSync(path.join(resources, relative), 'utf8'));
} else if (mode === 'search') {
  const pattern = new RegExp(process.argv[4], 'i');
  const root = path.join(resources, relative);
  for (const file of fs.readdirSync(root, {recursive: true}).sort()) {
    if (!/\.(?:js|mjs|ts|json)$/.test(file)) continue;
    const lines = fs.readFileSync(path.join(root, file), 'utf8').split('\n');
    for (const [index, line] of lines.entries()) {
      if (pattern.test(line)) console.log(file + ':' + (index + 1) + ' ' + line.trim().slice(0, 240));
    }
  }
} else {
  for (const name of ['plugin', 'protocol', 'server', 'cli', 'client']) {
    const root = path.join(bundled, name);
    const {version, exports} = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    console.log(name, version, JSON.stringify(exports));
  }
  const plugins = path.join(resources, 'builtin-plugins');
  console.log(fs.readdirSync(plugins, {recursive: true}).filter(file => /usage-source/.test(file)));
}
