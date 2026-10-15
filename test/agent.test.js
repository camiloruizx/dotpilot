'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { TOOLS, byName, validateInput } = require('../src/agent-tools');
const { Bridge, UnknownTool, BadInput, findBridge } = require('../src/bridge');
const { mergeJsonConfig, mergeTomlConfig, installedAssistants } = require('../src/assistants');
const { AgentApi } = require('../src/agent');
const pkg = require('../package.json');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'dotpilot-agent-'));
const rm = dir => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });

test('tool names are unique, model friendly, and mutating tools are marked', () => {
  assert.equal(new Set(TOOLS.map(t => t.name)).size, TOOLS.length);
  for (const tool of TOOLS) {
    assert.match(tool.name, /^dotpilot_[a-z_]+$/);
    assert.ok(tool.description.length > 40 && tool.title && tool.userDescription);
    assert.equal(tool.inputSchema.type, 'object');
  }
  for (const name of ['dotpilot_run', 'dotpilot_debug', 'dotpilot_hot_reload', 'dotpilot_restart', 'dotpilot_build', 'dotpilot_open_browser']) assert.equal(byName.get(name).mutating, true, name);
  for (const name of ['dotpilot_list_projects', 'dotpilot_get_status', 'dotpilot_get_output', 'dotpilot_get_problems', 'dotpilot_stop', 'dotpilot_select_project']) assert.equal(byName.get(name).mutating, false, name);
});

test('input is validated against the schema and defaults stay empty', () => {
  const run = byName.get('dotpilot_run'), build = byName.get('dotpilot_build'), select = byName.get('dotpilot_select_project');
  assert.deepEqual(validateInput(run, undefined), {});
  assert.deepEqual(validateInput(run, { wait_seconds: 5 }), { wait_seconds: 5 });
  assert.throws(() => validateInput(run, { wait_seconds: 500 }), /integer/);
  assert.throws(() => validateInput(run, { wait_seconds: '5' }), /integer/);
  assert.throws(() => validateInput(run, { command: 'calc' }), /Unknown parameter/);
  assert.throws(() => validateInput(build, { action: 'format' }), /one of/);
  assert.throws(() => validateInput(select, {}), /required/);
  assert.throws(() => validateInput(select, { project: '   ' }), /required/);
  assert.throws(() => validateInput(run, []), /object/);
});

test('package.json contributes every tool exactly as the shared definition says', () => {
  const contributed = pkg.contributes.languageModelTools;
  assert.deepEqual(contributed.map(t => t.name), TOOLS.map(t => t.name));
  for (const tool of TOOLS) {
    const item = contributed.find(t => t.name === tool.name);
    assert.equal(item.modelDescription, tool.description, tool.name);
    assert.deepEqual(item.inputSchema, tool.inputSchema, tool.name);
    assert.match(item.toolReferenceName, /^dotpilot[A-Z]/);
  }
  assert.ok(pkg.contributes.commands.some(c => c.command === 'dotpilot.connectAssistants'));
  const props = pkg.contributes.configuration.properties;
  // Solo el usuario decide: un repositorio no puede activar el puente ni saltarse el permiso.
  assert.equal(props['dotpilot.assistantsEnabled'].scope, 'machine');
  assert.equal(props['dotpilot.assistantsPermission'].scope, 'machine');
  assert.equal(props['dotpilot.assistantsEnabled'].default, false);
  assert.equal(props['dotpilot.assistantsPermission'].default, 'ask');
  assert.match(fs.readFileSync(path.join(__dirname, '../src/mcp-server.js'), 'utf8'), new RegExp(`'${pkg.version.replace(/\./g, '\\.')}'`));
});

// ---- Puente ----

function request(port, { method = 'POST', url = '/call', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: url, method, headers }, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body: data ? JSON.parse(data) : undefined }));
    });
    req.on('error', reject);
    req.end(body);
  });
}

