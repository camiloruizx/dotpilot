'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const net = require('node:net');
const { findInstall, readVirtualHosts, siteUrl, profileFor, addApacheProfiles } = require('../src/laragon');
const { AppProcess } = require('../src/runner');

// Sistema de archivos falso con rutas de Windows (las claves usan / por comodidad).
function fakeFs(files) {
  const SEP = String.fromCharCode(92);
  const key = value => path.win32.normalize(String(value)).replace(/\\+$/, '').toLowerCase();
  // Se conserva la ruta original para que los listados devuelvan los nombres con sus mayúsculas, como un disco real.
  const map = new Map(Object.entries(files).map(([name, content]) => [key(name), { original: path.win32.normalize(name), content }]));
  const children = (dir, wantDirectories) => {
    const base = key(dir) + SEP;
    const names = new Map();
    for (const [file, entry] of map) {
      if (!file.startsWith(base)) continue;
      const rest = file.slice(base.length).split(SEP);
      if (wantDirectories ? rest.length <= 1 : rest.length !== 1) continue;
      const original = entry.original.split(SEP);
      names.set(rest[0], original[original.length - rest.length] ?? rest[0]);
    }
    return [...names.values()];
  };
  return {
    exists: async file => map.has(key(file)) || children(file, false).length + children(file, true).length > 0,
    readFile: async file => map.get(key(file))?.content ?? '',
    listDirectories: async dir => children(dir, true),
    listFiles: async dir => children(dir, false)
  };
}

const APACHE = 'C:/laragon/bin/apache/httpd-2.4.68-260617-Win64-VS18';
const laragon = (extra = {}) => ({
  'C:/laragon/laragon.exe': '',
  [`${APACHE}/bin/httpd.exe`]: '',
  [`${APACHE}/conf/httpd.conf`]: 'Listen 80\nErrorLog "logs/error_log"\n',
  'C:/laragon/usr/laragon.ini': '[preferences]\nFirstRun=0\n\n[apache]\nUse=-1\nDocumentRoot=C:\\laragon\\www\n',
  'C:/laragon/bin/mysql/mysql-8.4.3-winx64/my.ini': '[client]\nport=3306\n[mysqld]\nport=3307\n',
  'C:/Windows/System32/drivers/etc/hosts': '127.0.0.1      shop.test      #laragon magic!\n127.0.0.1 api.shop.test\n',
  'C:/laragon/etc/apache2/sites-enabled/auto.shop.test.conf':
    '<VirtualHost *:80>\n    DocumentRoot "C:/laragon/www/shop"\n    ServerName shop.test\n    ServerAlias *.shop.test\n</VirtualHost>\n',
  'C:/laragon/etc/apache2/sites-enabled/ssl.shop.conf':
    '<VirtualHost *:443>\n    DocumentRoot "C:/laragon/www/shop"\n    ServerName shop.test\n</VirtualHost>\n',
  'C:/laragon/www/shop/index.php': '<?php',
  'C:/laragon/www/plain/index.php': '<?php',
  ...extra
});

test('the Laragon install, its Apache, log, ports and document root are read from its own files', async () => {
  const install = await findInstall(fakeFs(laragon()), 'C:/laragon/www/shop');
  assert.equal(install.root, path.win32.normalize('C:/laragon'));
  assert.equal(install.httpd, path.win32.normalize(`${APACHE}/bin/httpd.exe`));
  assert.equal(install.conf, path.win32.normalize(`${APACHE}/conf/httpd.conf`));
  assert.equal(install.errorLog, path.win32.normalize(`${APACHE}/logs/error_log`));
  assert.equal(install.port, 80);
  assert.equal(install.mysqlPort, 3307, 'the [mysqld] port, not the [client] one');
  assert.equal(install.www.toLowerCase(), 'c:\\laragon\\www');
});

test('the newest Apache is used and an install without Apache is not Laragon-ready', async () => {
  const files = laragon({
    'C:/laragon/bin/apache/httpd-2.4.50-Win64/bin/httpd.exe': '', 'C:/laragon/bin/apache/httpd-2.4.50-Win64/conf/httpd.conf': 'Listen 80\n'
  });
  assert.match((await findInstall(fakeFs(files), 'C:/laragon/www/shop')).httpd, /2\.4\.68/);
  assert.equal(await findInstall(fakeFs({ 'C:/laragon/laragon.exe': '' }), 'C:/laragon/www/shop'), undefined);
  assert.equal(await findInstall(fakeFs({}), 'C:/work/app'), undefined);
});

