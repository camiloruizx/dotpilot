'use strict';
// Puente local entre DotPilot (dentro de VS Code) y los asistentes de IA.
// Escucha solo en 127.0.0.1, exige un token aleatorio y publica su puerto en un archivo
// de descubrimiento que lee el servidor MCP. No depende de VS Code.
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomBytes, timingSafeEqual } = require('node:crypto');

const MAX_BODY = 64 * 1024;

function homeDirectory() {
  return process.env.DOTPILOT_HOME || path.join(os.homedir(), '.dotpilot');
}
function bridgeDirectory(home = homeDirectory()) {
  return path.join(home, 'bridges');
}

class UnknownTool extends Error {}
class BadInput extends Error {}

class Bridge {
  // handler(name, input, origin) → objeto serializable; lanza UnknownTool o BadInput.
  constructor({ handler, folders = [], version = '', home = homeDirectory() }) {
    this.handler = handler;
    this.folders = folders;
    this.version = version;
    this.home = home;
    this.token = randomBytes(32).toString('hex');
    this.server = undefined;
    this.port = 0;
    this.file = undefined;
    this.disposed = false;
  }

  authorized(header) {
    const expected = Buffer.from(`Bearer ${this.token}`);
    const received = Buffer.from(String(header || ''));
    return received.length === expected.length && timingSafeEqual(received, expected);
  }

  respond(response, status, body) {
    const text = JSON.stringify(body);
    response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(text), 'cache-control': 'no-store' });
    response.end(text);
  }

  async handle(request, response) {
    // Un navegador no debe poder llegar hasta aquí (CSRF / DNS rebinding): sin Origin y con Host local.
    const host = String(request.headers.host || '');
    if (request.headers.origin || !(host === `127.0.0.1:${this.port}` || host === `localhost:${this.port}`)) {
      return this.respond(response, 403, { ok: false, error: 'Forbidden.' });
    }
    if (!this.authorized(request.headers.authorization)) return this.respond(response, 401, { ok: false, error: 'Invalid token.' });
    const url = new URL(request.url, 'http://127.0.0.1');
    if (request.method === 'GET' && url.pathname === '/ping') return this.respond(response, 200, { ok: true, version: this.version });
    if (request.method !== 'POST' || url.pathname !== '/call') return this.respond(response, 404, { ok: false, error: 'Not found.' });
    let body = '';
    for await (const chunk of request) {
      body += chunk;
      if (body.length > MAX_BODY) return this.respond(response, 413, { ok: false, error: 'Request too large.' });
    }
    let message;
    try { message = JSON.parse(body); } catch { return this.respond(response, 400, { ok: false, error: 'Invalid JSON.' }); }
    if (!message || typeof message.name !== 'string') return this.respond(response, 400, { ok: false, error: 'Missing tool name.' });
    const client = String(request.headers['x-dotpilot-client'] || 'AI assistant').slice(0, 80);
    try {
      return this.respond(response, 200, await this.handler(message.name, message.input, { client, confirmed: false }));
    } catch (error) {
      if (error instanceof UnknownTool) return this.respond(response, 404, { ok: false, error: error.message });
      if (error instanceof BadInput) return this.respond(response, 400, { ok: false, error: error.message });
      return this.respond(response, 500, { ok: false, error: error.message || 'Unexpected error.' });
    }
  }

  start() {
    this.starting = this.listen();
    return this.starting;
  }

  async listen() {
    this.server = http.createServer((request, response) => {
      this.handle(request, response).catch(error => { try { this.respond(response, 500, { ok: false, error: error.message }); } catch { /* conexión cerrada */ } });
    });
    this.server.requestTimeout = 5 * 60 * 1000;
    await new Promise((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(0, '127.0.0.1', resolve);
    });
    this.port = this.server.address().port;
    // Si se cerró mientras arrancaba, no deja el puerto abierto ni el archivo de descubrimiento.
    if (this.disposed) return 0;
    const directory = bridgeDirectory(this.home);
    fs.mkdirSync(directory, { recursive: true });
    this.file = path.join(directory, `${process.pid}-${this.port}.json`);
    fs.writeFileSync(this.file, JSON.stringify({ pid: process.pid, port: this.port, token: this.token, folders: this.folders, version: this.version }), { mode: 0o600 });
    return this.port;
  }

  async dispose() {
    this.disposed = true;
    if (this.starting) await this.starting.catch(() => {});
    if (this.file) fs.rmSync(this.file, { force: true });
    this.file = undefined;
    const server = this.server;
    this.server = undefined;
    if (server) await new Promise(resolve => { server.close(() => resolve()); server.closeAllConnections?.(); });
  }
}

// Busca el puente del VS Code que tiene abierta la carpeta `cwd` (o el único disponible).
function findBridge(cwd, home = homeDirectory(), alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } }) {
  const directory = bridgeDirectory(home);
  let names = [];
  try { names = fs.readdirSync(directory); } catch { return { error: 'none' }; }
  const bridges = [];
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    const file = path.join(directory, name);
    try {
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (!alive(data.pid)) { fs.rmSync(file, { force: true }); continue; }
      if (Number.isInteger(data.port) && typeof data.token === 'string') bridges.push(data);
    } catch { /* archivo a medio escribir */ }
  }
  if (!bridges.length) return { error: 'none' };
  const inside = (folder, target) => {
    const relative = path.relative(folder, target);
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
  };
  const matches = bridges
    .map(bridge => ({ bridge, depth: Math.max(-1, ...(bridge.folders || []).filter(folder => inside(folder, cwd)).map(folder => folder.length)) }))
    .filter(item => item.depth >= 0)
    .sort((a, b) => b.depth - a.depth);
  if (matches.length) return { bridge: matches[0].bridge };
  if (bridges.length === 1) return { bridge: bridges[0] };
  return { error: 'ambiguous', folders: bridges.flatMap(bridge => bridge.folders || []) };
}

function callBridge(bridge, name, input, client, timeout = 5 * 60 * 1000) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ name, input });
    const request = http.request({
      host: '127.0.0.1', port: bridge.port, path: '/call', method: 'POST', timeout,
      headers: { authorization: `Bearer ${bridge.token}`, 'content-type': 'application/json', 'content-length': Buffer.byteLength(body), 'x-dotpilot-client': client }
    }, response => {
      let data = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { data += chunk; });
      response.on('end', () => {
        try { resolve({ status: response.statusCode, body: JSON.parse(data) }); } catch { reject(new Error('Invalid response from DotPilot.')); }
      });
    });
    request.on('timeout', () => request.destroy(new Error('DotPilot did not answer in time.')));
    request.on('error', reject);
    request.end(body);
  });
}

module.exports = { Bridge, UnknownTool, BadInput, findBridge, callBridge, homeDirectory, bridgeDirectory };