test('the bridge requires the token and refuses browser origins and foreign hosts', async () => {
  const home = tmp();
  const calls = [];
  const bridge = new Bridge({ home, folders: [home], handler: async (name, input, origin) => { calls.push([name, input, origin]); if (name === 'nope') throw new UnknownTool('Unknown tool: nope'); if (name === 'bad') throw new BadInput('bad input'); return { ok: true, echoed: input }; } });
  const port = await bridge.start();
  const auth = { authorization: `Bearer ${bridge.token}`, 'content-type': 'application/json', 'x-dotpilot-client': 'Test Agent' };
  try {
    assert.equal((await request(port, { body: '{"name":"x"}' })).status, 401);
    assert.equal((await request(port, { headers: { ...auth, authorization: 'Bearer wrong' }, body: '{"name":"x"}' })).status, 401);
    assert.equal((await request(port, { headers: { ...auth, origin: 'https://evil.example' }, body: '{"name":"x"}' })).status, 403);
    assert.equal((await request(port, { headers: { ...auth, host: 'evil.example' }, body: '{"name":"x"}' })).status, 403);
    assert.equal((await request(port, { headers: auth, body: '{not json' })).status, 400);
    assert.equal((await request(port, { headers: auth, body: '{"name":"nope"}' })).status, 404);
    assert.equal((await request(port, { headers: auth, body: '{"name":"bad"}' })).status, 400);
    assert.equal((await request(port, { headers: auth, url: '/other', body: '{}' })).status, 404);
    const ok = await request(port, { headers: auth, body: JSON.stringify({ name: 'dotpilot_x', input: { a: 1 } }) });
    assert.deepEqual(ok, { status: 200, body: { ok: true, echoed: { a: 1 } } });
    assert.deepEqual(calls.at(-1), ['dotpilot_x', { a: 1 }, { client: 'Test Agent', confirmed: false }]);
    // El archivo de descubrimiento existe mientras el puente está vivo y desaparece al cerrarlo.
    const file = path.join(home, 'bridges', `${process.pid}-${port}.json`);
    assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).token, bridge.token);
  } finally { await bridge.dispose(); }
  assert.deepEqual(fs.readdirSync(path.join(home, 'bridges')), []);
  rm(home);
});

test('discovery chooses the window that contains the working directory and prunes dead ones', () => {
  const home = tmp();
  const dir = path.join(home, 'bridges');
  fs.mkdirSync(dir, { recursive: true });
  const write = (name, data) => fs.writeFileSync(path.join(dir, name), JSON.stringify({ token: 't', ...data }));
  write('a.json', { pid: 1, port: 1001, folders: [path.resolve('/work/a')] });
  write('b.json', { pid: 2, port: 1002, folders: [path.resolve('/work/b')] });
  write('c.json', { pid: 3, port: 1003, folders: [path.resolve('/work')] });
  write('dead.json', { pid: 99, port: 1099, folders: [path.resolve('/work/b')] });
  const alive = pid => pid !== 99;
  assert.equal(findBridge(path.resolve('/work/b/src'), home, alive).bridge.port, 1002);
  assert.equal(findBridge(path.resolve('/work/zzz'), home, alive).bridge.port, 1003);
  assert.ok(!fs.existsSync(path.join(dir, 'dead.json')));
  fs.rmSync(path.join(dir, 'c.json'));
  assert.equal(findBridge(path.resolve('/elsewhere'), home, alive).error, 'ambiguous');
  fs.rmSync(path.join(dir, 'a.json'));
  assert.equal(findBridge(path.resolve('/elsewhere'), home, alive).bridge.port, 1002);
  assert.equal(findBridge('/x', path.join(home, 'missing'), alive).error, 'none');
  rm(home);
});

// ---- Servidor MCP real, por stdio ----

