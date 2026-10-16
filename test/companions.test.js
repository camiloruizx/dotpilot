'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { portsOf, localUrls, matchCandidate, isWebProject, companionName, cleanList, waitForReady } = require('../src/companions');
const { profilesFrom, runArgs, localEndpoint, browserUrl } = require('../src/core');
const createCompanions = require('../src/controller/companions');

test('localUrls finds localhost dependencies and skips the project own Kestrel and urls settings', () => {
  const text = `{
    // comentario
    "Logging": { "LogLevel": { "Default": "Information" } },
    "ApiBaseUrl": "https://localhost:7001/api/",
    "Services": { "Auth": "http://127.0.0.1:5200", "Public": "https://example.com/api" },
    "Kestrel": { "Endpoints": { "Https": { "Url": "https://localhost:5001" } } },
    "urls": "http://localhost:6000",
  }`;
  assert.deepEqual(localUrls(text).map(item => item.port).sort(), [5200, 7001]);
  assert.deepEqual(localUrls('not json'), []);
  assert.deepEqual(localUrls('{"a":"https://localhost/x"}').map(item => item.port), [443]);
});

test('portsOf reads every local port of an applicationUrl list', () => {
  assert.deepEqual([...portsOf(['https://localhost:7001;http://localhost:5001', 'https://example.com:9000', '', undefined])].sort(), [5001, 7001]);
  assert.deepEqual([...portsOf(['http://*:5005', 'http://+:5006'])].sort(), [5005, 5006]);
});

test('a candidate is suggested when it listens on the port the project calls', () => {
  const candidates = [
    { id: 'A', profiles: [{ name: 'http', url: 'http://localhost:5000' }] },
    { id: 'B', profiles: [{ name: 'http', url: 'http://localhost:5100' }, { name: 'https', url: 'https://localhost:7001;http://localhost:5101' }] }
  ];
  const urls = [{ url: 'https://localhost:7001/api/', port: 7001 }];
  assert.deepEqual(matchCandidate(urls, candidates), { id: 'B', profile: 'https', url: 'https://localhost:7001/api/' });
  assert.equal(matchCandidate([{ url: 'http://localhost:9', port: 9 }], candidates), undefined);
});

test('web projects, names and stored lists are validated', () => {
  assert.ok(isWebProject('<Project Sdk="Microsoft.NET.Sdk.Web"><PropertyGroup/></Project>'));
  assert.ok(!isWebProject('<Project Sdk="Microsoft.NET.Sdk"></Project>'));
  assert.equal(companionName('C:\\a\\UAG.API.CopaTecos\\UAG.API.CopaTecos.csproj'.replace(/\\/g, path.sep)), 'UAG.API.CopaTecos');
  assert.deepEqual(cleanList([{ project: 'a.csproj', profile: 'https' }, { project: 'a.csproj' }, null, { project: 5 }, { project: 'b.csproj', profile: 7 }]),
    [{ project: 'a.csproj', profile: 'https' }, { project: 'b.csproj', profile: '' }]);
  assert.deepEqual(cleanList([{ project: 'a.csproj', browse: false, path: 'docs' }, { project: 'b.csproj', browse: 'yes', path: 3 }]),
    [{ project: 'a.csproj', profile: '', browse: false, path: 'docs' }, { project: 'b.csproj', profile: '' }]);
  assert.deepEqual(cleanList(undefined), []);
});

test('waitForReady resolves on the first signal and honors cancellation and the timeout', async () => {
  const sleep = async () => {};
  assert.equal(await waitForReady({ urlSeen: () => true, exited: () => false, cancelled: () => false, sleep }), 'ready');
  assert.equal(await waitForReady({ urlSeen: () => false, exited: () => true, cancelled: () => false, sleep }), 'exited');
  assert.equal(await waitForReady({ urlSeen: () => false, exited: () => false, cancelled: () => true, sleep }), 'cancelled');
  let polls = 0;
  assert.equal(await waitForReady({ isOpen: async () => ++polls >= 3, urlSeen: () => false, exited: () => false, cancelled: () => false, sleep }), 'ready');
  assert.equal(polls, 3);
  let clock = 0;
  const outcome = await waitForReady({ urlSeen: () => false, exited: () => false, cancelled: () => false, timeout: 1000, interval: 400, sleep: async ms => { clock += ms; }, now: () => clock });
  assert.equal(outcome, 'timeout');
});

