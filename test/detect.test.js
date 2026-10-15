'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { detectWorkspace, addPhpEntries, parseCompose, scriptPort, MARKERS, MAX_DIRS } = require('../src/detect');

const ROOT = path.resolve('/work');
const at = (...parts) => path.join(ROOT, ...parts);

// Sistema de archivos falso: ruta absoluta -> contenido.
function workspace(entries) {
  const fsMap = new Map(Object.entries(entries).map(([name, content]) => [at(...name.split('/')), content]));
  const files = new Map();
  for (const file of fsMap.keys()) {
    const name = path.basename(file);
    if (!MARKERS.includes(name)) continue;
    const dir = path.dirname(file);
    if (!files.has(dir)) files.set(dir, new Set());
    files.get(dir).add(name);
  }
  const io = { read: async file => fsMap.get(file) ?? '', exists: async file => fsMap.has(file) };
  return { files, io };
}
// roots: carpetas del espacio de trabajo donde se busca index.php; por omisión, ninguna.
async function detect(entries, platform = 'linux', roots = []) {
  const { files, io } = workspace(entries);
  const folders = new Set();
  for (const name of Object.keys(entries)) {
    const parts = name.split('/').slice(0, -1);
    for (let i = 1; i <= parts.length; i++) folders.add(parts.slice(0, i).join('/'));
  }
  const list = async dir => [...folders].map(folder => folder.split('/')).filter(parts => at(...parts.slice(0, -1)) === dir).map(parts => parts.at(-1));
  await addPhpEntries(files, roots.map(root => at(...root.split('/').filter(Boolean))), io.exists, list);
  return detectWorkspace(files, io, platform);
}

test('Vite + React uses the package manager from the lockfile and the default Vite port', async () => {
  const [app] = await detect({
    'web/package.json': JSON.stringify({ name: 'web', scripts: { dev: 'vite', build: 'vite build' }, dependencies: { react: '^18' }, devDependencies: { vite: '^5' } }),
    'web/pnpm-lock.yaml': ''
  });
  assert.equal(app.kind, 'node');
  assert.equal(app.framework, 'React + Vite');
  assert.equal(app.marker, at('web', 'package.json'));
  assert.deepEqual(app.profiles.map(p => [p.name, p.command, p.args, p.url, p.launchBrowser]), [['dev', 'pnpm', ['run', 'dev'], 'http://localhost:5173', true]]);
});

test('ports come from explicit script flags, then Vite config, then .env, then the tool default', async () => {
  const [flag, config, env, angular] = await detect({
    'a/package.json': JSON.stringify({ scripts: { start: 'node server.js --port 4100' } }),
    'b/package.json': JSON.stringify({ scripts: { dev: 'vite' }, devDependencies: { vite: '5' } }),
    'b/vite.config.ts': 'export default { server: { port: 3001 } }',
    'c/package.json': JSON.stringify({ scripts: { start: 'node index.js' } }),
    'c/.env': 'NAME=x\nPORT=4500\n',
    'd/package.json': JSON.stringify({ scripts: { start: 'ng serve' }, dependencies: { '@angular/core': '17' } })
  });
  assert.equal(flag.profiles[0].url, 'http://localhost:4100');
  assert.equal(config.profiles[0].url, 'http://localhost:3001');
  assert.equal(env.profiles[0].url, 'http://localhost:4500');
  assert.equal(angular.framework, 'Angular');
  assert.equal(angular.profiles[0].url, 'http://localhost:4200');
  assert.equal(scriptPort('PORT=8080 node a.js'), 8080);
  assert.equal(scriptPort('vite -p 3002'), 3002);
});

test('package.json without a runnable script, or with malformed JSON, is ignored', async () => {
  assert.deepEqual(await detect({
    'lib/package.json': JSON.stringify({ name: 'lib', scripts: { build: 'tsc', test: 'jest' } }),
    'broken/package.json': '{ not json'
  }), []);
});

test('script names that could break out of a command are never offered', async () => {
  const apps = await detect({ 'x/package.json': JSON.stringify({ scripts: { 'dev; calc': 'x', dev: 'vite' } }) });
  assert.deepEqual(apps[0].profiles.map(p => p.name), ['dev']);
});