test('the site URL comes from the virtual host when its name resolves, and from localhost otherwise', async () => {
  const io = fakeFs(laragon());
  const install = await findInstall(io, 'C:/laragon/www/shop');
  assert.deepEqual((await readVirtualHosts(io, install)).map(h => h.serverName), ['shop.test'], 'SSL blocks are ignored');
  assert.equal(await siteUrl(io, install, 'C:/laragon/www/shop'), 'http://shop.test/');
  assert.equal(await siteUrl(io, install, 'C:/laragon/www/shop/admin'), 'http://shop.test/admin/');
  // sin virtual host: ruta bajo localhost
  assert.equal(await siteUrl(io, install, 'C:/laragon/www/plain'), 'http://localhost/plain/');
  // un virtual host cuyo nombre no está en hosts no se usa (no abriría)
  const noHosts = fakeFs(laragon({ 'C:/Windows/System32/drivers/etc/hosts': '' }));
  assert.equal(await siteUrl(noHosts, await findInstall(noHosts, 'C:/laragon/www/shop'), 'C:/laragon/www/shop'), 'http://localhost/shop/');
  // fuera de www y sin virtual host: no hay forma de servirlo
  assert.equal(await siteUrl(io, install, 'C:/other/app'), undefined);
});

test('a project outside www is served when a virtual host points at it, including Laravel public folders', async () => {
  const io = fakeFs(laragon({
    'C:/laragon/etc/apache2/sites-enabled/custom.conf': '<VirtualHost *:80>\nDocumentRoot "D:/code/blog/public"\nServerName blog.test\n</VirtualHost>',
    'C:/Windows/System32/drivers/etc/hosts': '127.0.0.1 blog.test\n'
  }));
  const install = await findInstall(io, 'D:/code/blog', ['C:/laragon']);
  assert.equal(await siteUrl(io, install, 'D:/code/blog/public'), 'http://blog.test/');
});

test('the Apache profile carries everything the script needs and nothing from the user', async () => {
  const profile = await profileFor(fakeFs(laragon()), 'C:/laragon/www/shop', { script: 'C:/ext/assets/laragon.ps1' });
  assert.equal(profile.name, 'apache');
  assert.equal(profile.label, 'Apache (Laragon)');
  assert.equal(profile.command, 'powershell');
  assert.deepEqual(profile.args.slice(0, 5), ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File']);
  assert.equal(profile.url, 'http://shop.test/');
  assert.equal(profile.fixedUrl, true);
  assert.equal(profile.env.DOTPILOT_PORT, '80');
  assert.equal(profile.env.DOTPILOT_MYSQL_PORT, '3307');
  assert.deepEqual(JSON.parse(profile.env.DOTPILOT_HTTPD_ARGS), ['-f', path.win32.normalize(`${APACHE}/conf/httpd.conf`)]);
});

test('PHP projects get the Apache profile first; other kinds and other platforms are untouched', async () => {
  const io = fakeFs(laragon());
  const apps = () => [
    { kind: 'php', dir: 'C:/laragon/www/shop', profiles: [{ name: 'php -S' }] },
    { kind: 'node', dir: 'C:/laragon/www/shop', profiles: [{ name: 'dev' }] },
    { kind: 'php', dir: 'C:/elsewhere', profiles: [{ name: 'php -S' }] }
  ];
  const result = await addApacheProfiles(apps(), io, { script: 'x.ps1' }, 'win32');
  assert.deepEqual(result.map(app => app.profiles.map(p => p.name)), [['apache', 'php -S'], ['dev'], ['php -S']]);
  const linux = await addApacheProfiles(apps(), io, { script: 'x.ps1' }, 'linux');
  assert.deepEqual(linux.map(app => app.profiles.map(p => p.name)), [['php -S'], ['dev'], ['php -S']]);
  const broken = { ...io, readFile: async () => { throw new Error('boom'); } };
  assert.deepEqual((await addApacheProfiles(apps(), broken, { script: 'x.ps1' }, 'win32'))[0].profiles.map(p => p.name), ['php -S']);
});

// ---- El script de PowerShell, con node.exe como «httpd» ----

const onWindows = process.platform === 'win32';
const script = path.join(__dirname, '..', 'assets', 'laragon.ps1');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, timeout = 20000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await check()) return; await sleep(50); }
  throw new Error('timeout');
}
const portOpen = port => new Promise(resolve => {
  const socket = net.connect({ port, host: '127.0.0.1' });
  socket.setTimeout(300);
  socket.once('connect', () => { socket.destroy(); resolve(true); });
  socket.once('timeout', () => { socket.destroy(); resolve(false); });
  socket.once('error', () => resolve(false));
});
function freePort() {
  return new Promise(resolve => { const server = net.createServer().listen(0, '127.0.0.1', () => { const { port } = server.address(); server.close(() => resolve(port)); }); });
}

function scriptRun({ port, log, serverSource, extraEnv = {} }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dotpilot-laragon-'));
  const server = path.join(dir, 'server.js');
  fs.writeFileSync(server, serverSource);
  const output = [];
  const proc = new AppProcess({
    command: 'powershell', cwd: dir, detectUrl: true,
    args: ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script],
    env: {
      DOTPILOT_HTTPD: process.execPath, DOTPILOT_HTTPD_ARGS: JSON.stringify([server]), DOTPILOT_ERROR_LOG: log,
      DOTPILOT_PORT: String(port), DOTPILOT_MYSQL_PORT: '', DOTPILOT_LANG: 'en', ...extraEnv
    }
  }, { onOutput: text => output.push(text) });
  return { proc, output, dir, text: () => output.join('') };
}
const listener = port => `require('net').createServer(s => s.end()).listen(${port}, '127.0.0.1'); setInterval(() => {}, 1000);`;

