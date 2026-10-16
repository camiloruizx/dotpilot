'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { AppProcess, findLocalUrl, stripAnsi, quoteArgument, commandLine } = require('../src/runner');
const { removeDir } = require('./support');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, timeout = 10000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await check()) return; await sleep(25); }
  throw new Error('timeout');
}
function script(source) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dotpilot-runner-'));
  const file = path.join(dir, 'app.js');
  fs.writeFileSync(file, source);
  return { dir, file, cleanup: () => removeDir(dir) };
}
const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };

test('server announcements are recognised after removing terminal colors', () => {
  assert.equal(findLocalUrl('  \u001b[32m➜\u001b[39m  \u001b[1mLocal\u001b[22m:   \u001b[36mhttp://localhost:\u001b[1m5173\u001b[22m/\u001b[39m\n'), 'http://localhost:5173/');
  assert.equal(findLocalUrl('INFO  Server running on [http://127.0.0.1:8000].\n'), 'http://127.0.0.1:8000');
  assert.equal(findLocalUrl('Development Server (http://localhost:8000) started\n'), 'http://localhost:8000');
  assert.equal(findLocalUrl('Uvicorn running on http://0.0.0.0:8000 (Press CTRL+C to quit)\n'), 'http://0.0.0.0:8000');
  assert.equal(findLocalUrl('Starting development server at http://127.0.0.1:8000/\n'), 'http://127.0.0.1:8000/');
  assert.equal(stripAnsi('\u001b[1mA\u001b[0m'), 'A');
});

test('remote addresses, incomplete URLs and non-http schemes are not treated as the local server', () => {
  assert.equal(findLocalUrl('Network: http://192.168.1.20:5173/\n'), undefined);
  assert.equal(findLocalUrl('see https://example.com/docs\n'), undefined);
  assert.equal(findLocalUrl('listening on http://localhost:51'), undefined);
  assert.equal(findLocalUrl('ws://localhost:5173\n'), undefined);
});

test('arguments are quoted for the shell and dangerous Windows characters are refused', () => {
  assert.equal(quoteArgument('run', 'win32'), 'run');
  assert.equal(quoteArgument('C:\\Program Files\\php\\php.exe', 'win32'), '"C:\\Program Files\\php\\php.exe"');
  assert.throws(() => quoteArgument('a&calc', 'win32'));
  assert.throws(() => quoteArgument('%PATH%', 'win32'));
  assert.equal(quoteArgument("it's", 'linux'), "'it'\\''s'");
  assert.equal(commandLine('npm', ['run', 'dev'], 'win32'), 'npm run dev');
});

test('the process output reaches the handlers and the first local URL is reported once', async () => {
  const s = script(`console.log('boot');console.log('Local: http://localhost:5199/');console.log('Other: http://localhost:6000/');setInterval(()=>{},1000);`);
  const output = [], urls = [];
  const proc = new AppProcess({ command: process.execPath, args: [s.file], cwd: s.dir }, { onOutput: t => output.push(t), onUrl: u => urls.push(u) });
  try {
    proc.start();
    await until(() => urls.length);
    assert.deepEqual(urls, ['http://localhost:5199/']);
    assert.match(output.join(''), /boot/);
    await proc.stop();
    assert.equal(proc.exited, true);
  } finally { await proc.stop(); s.cleanup(); }
});

test('URL detection can be disabled', async () => {
  const s = script(`console.log('http://localhost:5199/');setTimeout(()=>{},300);`);
  const urls = [];
  const proc = new AppProcess({ command: process.execPath, args: [s.file], cwd: s.dir, detectUrl: false }, { onUrl: u => urls.push(u) });
  try {
    proc.start();
    await until(() => proc.exited);
    assert.deepEqual(urls, []);
  } finally { s.cleanup(); }
});