test('Laravel runs artisan serve; its Vite plugin does not open the browser', async () => {
  const apps = await detect({
    'shop/artisan': '',
    'shop/composer.json': '{"require":{"laravel/framework":"^11"}}',
    'shop/public/index.php': '<?php',
    'shop/package.json': JSON.stringify({ scripts: { dev: 'vite' }, devDependencies: { vite: '5', 'laravel-vite-plugin': '1' } })
  });
  assert.deepEqual(apps.map(a => [a.kind, a.framework]), [['php', 'Laravel'], ['node', 'Vite (assets)']]);
  assert.deepEqual(apps[0].profiles[0].args, ['artisan', 'serve']);
  assert.equal(apps[0].profiles[0].url, 'http://127.0.0.1:8000');
  assert.equal(apps[1].profiles[0].launchBrowser, false);
});

test('a plain PHP site is served from its public folder when it has one', async () => {
  const [root, publicSite] = await detect({
    'plain/index.php': '<?php',
    'site/composer.json': '{}',
    'site/public/index.php': '<?php'
  }, 'linux', ['plain']);
  assert.equal(root.profiles[0].args.at(-1), '.');
  assert.deepEqual(publicSite.profiles[0].args, ['-S', 'localhost:8000', '-t', 'public']);
  assert.equal(publicSite.marker, at('site', 'composer.json'));
});

test('Django, FastAPI and Flask get their own dev server command', async () => {
  const apps = await detect({
    'dj/manage.py': '',
    'api/requirements.txt': 'fastapi==0.110\nuvicorn\n',
    'api/app/main.py': '',
    'fl/requirements.txt': 'Flask>=3\n',
    'fl/app.py': ''
  });
  const by = name => apps.find(a => a.framework === name);
  assert.deepEqual(by('Django').profiles[0].args, ['manage.py', 'runserver']);
  assert.deepEqual(by('FastAPI').profiles[0].args, ['-m', 'uvicorn', 'app.main:app', '--reload']);
  assert.equal(by('FastAPI').profiles[0].url, 'http://localhost:8000');
  assert.deepEqual(by('Flask').profiles[0].args, ['-m', 'flask', 'run', '--debug']);
  assert.equal(by('Flask').profiles[0].url, 'http://localhost:5000');
});

test('a project virtual environment is preferred over the system Python', async () => {
  const [app] = await detect({
    'dj/manage.py': '',
    'dj/.venv/bin/python': ''
  });
  assert.equal(app.profiles[0].command, at('dj', '.venv', 'bin', 'python'));
  const [bare] = await detect({ 'dj/manage.py': '' }, 'win32');
  assert.equal(bare.profiles[0].command, 'python');
  const [unix] = await detect({ 'dj/manage.py': '' }, 'linux');
  assert.equal(unix.profiles[0].command, 'python3');
});

test('a lone Python file is only a project when dependencies are declared', async () => {
  assert.deepEqual(await detect({ 'tool/main.py': '', 'tool/pyproject.toml': '' }), []);
  const [app] = await detect({ 'tool/main.py': '', 'tool/requirements.txt': 'requests\n' });
  assert.equal(app.framework, 'Python');
  assert.deepEqual(app.profiles[0].args, ['main.py']);
  assert.equal(app.profiles[0].launchBrowser, false);
});

test('Docker Compose offers the whole environment and each service, and stops with down', async () => {
  const [app] = await detect({
    'stack/compose.yaml': [
      'name: demo', 'services:',
      '  db:', '    image: postgres', '    ports:', '      - "5432:5432"',
      '  web:', '    build: .', '    ports:', '      - "127.0.0.1:8080:80"  # http',
      '  worker:', '    image: x',
      'volumes:', '  data: {}', ''
    ].join('\n')
  });
  assert.equal(app.kind, 'docker');
  assert.deepEqual(app.profiles.map(p => p.name), ['*', 'db', 'web', 'worker']);
  const all = app.profiles[0];
  assert.deepEqual(all.args, ['compose', '-f', 'compose.yaml', 'up']);
  assert.deepEqual(all.stop, { command: 'docker', args: ['compose', '-f', 'compose.yaml', 'down'] });
  assert.equal(all.url, 'http://localhost:8080');
  assert.equal(app.profiles[1].url, '');
  assert.equal(app.profiles[1].launchBrowser, false);
  assert.deepEqual(app.profiles[2].args.slice(-2), ['up', 'web']);
  assert.equal(app.profiles[3].url, '');
});

