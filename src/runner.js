'use strict';
// Ejecuta servidores de desarrollo que no son .NET: lanza el proceso, reenvía su salida,
// detecta la URL local en que escucha y lo detiene junto con sus procesos hijos.
// No depende de VS Code, así que se prueba con procesos reales de Node.
const path = require('node:path');
const { spawn, execFile } = require('node:child_process');

const SCAN_LIMIT = 256 * 1024;
const ANSI = /\u001b(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007\u001b]*(?:\u0007|\u001b\\)|[@-Z\\-_])/g;
const LOCAL_URL = /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1?\])(?::\d{1,5})?(?:\/[^\s\])'"<>,;]*)?(?=[\s\])'",;>)])/;

function stripAnsi(text) { return String(text).replace(ANSI, ''); }

// Devuelve la primera URL local de http(s) que esté completa (seguida de un separador).
function findLocalUrl(text) {
  const match = LOCAL_URL.exec(stripAnsi(text));
  return match ? match[0] : undefined;
}

function quoteArgument(value, platform = process.platform) {
  const text = String(value);
  if (/^[\w@+=:,./\\-]+$/.test(text)) return text;
  if (platform === 'win32') {
    if (/["%^&|<>\r\n]/.test(text)) throw new Error(`Argumento no admitido: ${text}`);
    return `"${text}"`;
  }
  return `'${text.replace(/'/g, "'\\''")}'`;
}

function commandLine(command, args, platform = process.platform) {
  return [command, ...args].map(part => quoteArgument(part, platform)).join(' ');
}

// En Windows npm, yarn y pnpm son scripts .cmd y solo se ejecutan a través de cmd.exe. dotnet, php, python
// y docker son ejecutables: se lanzan directamente, sin intérprete, así que rutas con espacios, & o % funcionan.
const SHIMS = new Set(['npm', 'npx', 'pnpm', 'yarn', 'yarnpkg', 'corepack']);
function needsShell(command, platform = process.platform) {
  if (platform !== 'win32') return false;
  const name = path.basename(String(command)).toLowerCase();
  return SHIMS.has(name) || /.(cmd|bat)$/.test(name);
}

// Termina el proceso y sus hijos y espera a que de verdad haya salido (con un tope), para que quien
// detiene pueda confiar en que el puerto y los archivos ya quedaron libres.
function killTree(child, platform = process.platform) {
  return new Promise(resolve => {
    if (!child || child.exitCode !== null || child.signalCode !== null || !child.pid) { resolve(); return; }
    let timer;
    const done = () => { clearTimeout(timer); resolve(); };
    child.once('exit', done);
    timer = setTimeout(() => {
      if (platform !== 'win32') { try { process.kill(-child.pid, 'SIGKILL'); } catch { /* ya terminó */ } }
      resolve();
    }, 5000);
    if (platform === 'win32') {
      execFile('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true }, () => {});
    } else {
      try { process.kill(-child.pid, 'SIGTERM'); } catch { try { child.kill('SIGTERM'); } catch { done(); } }
    }
  });
}

class AppProcess {
  // spec: { command, args, cwd, env, stop: { command, args }, detectUrl }
  constructor(spec, handlers = {}) {
    this.spec = spec;
    this.handlers = handlers;
    this.platform = spec.platform || process.platform;
    this.buffer = '';
    this.scanned = 0;
    this.url = undefined;
    this.child = undefined;
    this.exited = false;
    this.stopping = undefined;
  }

  start() {
    const { command, args = [], cwd, env = {} } = this.spec;
    // La entrada queda abierta: Vite y otros servidores se cierran cuando stdin termina.
    const options = { cwd, env: { ...process.env, FORCE_COLOR: '1', ...env }, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] };
    // Solo los scripts .cmd (npm, yarn, pnpm) pasan por cmd.exe, con una línea armada con argumentos validados.
    if (needsShell(command, this.platform)) this.child = spawn(commandLine(command, args, 'win32'), { ...options, shell: true });
    else this.child = spawn(command, args, { ...options, detached: this.platform !== 'win32' });
    const onData = chunk => this.output(chunk.toString('utf8'));
    this.child.stdin?.on('error', () => {});
    this.child.stdout.on('data', onData);
    this.child.stderr.on('data', onData);
    this.closed = new Promise(resolve => { this.child.once('close', resolve); this.child.once('error', resolve); });
    this.child.once('error', error => {
      this.exited = true;
      this.handlers.onError?.(error);
      this.handlers.onExit?.(error.code === 'ENOENT' ? 127 : 1);
    });
    this.child.once('close', (code, signal) => {
      if (this.exited) return;
      this.exited = true;
      this.handlers.onExit?.(code ?? (signal ? 1 : 0));
    });
  }

  write(data) {
    if (this.child?.stdin?.writable && !this.exited) this.child.stdin.write(data);
  }

  output(text) {
    this.handlers.onOutput?.(text);
    // La URL aparece al arrancar; un servidor muy hablador no debe costar CPU durante toda la sesión.
    if (this.url || this.spec.detectUrl === false || this.scanned > SCAN_LIMIT) return;
    this.scanned += text.length;
    this.buffer = (this.buffer + stripAnsi(text)).slice(-4096);
    const url = findLocalUrl(this.buffer);
    if (url) { this.url = url; this.buffer = ''; this.handlers.onUrl?.(url); }
  }

  // Detiene el proceso y, si hace falta, ejecuta el comando de limpieza (por ejemplo docker compose down).
  stop(timeout = 60000) {
    this.stopping ||= (async () => {
      await killTree(this.child, this.platform);
      if (this.closed) await Promise.race([this.closed, new Promise(resolve => setTimeout(resolve, 2000).unref?.())]);
      const stop = this.spec.stop;
      if (!stop) return;
      await new Promise(resolve => {
        const options = { cwd: this.spec.cwd, env: { ...process.env, ...(this.spec.env || {}) }, windowsHide: true, timeout };
        const finish = (error, stdout, stderr) => {
          if (stdout || stderr) this.handlers.onOutput?.(`${stdout || ''}${stderr || ''}`);
          if (error) this.handlers.onError?.(error);
          resolve();
        };
        if (needsShell(stop.command, this.platform)) execFile(commandLine(stop.command, stop.args, 'win32'), [], { ...options, shell: true }, finish);
        else execFile(stop.command, stop.args, options, finish);
      });
    })();
    return this.stopping;
  }
}

module.exports = { AppProcess, findLocalUrl, stripAnsi, quoteArgument, commandLine, killTree, needsShell };