test('stop ends the whole process tree, not only the launcher', async () => {
  const marker = path.join(os.tmpdir(), `dotpilot-child-${process.pid}-${Date.now()}.pid`);
  const s = script(`
    const { spawn } = require('node:child_process');
    const child = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: 'ignore' });
    require('node:fs').writeFileSync(${JSON.stringify(marker)}, String(child.pid));
    console.log('ready');
    setInterval(()=>{},1000);
  `);
  const exits = [];
  let ready = false;
  const proc = new AppProcess({ command: process.execPath, args: [s.file], cwd: s.dir }, { onOutput: t => { if (/ready/.test(t)) ready = true; }, onExit: code => exits.push(code) });
  try {
    proc.start();
    await until(() => ready && fs.existsSync(marker));
    const grandchild = Number(fs.readFileSync(marker, 'utf8'));
    assert.ok(alive(grandchild));
    await proc.stop();
    await until(() => !alive(grandchild), 8000);
    await until(() => exits.length === 1);
  } finally { await proc.stop(); fs.rmSync(marker, { force: true }); s.cleanup(); }
});

test('the cleanup command (docker compose down) runs after the process is stopped, once', async () => {
  const marker = path.join(os.tmpdir(), `dotpilot-stop-${process.pid}-${Date.now()}.log`);
  const stopper = script(`require('node:fs').appendFileSync(${JSON.stringify(marker)}, 'down\\n');`);
  const s = script(`console.log('up');setInterval(()=>{},1000);`);
  let ready = false;
  const proc = new AppProcess({ command: process.execPath, args: [s.file], cwd: s.dir, stop: { command: process.execPath, args: [stopper.file] } },
    { onOutput: t => { if (/up/.test(t)) ready = true; } });
  try {
    proc.start();
    await until(() => ready);
    await Promise.all([proc.stop(), proc.stop()]);
    assert.equal(fs.readFileSync(marker, 'utf8'), 'down\n');
  } finally { fs.rmSync(marker, { force: true }); s.cleanup(); stopper.cleanup(); }
});

test('a missing executable is reported instead of crashing', async () => {
  const errors = [], exits = [];
  const proc = new AppProcess({ command: 'dotpilot-no-such-command', args: [], cwd: os.tmpdir() }, { onError: e => errors.push(e), onExit: c => exits.push(c), onOutput() {} });
  proc.start();
  await until(() => exits.length);
  assert.ok(exits[0] !== 0);
});

test('only .cmd shims go through the shell; real executables get their arguments untouched', async () => {
  const { needsShell } = require('../src/runner');
  assert.equal(needsShell('npm', 'win32'), true);
  assert.equal(needsShell('C:\Tools\yarn.cmd', 'win32'), true);
  for (const command of ['dotnet', 'php', 'C:\Python\python.exe', 'docker']) assert.equal(needsShell(command, 'win32'), false, command);
  assert.equal(needsShell('npm', 'linux'), false);
  // Una ruta con espacios, & y % no puede romper un ejecutable lanzado directamente.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dotpilot R&D 100% '));
  const file = path.join(dir, 'a & b.js');
  fs.writeFileSync(file, "console.log('hello from ' + require('path').basename(__filename));");
  const output = [];
  const proc = new AppProcess({ command: process.execPath, args: [file], cwd: dir }, { onOutput: text => output.push(text) });
  try {
    proc.start();
    await until(() => proc.exited);
    assert.match(output.join(''), /hello from a & b.js/);
  } finally { removeDir(dir); }
});

test('an argument that cannot be quoted safely for cmd.exe is refused before anything starts', () => {
  const proc = new AppProcess({ command: 'npm', args: ['run', 'a&b'], cwd: os.tmpdir(), platform: 'win32' }, {});
  assert.throws(() => proc.start(), /no admitido/);
  assert.equal(proc.child, undefined);
});

test('a very chatty server stops being scanned for a URL', async () => {
  const s = script(`const line='x'.repeat(1000)+'\n';for(let i=0;i<400;i++)process.stdout.write(line);setTimeout(()=>console.log('http://localhost:5199/'),150);setTimeout(()=>{},400);`);
  const urls = [];
  const proc = new AppProcess({ command: process.execPath, args: [s.file], cwd: s.dir }, { onUrl: u => urls.push(u) });
  try {
    proc.start();
    await until(() => proc.exited);
    assert.deepEqual(urls, [], 'detection stopped after the scan budget');
  } finally { s.cleanup(); }
});