function mcpClient(home, cwd) {
  const child = spawn(process.execPath, [path.join(__dirname, '../src/mcp-server.js')], { cwd, env: { ...process.env, DOTPILOT_HOME: home }, stdio: ['pipe', 'pipe', 'inherit'] });
  const waiting = new Map();
  let buffer = '', next = 1;
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', chunk => {
    buffer += chunk;
    let index;
    while ((index = buffer.indexOf('\n')) >= 0) {
      const message = JSON.parse(buffer.slice(0, index));
      buffer = buffer.slice(index + 1);
      waiting.get(message.id)?.(message);
    }
  });
  return {
    request(method, params) {
      const id = next++;
      return new Promise(resolve => { waiting.set(id, resolve); child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'); });
    },
    notify(method, params) { child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n'); },
    close() { child.stdin.end(); return new Promise(resolve => child.once('exit', resolve)); }
  };
}

test('the MCP server speaks the protocol, lists every tool and forwards calls to the bridge', async () => {
  const home = tmp();
  const seen = [];
  const bridge = new Bridge({ home, folders: [home], handler: async (name, input, origin) => { seen.push([name, input, origin.client]); return { ok: true, state: 'idle' }; } });
  await bridge.start();
  const client = mcpClient(home, home);
  try {
    const init = await client.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'claude-code', version: '2' } });
    assert.equal(init.result.protocolVersion, '2025-06-18');
    assert.equal(init.result.serverInfo.name, 'dotpilot');
    assert.ok(init.result.capabilities.tools);
    client.notify('notifications/initialized');
    const list = await client.request('tools/list');
    assert.deepEqual(list.result.tools.map(t => t.name), TOOLS.map(t => t.name));
    const run = list.result.tools.find(t => t.name === 'dotpilot_run');
    assert.equal(run.annotations.readOnlyHint, false);
    assert.equal(list.result.tools.find(t => t.name === 'dotpilot_get_status').annotations.readOnlyHint, true);
    const call = await client.request('tools/call', { name: 'dotpilot_get_status', arguments: {} });
    assert.equal(call.result.isError, undefined);
    assert.deepEqual(JSON.parse(call.result.content[0].text), { ok: true, state: 'idle' });
    assert.deepEqual(seen, [['dotpilot_get_status', {}, 'claude-code']]);
    const unknown = await client.request('tools/call', { name: 'rm_rf', arguments: {} });
    assert.equal(unknown.result.isError, true);
    assert.equal((await client.request('no/such/method')).error.code, -32601);
    assert.deepEqual((await client.request('ping')).result, {});
  } finally { await client.close(); await bridge.dispose(); rm(home); }
});

test('without a running DotPilot the server explains what to do instead of failing', async () => {
  const home = tmp();
  const client = mcpClient(home, home);
  try {
    await client.request('initialize', { protocolVersion: '2024-11-05', clientInfo: { name: 'x' } });
    const call = await client.request('tools/call', { name: 'dotpilot_run', arguments: {} });
    assert.equal(call.result.isError, true);
    assert.match(call.result.content[0].text, /not running/);
    // La lista de herramientas no depende del puente: el asistente la conoce aunque VS Code aún no abra.
    assert.equal((await client.request('tools/list')).result.tools.length, TOOLS.length);
  } finally { await client.close(); rm(home); }
});

// ---- Configuración de asistentes ----

test('JSON configuration keeps other servers, tolerates comments and refuses invalid files', () => {
  const script = 'C:\\Users\\a b\\.dotpilot\\mcp\\mcp-server.js';
  const merged = JSON.parse(mergeJsonConfig('{ // mine\n "mcpServers": { "other": { "command": "x" } }, "theme": 1, }', script));
  assert.deepEqual(merged.mcpServers.other, { command: 'x' });
  assert.deepEqual(merged.mcpServers.dotpilot, { command: 'node', args: [script] });
  assert.equal(merged.theme, 1);
  assert.deepEqual(JSON.parse(mergeJsonConfig('', script)).mcpServers.dotpilot.args, [script]);
  assert.throws(() => mergeJsonConfig('[1]', script));
  assert.throws(() => mergeJsonConfig('{ broken', script));
  assert.throws(() => mergeJsonConfig('{"mcpServers": 5}', script));
});