// ---- Controller (métodos mezclados) con dependencias simuladas ----

function setup({ portOpen = false, props = { OutputType: 'Exe', TargetFramework: 'net8.0' } } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dotpilot-companions-'));
  const api = path.join(dir, 'Api');
  fs.mkdirSync(path.join(api, 'Properties'), { recursive: true });
  fs.writeFileSync(path.join(api, 'Api.csproj'), '<Project Sdk="Microsoft.NET.Sdk.Web"></Project>');
  fs.writeFileSync(path.join(api, 'Properties', 'launchSettings.json'), JSON.stringify({ profiles: {
    http: { commandName: 'Project', applicationUrl: 'http://localhost:5100' },
    https: { commandName: 'Project', applicationUrl: 'https://localhost:7100;http://localhost:5101' }
  } }));
  const web = path.join(dir, 'Web');
  fs.mkdirSync(web, { recursive: true });
  fs.writeFileSync(path.join(web, 'Web.csproj'), '<Project Sdk="Microsoft.NET.Sdk.Web"></Project>');
  fs.writeFileSync(path.join(web, 'appsettings.json'), JSON.stringify({ ApiBaseUrl: 'https://localhost:7100/' }));
  const notices = [], executed = [], terminals = [], shown = [], opened = [];
  const vscode = {
    window: {
      showInformationMessage: async (...args) => { shown.push(args); return vscode.answer; },
      showQuickPick: async items => items[0], showOpenDialog: async () => undefined, setStatusBarMessage: () => {}
    },
    workspace: { asRelativePath: uri => uri.fsPath },
    env: { asExternalUri: async uri => uri, openExternal: async uri => { opened.push(['external', uri.toString()]); return true; } },
    Uri: { parse: url => ({ toString: () => url }) },
    QuickPickItemKind: { Separator: -1 }
  };
  const methods = createCompanions({ vscode, path, fs: fs.promises, os, portIsOpen: async () => portOpen, profilesFrom, localEndpoint, runArgs, browserUrl });
  const state = new Map();
  const self = Object.assign({
    context: { workspaceState: { get: (key, fallback) => state.has(key) ? state.get(key) : fallback, update: async (key, value) => { value === undefined ? state.delete(key) : state.set(key, value); } } },
    project: { fsPath: path.join(web, 'Web.csproj'), toString: () => 'file:///web' }, app: undefined,
    projects: [{ fsPath: path.join(web, 'Web.csproj') }, { fsPath: path.join(api, 'Api.csproj') }],
    profiles: [{ name: 'https', url: 'https://localhost:7050' }], configuration: 'Debug', generation: 1, companions: [], apiTasks: new Set(), apiGeneration: 0, apiStarting: false, result: '', resultError: false,
    output: { appendLine: line => notices.push(line) }, render() {}, active: () => false, assertDotnet() {}, ensureProject: async () => true,
    t: (message, ...values) => message.replace(/\{(\d+)\}/g, (_, i) => values[i]),
    config: () => ({ get: (key, fallback) => fallback }), terminalEnv: () => ({}), browser: () => 'edge',
    launchInBrowser: (browser, url) => { opened.push([browser, url]); return true; },
    queryProperties: async (framework, properties, project) => { self.queried = project; return props; },
    appTerminal(spec, generation, companion) { const terminal = { spec, companion }; terminals.push(terminal); return terminal; },
    async executeTask(...args) { executed.push(args); }
  }, methods);
  return { self, vscode, dir, api, web, state, notices, executed, terminals, shown, opened, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

test('detectApi suggests the workspace API whose port the project calls, ignoring its own ports', async t => {
  const h = setup(); t.after(h.cleanup);
  const found = await h.self.detectApi();
  assert.deepEqual(found.urls.map(item => item.port), [7100]);
  assert.equal(found.match.id, path.join(h.api, 'Api.csproj'));
  assert.equal(found.match.profile, 'https');
  // El propio puerto del proyecto no cuenta como dependencia.
  fs.writeFileSync(path.join(h.web, 'appsettings.json'), JSON.stringify({ Self: 'https://localhost:7050' }));
  assert.equal(await h.self.detectApi(), undefined);
});

test('the first run offers the detected API once and remembers the answer', async t => {
  const h = setup(); t.after(h.cleanup);
  h.vscode.answer = 'Agregar';
  await h.self.offerCompanions(1);
  assert.equal(h.shown.length, 1);
  assert.match(h.shown[0][0], /parece usar la API Api \(https:\/\/localhost:7100\/\)/);
  assert.deepEqual(h.self.companionList(), [{ project: path.join(h.api, 'Api.csproj'), profile: 'https' }]);
  await h.self.offerCompanions(1);
  assert.equal(h.shown.length, 1, 'with an API configured it does not ask again');
  await h.self.saveCompanions([]);
  h.vscode.answer = 'No preguntar más';
  await h.self.offerCompanions(1);
  await h.self.offerCompanions(1);
  assert.equal(h.shown.length, 2, '"Don\'t ask again" is respected');
  assert.deepEqual(h.self.companionList(), []);
});

test('an API that is already listening is reused and nothing is started', async t => {
  const h = setup({ portOpen: true }); t.after(h.cleanup);
  await h.self.saveCompanions([{ project: path.join(h.api, 'Api.csproj'), profile: 'https' }]);
  await h.self.startCompanions(() => false);
  assert.equal(h.executed.length, 0);
  assert.match(h.notices[0], /ya está en ejecución en el puerto 7100; se reutiliza/);
});

test('an API is started with its own profile and the project waits until it reports its URL', async t => {
  const h = setup(); t.after(h.cleanup);
  const project = path.join(h.api, 'Api.csproj');
  await h.self.saveCompanions([{ project, profile: 'https' }]);
  h.self.executeTask = async (...args) => { h.executed.push(args); setTimeout(() => { h.terminals[0].companion.url = 'https://localhost:7100'; }, 20); };
  await h.self.startCompanions(() => false);
  assert.equal(h.self.queried, project);
  const spec = h.terminals[0].spec;
  assert.equal(spec.command, 'dotnet');
  assert.deepEqual(spec.args, ['run', '--project', project, '--configuration', 'Debug', '--launch-profile', 'https', '--framework', 'net8.0']);
  assert.equal(spec.cwd, path.dirname(project));
  assert.equal(h.executed[0][0], 'API Api');
  assert.equal(h.executed[0][5], 'api', 'runs as a secondary task, not as the main run');
  assert.equal(h.self.companions.length, 1);
});

test('an API that exits before it is ready fails the launch with its exit code', async t => {
  const h = setup(); t.after(h.cleanup);
  await h.self.saveCompanions([{ project: path.join(h.api, 'Api.csproj'), profile: 'http' }]);
  h.self.executeTask = async () => { setTimeout(() => { h.terminals[0].companion.exitCode = 3; }, 10); };
  await assert.rejects(() => h.self.startCompanions(() => false), /La API Api terminó con código 3 antes de estar lista/);
});

test('a missing project or a library is reported clearly', async t => {
  const h = setup({ props: { OutputType: 'Library', TargetFramework: 'net8.0' } }); t.after(h.cleanup);
  await h.self.saveCompanions([{ project: path.join(h.dir, 'Gone', 'Gone.csproj'), profile: '' }]);
  await assert.rejects(() => h.self.startCompanions(() => false), /No se encontró el proyecto de la API/);
  await h.self.saveCompanions([{ project: path.join(h.api, 'Api.csproj'), profile: '' }]);
  await assert.rejects(() => h.self.startCompanions(() => false), /debe ser una aplicación ejecutable/);
});

test('a ready API opens its Swagger in the chosen browser unless disabled, and reused APIs do not reopen it', async t => {
  const h = setup(); t.after(h.cleanup);
  const project = path.join(h.api, 'Api.csproj');
  fs.writeFileSync(project, '<Project Sdk="Microsoft.NET.Sdk.Web"><ItemGroup><PackageReference Include="Swashbuckle.AspNetCore" Version="6.5.0" /></ItemGroup></Project>');
  h.self.executeTask = async () => { setTimeout(() => { h.terminals.at(-1).companion.url = 'https://localhost:7100'; }, 10); };
  await h.self.saveCompanions([{ project, profile: 'https' }]);
  await h.self.startCompanions(() => false);
  assert.deepEqual(h.opened, [['edge', 'https://localhost:7100/swagger']]);
  // El usuario puede desactivarlo para esa API.
  h.opened.length = 0;
  await h.self.saveCompanions([{ project, profile: 'https', browse: false }]);
  await h.self.startCompanions(() => false);
  assert.deepEqual(h.opened, []);
  // Sin Swagger ni launchBrowser en el perfil, no se abre nada por omisión; con `browse: true` abre la raíz.
  fs.writeFileSync(project, '<Project Sdk="Microsoft.NET.Sdk.Web"></Project>');
  await h.self.saveCompanions([{ project, profile: 'https' }]);
  await h.self.startCompanions(() => false);
  assert.deepEqual(h.opened, []);
  await h.self.saveCompanions([{ project, profile: 'https', browse: true }]);
  await h.self.startCompanions(() => false);
  assert.deepEqual(h.opened, [['edge', 'https://localhost:7100/']]);
});

test('an API that was already running is reused without opening a second browser tab', async t => {
  const h = setup({ portOpen: true }); t.after(h.cleanup);
  const project = path.join(h.api, 'Api.csproj');
  fs.writeFileSync(project, '<Project Sdk="Microsoft.NET.Sdk.Web"><ItemGroup><PackageReference Include="Swashbuckle.AspNetCore" Version="6.5.0" /></ItemGroup></Project>');
  await h.self.saveCompanions([{ project, profile: 'https' }]);
  await h.self.startCompanions(() => false);
  assert.deepEqual(h.opened, []);
});

test('an API cannot be added twice or be the project itself, and stopCompanions stops every process', async t => {
  const h = setup(); t.after(h.cleanup);
  await assert.rejects(() => h.self.addCompanionProject(h.self.project.fsPath), /propia API/);
  assert.ok(await h.self.addCompanionProject(path.join(h.api, 'Api.csproj'), 'http'));
  await assert.rejects(() => h.self.addCompanionProject(path.join(h.api, 'Api.csproj')), /ya está agregada/);
  const stopped = [];
  h.self.companions = [{ proc: { stop: async () => stopped.push('a') } }, { proc: undefined }, { proc: { stop: async () => { throw new Error('boom'); } } }];
  await h.self.stopCompanions();
  assert.deepEqual(stopped, ['a']);
  assert.deepEqual(h.self.companions, []);
});

test('the run mode is per project, defaults to together and can be switched to separate', async t => {
  const h = setup(); t.after(h.cleanup);
  assert.equal(h.self.companionMode(), 'together');
  await assert.rejects(() => h.self.selectCompanionMode(), /No hay APIs complementarias/);
  await h.self.saveCompanions([{ project: path.join(h.api, 'Api.csproj'), profile: 'http' }]);
  h.vscode.window.showQuickPick = async items => items.find(item => item.value === 'separate');
  await h.self.selectCompanionMode();
  assert.equal(h.self.companionMode(), 'separate');
  h.vscode.window.showQuickPick = async items => items.find(item => item.value === 'together');
  await h.self.selectCompanionMode();
  assert.equal(h.self.companionMode(), 'together');
  assert.equal(h.state.has('companionMode:file:///web'), false, 'together is the default and is not stored');
});

test('Run API starts only the APIs, tracks them as running and Stop API ends them without touching the project', async t => {
  const h = setup(); t.after(h.cleanup);
  const project = path.join(h.api, 'Api.csproj');
  await h.self.saveCompanions([{ project, profile: 'http' }]);
  await assert.rejects(() => h.self.runApi(), /junto con el proyecto/);
  h.state.set('companionMode:file:///web', 'separate');
  const stops = [];
  h.self.executeTask = async (...args) => {
    h.executed.push(args);
    const companion = h.terminals.at(-1).companion;
    companion.proc = { exited: false, stop: async () => { stops.push('api'); companion.proc.exited = true; } };
    setTimeout(() => { companion.url = 'http://localhost:5100'; }, 10);
  };
  assert.equal(h.self.apiRunning(), false);
  await h.self.runApi();
  assert.equal(h.executed[0][5], 'api', 'the API task is tracked apart from the project tasks');
  assert.equal(h.self.apiRunning(), true);
  assert.equal(h.self.apiStarting, false);
  await assert.rejects(() => h.self.runApi(), /ya está en ejecución/);
  // El Ejecutar/Detener del proyecto no cambia la generación de la API.
  const generation = h.self.apiGeneration;
  h.self.generation++;
  assert.equal(h.self.apiGeneration, generation);
  await h.self.stopApi();
  assert.deepEqual(stops, ['api']);
  assert.equal(h.self.apiRunning(), false);
});

test('a project run that starts while the API is still starting does not cancel the API start', async t => {
  const h = setup(); t.after(h.cleanup);
  const project = path.join(h.api, 'Api.csproj');
  await h.self.saveCompanions([{ project, profile: 'http' }]);
  h.state.set('companionMode:file:///web', 'separate');
  h.self.queryProperties = async (framework, properties, file, independent) => {
    assert.equal(independent, true, 'the API query must not depend on the project generation');
    h.self.generation++;
    return { OutputType: 'Exe', TargetFramework: 'net8.0' };
  };
  h.self.executeTask = async () => { setTimeout(() => { h.terminals.at(-1).companion.url = 'http://localhost:5100'; }, 10); };
  await h.self.runApi();
  assert.equal(h.self.companions.length, 1);
  assert.equal(h.self.result, '');
});

test('Run API opens a window that belongs to the API; running it together with the project keeps an independent tab', async t => {
  const h = setup(); t.after(h.cleanup);
  const project = path.join(h.api, 'Api.csproj');
  fs.writeFileSync(project, '<Project Sdk="Microsoft.NET.Sdk.Web"><ItemGroup><PackageReference Include="Swashbuckle.AspNetCore" Version="6.5.0" /></ItemGroup></Project>');
  await h.self.saveCompanions([{ project, profile: 'http' }]);
  h.self.executeTask = async () => {
    const companion = h.terminals.at(-1).companion;
    companion.proc = { exited: false, stop: async () => {} };
    setTimeout(() => { companion.url = 'http://localhost:5100'; }, 10);
  };
  const linked = [];
  h.self.openApiBrowser = async (url, entry) => { linked.push([url, entry.project]); };
  // Juntas con el proyecto: pestaña independiente, sin ventana vinculada.
  await h.self.startCompanions(() => false);
  assert.deepEqual(linked, []);
  assert.deepEqual(h.opened, [['edge', 'http://localhost:5100/swagger']]);
  // Por separado: la ventana es de la API.
  h.self.companions = []; h.opened.length = 0;
  h.state.set('companionMode:file:///web', 'separate');
  await h.self.runApi();
  assert.deepEqual(linked, [['http://localhost:5100/swagger', project]]);
  assert.deepEqual(h.opened, []);
});