test('compose parsing handles long syntax, aligned lists, inline lists and variable ports', () => {
  const services = parseCompose([
    'services:',
    '  a:',
    '    ports:',
    '    - 3000:3000',
    '    - "9000-9010:9000"',
    '    environment:',
    '      - A=1:2',
    '  b:',
    '    ports:',
    '      - target: 80',
    '        published: 8081',
    '  c:',
    '    ports: ["7000:70", "7001:71/tcp"]',
    '  d:',
    '    ports:',
    '      - "${PORT:-9090}:80"',
    '      - 4000',
    ''
  ].join('\r\n'));
  assert.deepEqual(services.map(s => [s.name, s.ports]), [['a', [3000]], ['b', [8081]], ['c', [7000, 7001]], ['d', []]]);
});

test('index.php alone does not make a project: CMS trees with thousands of them stay quiet', async () => {
  const entries = {};
  for (let i = 0; i < 50; i++) entries[`wp/wp-content/plugins/p${i}/index.php`] = '<?php // silence';
  entries['wp/index.php'] = '<?php';
  assert.deepEqual(await detect(entries), []);
  const [site] = await detect(entries, 'linux', ['wp']);
  assert.equal(site.kind, 'php');
  assert.equal(site.dir, at('wp'));
});

test('very large workspaces are bounded and the shallowest projects win', async () => {
  const entries = {};
  for (let i = 0; i < MAX_DIRS + 50; i++) entries[`deep/a/b/c/pkg${String(i).padStart(4, '0')}/package.json`] = JSON.stringify({ scripts: { dev: 'vite' } });
  entries['top/package.json'] = JSON.stringify({ scripts: { dev: 'vite' } });
  const started = Date.now();
  const apps = await detect(entries);
  assert.equal(apps.length, MAX_DIRS);
  assert.ok(apps.some(app => app.dir === at('top')), 'the shallow project must be kept');
  assert.ok(Date.now() - started < 2000);
});

test('a workspace of folders finds each plain PHP project, but not the folders of a CMS', async () => {
  const apps = await detect({ 'shop/index.php': '<?php', 'blog/public/index.php': '<?php', 'docs/readme.md': '' }, 'linux', ['']);
  assert.deepEqual(apps.map(app => path.basename(app.dir)), ['blog', 'shop']);
  const cms = await detect({ 'index.php': '<?php', 'wp-admin/index.php': '<?php', 'wp-content/index.php': '<?php' }, 'linux', ['']);
  assert.equal(cms.length, 1);
  assert.equal(cms[0].dir, at());
});

test('a VS Code extension is listed for packaging even without run scripts, and keeps its own package script', async () => {
  const [app] = await detect({
    'ext/package.json': JSON.stringify({ name: 'ext', engines: { vscode: '^1.85.0' }, scripts: { package: 'vsce package', test: 'node --test' } }),
    'ext/yarn.lock': ''
  });
  assert.equal(app.kind, 'node');
  assert.equal(app.framework, 'VS Code Extension');
  assert.deepEqual(app.profiles, []);
  assert.deepEqual(app.packaging, { kind: 'vsix', script: 'package', manager: 'yarn' });
  const [bare] = await detect({ 'ext/package.json': JSON.stringify({ engines: { vscode: '^1.85.0' } }) });
  assert.deepEqual(bare.packaging, { kind: 'vsix', script: '', manager: 'npm' });
});

test('an Expo project is detected as Expo and offers an APK profile from eas.json and/or the android folder', async () => {
  const manifest = JSON.stringify({ name: 'app', scripts: { start: 'expo start' }, dependencies: { expo: '~54.0.0', react: '19', 'react-native': '0.81' } });
  const eas = JSON.stringify({ build: { development: { developmentClient: true }, preview: { android: { buildType: 'apk' } }, production: {} } });
  const [app] = await detect({ 'app/package.json': manifest, 'app/eas.json': eas, 'app/android/gradlew': '' });
  assert.equal(app.framework, 'Expo');
  assert.deepEqual(app.packaging, { kind: 'apk', easProfile: 'preview', local: true });
  const [none] = await detect({ 'app/package.json': manifest, 'app/eas.json': JSON.stringify({ build: { production: {} } }) });
  assert.deepEqual(none.packaging, { kind: 'apk', easProfile: '', local: false });
  const [plain] = await detect({ 'web/package.json': JSON.stringify({ scripts: { dev: 'vite' }, devDependencies: { vite: '^5' } }) });
  assert.equal(plain.packaging, undefined);
});