test('TOML configuration is appended once and escapes Windows paths', () => {
  const script = 'C:\\Users\\a b\\.dotpilot\\mcp\\mcp-server.js';
  const first = mergeTomlConfig('model = "x"\n', script);
  assert.match(first, /^model = "x"\n\n\[mcp_servers\.dotpilot\]\ncommand = "node"\nargs = \["C:\\\\Users\\\\a b\\\\\.dotpilot\\\\mcp\\\\mcp-server\.js"\]\n$/);
  assert.equal(mergeTomlConfig(first, script), undefined);
  assert.match(mergeTomlConfig('', script), /^\[mcp_servers\.dotpilot\]/);
});

test('installed assistants are recognised by their extension ids', () => {
  const have = new Set(['anthropic.claude-code', 'openai.chatgpt']);
  const found = Object.fromEntries(installedAssistants(id => have.has(id)).map(a => [a.id, a.installed]));
  assert.deepEqual(found, { claude: true, codex: true, gemini: false, copilot: false });
});

// ---- Permisos y acciones ----

function harness({ permission = 'ask', answer } = {}) {
  const prompts = [];
  const calls = [];
  const uri = path => ({ fsPath: path, toString: () => 'file:///' + path });
  const controller = {
    projects: [uri('/w/Api/Api.csproj')], apps: [{ uri: uri('/w/web/package.json'), dir: '/w/web', framework: 'React + Vite', profiles: [{ name: 'dev', command: 'npm', args: ['run', 'dev'], url: 'http://localhost:5173' }] }],
    project: undefined, app: undefined, profiles: [], profile: '', busy: false, session: undefined, paused: false, runTask: undefined, lastMode: 'run',
    listeningUrl: undefined, result: '', resultError: false, recentOutput: ['a', 'b', 'c'], recentPartial: 'd', occupiedAtLaunch: false,
    config: () => ({ get: (key, fallback) => (key === 'assistantsPermission' ? permission : fallback) }),
    t: (message, ...values) => message.replace(/\{(\d+)\}/g, (_, i) => values[i]),
    active() { return !!(this.runTask || this.session); }, browser: () => 'edge', projectName() { return this.app ? 'web' : 'Api.csproj'; },
    async refresh() {}, async loadProfiles() {}, companionList: () => [],
    async applyProject(u, app) { this.project = u; this.app = app; this.profiles = app ? app.profiles : [{ name: 'http', url: 'http://localhost:5000' }]; this.profile = this.profiles[0].name; },
    async applyProfile(name) { this.profile = name; },
    async invoke(action) { calls.push(action); if (action === 'run') this.runTask = {}; if (action === 'stop') this.runTask = undefined; }
  };
  const vscode = {
    workspace: { isTrusted: true, asRelativePath: u => u.fsPath.replace(/^\/w\//, ''), getWorkspaceFolder: () => ({}) },
    window: { showWarningMessage: async (...args) => { prompts.push(args); return typeof answer === 'function' ? answer(args) : answer; } },
    languages: { getDiagnostics: () => [] }, DiagnosticSeverity: { Error: 0, Warning: 1 }
  };
  const api = new AgentApi(controller, vscode, { portIsOpen: async () => false, localEndpoint: () => undefined, browserUrl: p => p?.url });
  return { api, controller, prompts, calls };
}

test('actions that start work need the user to allow them; read-only tools never ask', async () => {
  const denied = harness({ answer: 'Rechazar' });
  assert.equal((await denied.api.call('dotpilot_list_projects', {}, { client: 'Claude Code' })).ok, true);
  assert.equal(denied.prompts.length, 0);
  await denied.api.call('dotpilot_select_project', { project: 'web' }, { client: 'Claude Code' });
  assert.equal(denied.prompts.length, 0);
  const refused = await denied.api.call('dotpilot_run', { wait_seconds: 0 }, { client: 'Claude Code' });
  assert.equal(refused.ok, false); assert.equal(refused.denied, true);
  assert.deepEqual(denied.calls, []);
  assert.match(denied.prompts[0][0], /Claude Code quiere usar DotPilot: Ejecutar proyecto\./);

  const session = harness({ answer: 'Permitir en esta sesión' });
  await session.api.call('dotpilot_select_project', { project: 'web' }, { client: 'Codex' });
  assert.equal((await session.api.call('dotpilot_run', { wait_seconds: 0 }, { client: 'Codex' })).ok, true);
  await session.api.call('dotpilot_stop', {}, { client: 'Codex' });
  await session.api.call('dotpilot_run', { wait_seconds: 0 }, { client: 'Codex' });
  assert.equal(session.prompts.length, 1);
  await session.api.call('dotpilot_stop', {}, { client: 'Codex' });
  await session.api.call('dotpilot_run', { wait_seconds: 0 }, { client: 'Gemini' });
  assert.equal(session.prompts.length, 2, 'another assistant is asked separately');

  const allowed = harness({ permission: 'allow' });
  await allowed.api.call('dotpilot_select_project', { project: 'web' }, { client: 'x' });
  assert.equal((await allowed.api.call('dotpilot_run', { wait_seconds: 0 }, { client: 'x' })).ok, true);
  assert.equal(allowed.prompts.length, 0);

  const chat = harness({ answer: 'Rechazar' });
  await chat.api.call('dotpilot_select_project', { project: 'web' }, { client: 'GitHub Copilot' });
  assert.equal((await chat.api.call('dotpilot_run', { wait_seconds: 0 }, { client: 'GitHub Copilot', confirmed: true })).ok, true);
  assert.equal(chat.prompts.length, 0);
});

test('untrusted workspaces and invalid input are rejected before anything runs', async () => {
  const h = harness({ permission: 'allow' });
  h.api.vscode.workspace.isTrusted = false;
  assert.match((await h.api.call('dotpilot_run', {}, { client: 'x' })).error, /not trusted/);
  h.api.vscode.workspace.isTrusted = true;
  await assert.rejects(() => h.api.call('dotpilot_run', { shell: 'calc' }, { client: 'x' }), BadInput);
  await assert.rejects(() => h.api.call('dotpilot_format_disk', {}, { client: 'x' }), UnknownTool);
  assert.deepEqual(h.calls, []);
});

test('projects are found by id, name or path and ambiguity is explained', async () => {
  const h = harness({ permission: 'allow' });
  const list = await h.api.call('dotpilot_list_projects', {}, { client: 'x' });
  assert.deepEqual(list.projects.map(p => [p.id, p.type, p.selected]), [['Api/Api.csproj', '.NET', false], ['web/package.json', 'React + Vite', false]]);
  assert.equal(list.note.includes('No project is selected'), true);
  assert.equal((await h.api.call('dotpilot_select_project', { project: 'Api.csproj' }, { client: 'x' })).project, 'Api.csproj');
  assert.equal((await h.api.call('dotpilot_select_project', { project: 'web/package.json' }, { client: 'x' })).projectType, 'React + Vite');
  const missing = await h.api.call('dotpilot_select_project', { project: 'nope' }, { client: 'x' });
  assert.equal(missing.ok, false);
  assert.match(missing.error, /Valid ids: Api\/Api\.csproj, web\/package\.json/);
  const profile = await h.api.call('dotpilot_select_profile', { profile: 'DEV' }, { client: 'x' });
  assert.equal(profile.profile, 'dev');
  assert.match((await h.api.call('dotpilot_select_profile', { profile: 'prod' }, { client: 'x' })).error, /Valid profiles: dev/);
});

test('.NET-only tools fail clearly on other project types and running apps block selection', async () => {
  const h = harness({ permission: 'allow' });
  await h.api.call('dotpilot_select_project', { project: 'web' }, { client: 'x' });
  assert.match((await h.api.call('dotpilot_debug', {}, { client: 'x' })).error, /only available for \.NET/);
  assert.match((await h.api.call('dotpilot_build', {}, { client: 'x' })).error, /only available for \.NET/);
  await h.api.call('dotpilot_run', { wait_seconds: 0 }, { client: 'x' });
  assert.match((await h.api.call('dotpilot_select_project', { project: 'Api' }, { client: 'x' })).error, /Stop the running app/);
  assert.match((await h.api.call('dotpilot_run', {}, { client: 'x' })).error, /already running/);
  const status = await h.api.call('dotpilot_get_status', {}, { client: 'x' });
  assert.equal(status.state, 'running');
  assert.deepEqual(h.api.output(2).lines, ['c', 'd']);
});

test('closing the bridge while it is still starting leaves no port or discovery file behind', async () => {
  const home = tmp();
  const bridge = new Bridge({ home, folders: [home], handler: async () => ({ ok: true }) });
  const starting = bridge.start();
  const closing = bridge.dispose();
  await Promise.all([starting, closing]);
  assert.equal(bridge.server, undefined);
  const dir = path.join(home, 'bridges');
  assert.deepEqual(fs.existsSync(dir) ? fs.readdirSync(dir) : [], []);
  rm(home);
});

test('direct browser launch picks the installed executable and refuses unsafe URLs',()=>{
  const { open, find, candidates } = require('../src/browsers');
  const calls=[];
  const launch=(file,args)=>{calls.push([file,args]);return {on(){},unref(){}};};
  const exists=file=>file.endsWith('chrome.exe');
  const env={PROGRAMFILES:'C:\Program Files','PROGRAMFILES(X86)':'C:\Program Files (x86)',LOCALAPPDATA:'C:\Users\a\AppData\Local'};
  assert.equal(open('chrome','http://localhost:5173/',{exists,platform:'win32',env,launch}),true);
  assert.deepEqual(calls[0][1],['http://localhost:5173/']);
  assert.match(calls[0][0],/chrome.exe$/);
  assert.equal(open('edge','http://localhost:5173/',{exists,platform:'win32',env,launch}),false,'not installed');
  for(const url of ['javascript:alert(1)','file:///c:/x','http://user:pw@localhost/','not a url'])assert.equal(open('chrome',url,{exists,platform:'win32',env,launch}),false,url);
  assert.equal(open('firefox','http://localhost/',{exists:()=>true,launch}),false);
  assert.equal(calls.length,1);
  assert.ok(candidates('edge','darwin')[0].includes('Microsoft Edge'));
  assert.equal(find('chrome',{exists:()=>false,platform:'linux'}),undefined);
});

test('the product name is DotPilot everywhere: no trace of the previous identifier is shipped', () => {
  assert.equal(pkg.name, 'dotpilot');
  const shipped = ['package.json', 'package.nls.json', 'package.nls.es.json', ...fs.readdirSync(path.join(__dirname, '../src')).filter(f => f.endsWith('.js')).map(f => 'src/' + f), 'src/locales/en.json'];
  for (const file of shipped) {
    assert.doesNotMatch(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), /dotnetControls|dotnet-controls/, file);
  }
  const ids = [...pkg.contributes.commands.map(c => c.command), ...pkg.contributes.views.dotpilot.map(v => v.id), ...pkg.contributes.submenus.map(s => s.id)];
  for (const id of ids) assert.ok(id.startsWith('dotpilot.'), id);
  // Los identificadores de contenedores de vistas solo admiten letras, números, guiones y guion bajo (sin puntos).
  assert.deepEqual(pkg.contributes.viewsContainers.activitybar.map(c => c.id), ['dotpilot']);
  for (const key of Object.keys(pkg.contributes.configuration.properties)) assert.ok(key.startsWith('dotpilot.'), key);
  assert.equal(pkg.contributes.taskDefinitions[0].type, 'dotpilot');
});