test('the script starts Apache, shows the live error log, and Stop ends Apache and its children', { skip: !onWindows }, async () => {
  const port = await freePort();
  const log = path.join(os.tmpdir(), `dotpilot-apache-${process.pid}-${port}.log`);
  fs.writeFileSync(log, 'old line\n');
  const run = scriptRun({ port, log, serverSource: listener(port) });
  try {
    run.proc.start();
    await until(() => portOpen(port));
    await until(() => /http:\/\/127\.0\.0\.1:\d+\//.test(run.text()));
    assert.match(run.text(), /Apache started \(PID \d+\) on port/);
    assert.equal(run.proc.url, `http://127.0.0.1:${port}/`);
    // Solo se ve lo nuevo del registro (errores de PHP incluidos).
    fs.appendFileSync(log, '[php:error] PHP Fatal error: boom in index.php\n');
    await until(() => /PHP Fatal error: boom/.test(run.text()));
    assert.doesNotMatch(run.text(), /old line/);
    await run.proc.stop();
    await until(async () => !(await portOpen(port)), 10000);
  } finally { await run.proc.stop(); fs.rmSync(run.dir, { recursive: true, force: true }); fs.rmSync(log, { force: true }); }
});

test('an Apache that is already running is reused and survives Stop', { skip: !onWindows }, async () => {
  const port = await freePort();
  const existing = spawn(process.execPath, ['-e', listener(port)], { stdio: 'ignore' });
  const log = path.join(os.tmpdir(), `dotpilot-apache-${process.pid}-${port}.log`);
  fs.writeFileSync(log, '');
  const run = scriptRun({ port, log, serverSource: 'throw new Error("must not be started")' });
  try {
    await until(() => portOpen(port));
    run.proc.start();
    await until(() => /already running on port/.test(run.text()));
    await until(() => /http:\/\/127\.0\.0\.1:\d+\//.test(run.text()));
    await run.proc.stop();
    assert.equal(await portOpen(port), true, 'the existing Apache must not be closed');
  } finally { existing.kill(); await run.proc.stop(); fs.rmSync(run.dir, { recursive: true, force: true }); fs.rmSync(log, { force: true }); }
});

test('an Apache that dies on start is reported with the last lines of its log', { skip: !onWindows }, async () => {
  const port = await freePort();
  const log = path.join(os.tmpdir(), `dotpilot-apache-${process.pid}-${port}.log`);
  fs.writeFileSync(log, 'AH00526: Syntax error on line 12\n');
  const exits = [];
  const run = scriptRun({ port, log, serverSource: 'process.exit(3)' });
  run.proc.handlers.onExit = code => exits.push(code);
  try {
    run.proc.start();
    await until(() => exits.length);
    assert.equal(exits[0], 1);
    assert.match(run.text(), /exited with code 3 before opening port/);
    assert.match(run.text(), /AH00526: Syntax error on line 12/);
  } finally { await run.proc.stop(); fs.rmSync(run.dir, { recursive: true, force: true }); fs.rmSync(log, { force: true }); }
});

test('the script warns when MySQL does not answer and lets non-ASCII text through', { skip: !onWindows }, async () => {
  const port = await freePort();
  const mysql = await freePort();
  const log = path.join(os.tmpdir(), `dotpilot-apache-${process.pid}-${port}.log`);
  fs.writeFileSync(log, '');
  const run = scriptRun({ port, log, serverSource: listener(port), extraEnv: { DOTPILOT_MYSQL_PORT: String(mysql), DOTPILOT_LANG: 'es' } });
  try {
    run.proc.start();
    await until(() => /Aviso: MySQL no responde en el puerto/.test(run.text()));
    assert.match(run.text(), /Apache iniciado/);
  } finally { await run.proc.stop(); fs.rmSync(run.dir, { recursive: true, force: true }); fs.rmSync(log, { force: true }); }
});

test('an Apache that never opens its port is closed by the script, not left orphaned', { skip: !onWindows }, async () => {
  const port = await freePort();
  const log = path.join(os.tmpdir(), `dotpilot-apache-${process.pid}-${port}.log`);
  const pidFile = path.join(os.tmpdir(), `dotpilot-apache-${process.pid}-${port}.pid`);
  fs.writeFileSync(log, '');
  const source = `require('fs').writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); setInterval(() => {}, 1000);`;
  const exits = [];
  const run = scriptRun({ port, log, serverSource: source, extraEnv: { DOTPILOT_START_TIMEOUT: '2' } });
  run.proc.handlers.onExit = code => exits.push(code);
  const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };
  try {
    run.proc.start();
    await until(() => exits.length, 30000);
    assert.equal(exits[0], 1);
    assert.ok(run.text().includes('did not open port'), run.text());
    const pid = Number(fs.readFileSync(pidFile, 'utf8'));
    await until(() => !alive(pid), 10000);
  } finally { await run.proc.stop(); fs.rmSync(run.dir, { recursive: true, force: true }); fs.rmSync(log, { force: true }); fs.rmSync(pidFile, { force: true }); }
});
