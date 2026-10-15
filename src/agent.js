'use strict';
// API para asistentes de IA: traduce las llamadas de las herramientas (agent-tools.js) a acciones del
// Controller, pide permiso al usuario y conecta a los asistentes instalados.
const fs = require('node:fs');
const path = require('node:path');
const { byName, validateInput } = require('./agent-tools');
const { UnknownTool, BadInput, homeDirectory } = require('./bridge');
const { installedAssistants, mergeJsonConfig, mergeTomlConfig } = require('./assistants');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const SERVER_FILES = ['mcp-server.js', 'agent-tools.js', 'bridge.js'];

class AgentApi {
  // deps: { portIsOpen, localEndpoint, browserUrl } — funciones del módulo principal.
  constructor(controller, vscode, deps) {
    this.c = controller;
    this.vscode = vscode;
    this.deps = deps;
    this.session = new Set();
    this.handlers = new Map(Object.entries({
      dotpilot_list_projects: () => this.listProjects(),
      dotpilot_get_status: () => this.status(),
      dotpilot_select_project: args => this.selectProject(args.project),
      dotpilot_select_profile: args => this.selectProfile(args.profile),
      dotpilot_run: args => this.launch('run', args),
      dotpilot_debug: args => this.launch('debug', args),
      dotpilot_hot_reload: args => this.launch('watch', args),
      dotpilot_stop: () => this.stop(),
      dotpilot_restart: args => this.restart(args),
      dotpilot_build: args => this.build(args.action || 'build'),
      dotpilot_open_browser: () => this.openBrowser(),
      dotpilot_get_output: args => this.output(args.lines || 80),
      dotpilot_get_problems: args => this.problems(!!args.include_warnings)
    }));
  }

  // origin: { client, confirmed } — confirmed = el editor ya pidió confirmación al usuario (chat de VS Code).
  async call(name, input, origin = { client: 'AI assistant', confirmed: false }) {
    const tool = byName.get(name);
    if (!tool) throw new UnknownTool(`Unknown tool: ${name}`);
    let args;
    try { args = validateInput(tool, input); } catch (error) { throw new BadInput(error.message); }
    if (!this.vscode.workspace.isTrusted) return { ok: false, error: 'The workspace is not trusted. Trust it in VS Code first.' };
    if (tool.mutating && !origin.confirmed && !(await this.allowed(tool, origin))) {
      return { ok: false, denied: true, error: 'The user did not allow this action in VS Code.' };
    }
    try {
      return await this.handlers.get(name)(args);
    } catch (error) {
      return { ok: false, error: error.message };
    }
  }

  async allowed(tool, origin) {
    const c = this.c;
    if (c.config().get('assistantsPermission', 'ask') === 'allow' || this.session.has(origin.client)) return true;
    const allow = c.t('Permitir'), always = c.t('Permitir en esta sesión'), deny = c.t('Rechazar');
    let timer;
    const timeout = new Promise(resolve => { timer = setTimeout(() => resolve(undefined), 60000); });
    const answer = await Promise.race([
      this.vscode.window.showWarningMessage(c.t('{0} quiere usar DotPilot: {1}.', origin.client, c.t(tool.title)), { modal: false }, allow, always, deny),
      timeout
    ]).finally(() => clearTimeout(timer));
    if (answer === always) this.session.add(origin.client);
    return answer === allow || answer === always;
  }

  rel(uri) { return this.vscode.workspace.asRelativePath(uri, false).split('\\').join('/'); }

  status() {
    const c = this.c;
    const profile = c.profiles.find(p => p.name === c.profile);
    const state = c.busy ? 'busy' : c.session ? (c.paused ? 'paused' : 'debugging') : c.runTask ? (c.lastMode === 'watch' ? 'hot-reload' : 'running') : 'idle';
    return {
      ok: true, state,
      project: c.project ? c.projectName() : null,
      projectType: c.project ? (c.app ? c.app.framework : '.NET') : null,
      profile: c.project ? (c.profile || null) : null,
      url: c.listeningUrl || this.deps.browserUrl(profile) || null,
      companionApis: c.companionList().map(entry => path.basename(entry.project)),
      browser: c.browser(),
      lastResult: c.result || null,
      lastResultIsError: !!c.resultError
    };
  }

  entries() {
    const c = this.c;
    const selected = c.project?.toString();
    return [
      ...c.projects.map(uri => ({ id: this.rel(uri), name: path.basename(uri.fsPath), type: '.NET', path: uri.fsPath, uri, app: undefined, selected: uri.toString() === selected })),
      ...c.apps.map(app => ({
        id: this.rel(app.uri), name: path.basename(app.dir) || app.dir, type: app.framework, path: app.dir, uri: app.uri, app, selected: app.uri.toString() === selected,
        profiles: app.profiles.map(p => ({ name: p.name, command: [p.command, ...p.args].join(' '), url: p.url || null }))
      }))
    ];
  }

  async listProjects() {
    const c = this.c;
    if (!c.active() && !c.busy) await c.refresh();
    const projects = this.entries().map(({ uri, app, ...entry }) => {
      if (entry.selected && !app) entry.profiles = c.profiles.map(p => ({ name: p.name, url: p.url || null }));
      return entry;
    });
    return { ok: true, projects, selectedProfile: c.project ? c.profile || null : null, ...(c.project ? {} : { note: 'No project is selected. Call dotpilot_select_project.' }) };
  }

  resolveProject(query) {
    const entries = this.entries();
    const wanted = String(query).trim().toLowerCase();
    const norm = value => String(value).split('\\').join('/').toLowerCase();
    for (const match of [e => norm(e.id) === norm(wanted), e => norm(e.path) === norm(wanted), e => e.name.toLowerCase() === wanted]) {
      const found = entries.filter(match);
      if (found.length === 1) return found[0];
      if (found.length > 1) throw new Error(`"${query}" matches several projects. Use one of these ids: ${found.map(e => e.id).join(', ')}.`);
    }
    throw new Error(`No project matches "${query}". Valid ids: ${entries.map(e => e.id).join(', ') || '(none found)'}.`);
  }

  async selectProject(query) {
    const c = this.c;
    if (c.active() || c.busy) throw new Error('Stop the running app before changing the project.');
    await c.refresh();
    const entry = this.resolveProject(query);
    await c.applyProject(entry.uri, entry.app);
    return { ...this.status(), profiles: c.profiles.map(p => p.name) };
  }

  async selectProfile(name) {
    const c = this.c;
    if (c.active() || c.busy) throw new Error('Stop the running app before changing the profile.');
    if (!c.project) throw new Error('No project is selected. Call dotpilot_select_project first.');
    await c.loadProfiles();
    const wanted = String(name).trim().toLowerCase();
    if (!c.app && ['none', 'no profile', ''].includes(wanted)) { await c.applyProfile(''); return this.status(); }
    const profile = c.profiles.find(p => p.name.toLowerCase() === wanted);
    if (!profile) throw new Error(`No profile "${name}". Valid profiles: ${c.profiles.map(p => p.name).join(', ') || '(none)'}${c.app ? '' : ', none'}.`);
    await c.applyProfile(profile.name);
    return this.status();
  }

  async requireProject() {
    const c = this.c;
    if (!c.project) await c.refresh();
    if (!c.project) {
      const options = this.entries().map(e => e.id);
      throw new Error(options.length ? `No project is selected. Call dotpilot_select_project with one of: ${options.join(', ')}.` : 'No runnable project was found in this workspace.');
    }
  }

  async waitReady(seconds) {
    const c = this.c;
    const begin = Date.now();
    while (Date.now() - begin < seconds * 1000) {
      if (!c.active() && !c.busy) return;
      if (c.listeningUrl) return;
      const profile = c.profiles.find(p => p.name === c.profile);
      const endpoint = this.deps.localEndpoint(profile);
      if (endpoint) {
        // Un puerto ocupado antes de iniciar no demuestra que arrancó nuestra aplicación.
        if (!c.occupiedAtLaunch && await this.deps.portIsOpen(endpoint)) return;
      } else if (Date.now() - begin > 3000 && !profile?.launchBrowser) return;
      await sleep(250);
    }
  }

  outcome(extra = {}) {
    const c = this.c;
    const status = this.status();
    const failed = c.resultError || (status.state === 'idle' && !!c.result);
    return { ...status, ok: !failed, ...(failed ? { error: c.result } : {}), ...extra };
  }

  async launch(mode, args) {
    const c = this.c;
    await this.requireProject();
    if (c.app && mode !== 'run') throw new Error('Debug and Hot Reload are only available for .NET projects. Use dotpilot_run.');
    if (c.active()) throw new Error('Something is already running. Call dotpilot_stop or dotpilot_restart first.');
    await c.invoke(mode);
    if (!c.resultError) await this.waitReady(args.wait_seconds ?? 30);
    return this.outcome();
  }

  async restart(args) {
    const c = this.c;
    if (!c.active()) throw new Error('Nothing is running. Call dotpilot_run first.');
    await c.invoke('restart');
    if (!c.resultError) await this.waitReady(args.wait_seconds ?? 30);
    return this.outcome();
  }

  async stop() {
    const c = this.c;
    await c.invoke('stop');
    // El cierre termina en segundo plano (por ejemplo docker compose down): se espera brevemente.
    for (let i = 0; i < 40 && (c.active() || c.busy); i++) await sleep(250);
    return this.outcome();
  }

  async build(action) {
    const c = this.c;
    await this.requireProject();
    if (c.app) throw new Error('Build and test are only available for .NET projects.');
    await c.invoke(action);
    const result = this.outcome();
    return result.ok ? result : { ...result, problems: this.diagnostics(false).slice(0, 30) };
  }

  async openBrowser() {
    const c = this.c;
    await this.requireProject();
    await c.invoke('openBrowser');
    return this.outcome({ opened: !c.resultError });
  }

  output(lines) {
    const c = this.c;
    const all = [...c.recentOutput, ...(c.recentPartial ? [c.recentPartial] : [])];
    return {
      ok: true, source: all.length ? 'app' : 'none', lines: all.slice(-lines),
      ...(all.length ? {} : { note: c.session ? 'A debug session writes to the VS Code Debug Console, which is not available here. Use dotpilot_get_problems for build errors.' : 'No output yet. Output is available for apps started with dotpilot_run or dotpilot_hot_reload.' })
    };
  }

  diagnostics(includeWarnings) {
    const { languages, workspace, DiagnosticSeverity } = this.vscode;
    const out = [];
    for (const [uri, list] of languages.getDiagnostics()) {
      if (!workspace.getWorkspaceFolder(uri)) continue;
      for (const item of list) {
        if (item.severity !== DiagnosticSeverity.Error && !(includeWarnings && item.severity === DiagnosticSeverity.Warning)) continue;
        out.push({
          file: this.rel(uri), line: item.range.start.line + 1, column: item.range.start.character + 1,
          severity: item.severity === DiagnosticSeverity.Error ? 'error' : 'warning',
          message: item.message, source: item.source || null, code: typeof item.code === 'object' ? String(item.code.value) : item.code ?? null
        });
      }
    }
    return out;
  }

  problems(includeWarnings) {
    const all = this.diagnostics(includeWarnings);
    return { ok: true, count: all.length, truncated: all.length > 100, problems: all.slice(0, 100) };
  }

  // ---- Conexión con los asistentes instalados ----

  // Copia el servidor MCP a una ruta estable (la carpeta de la extensión cambia con cada versión).
  installServer() {
    const target = path.join(homeDirectory(), 'mcp');
    fs.mkdirSync(target, { recursive: true });
    for (const file of SERVER_FILES) {
      const source = fs.readFileSync(path.join(__dirname, file));
      const destination = path.join(target, file);
      let current;
      try { current = fs.readFileSync(destination); } catch { /* no existe todavía */ }
      if (!current || !current.equals(source)) fs.writeFileSync(destination, source);
    }
    return path.join(target, 'mcp-server.js');
  }

  async connect() {
    const { window, workspace, extensions, ConfigurationTarget } = this.vscode;
    const c = this.c;
    const root = workspace.workspaceFolders?.[0]?.uri.fsPath;
    const items = installedAssistants(id => extensions.getExtension(id)).map(assistant => {
      const file = assistant.file ? assistant.file(root || '') : undefined;
      const needsFolder = assistant.scope === 'project' && !root;
      return {
        label: assistant.name,
        description: assistant.installed ? c.t('Instalado en VS Code') : c.t('No detectado en VS Code'),
        detail: assistant.kind === 'native' ? c.t('Usa las herramientas del modo agente; no necesita archivos.')
          : needsFolder ? c.t('Abre una carpeta para configurarlo.') : c.t('Se escribe en {0}', file),
        picked: assistant.installed && !needsFolder, assistant, file, needsFolder
      };
    });
    const chosen = await window.showQuickPick(items, {
      canPickMany: true, title: c.t('Conectar asistentes de IA'),
      placeHolder: c.t('Elige los asistentes que podrán ejecutar acciones de DotPilot (siempre con tu permiso)')
    });
    if (!chosen?.length) return;
    await workspace.getConfiguration('dotpilot').update('assistantsEnabled', true, ConfigurationTarget.Global);
    const script = this.installServer();
    const done = [], problems = [];
    for (const item of chosen) {
      const { assistant, file } = item;
      if (assistant.kind === 'native') { done.push(assistant.name); continue; }
      if (item.needsFolder) { problems.push(`${assistant.name}: ${c.t('Abre una carpeta para configurarlo.')}`); continue; }
      try {
        let existing = '';
        try { existing = fs.readFileSync(file, 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
        const next = assistant.kind === 'toml' ? mergeTomlConfig(existing, script) : mergeJsonConfig(existing, script);
        if (next !== undefined) {
          fs.mkdirSync(path.dirname(file), { recursive: true });
          fs.writeFileSync(file, next);
        }
        done.push(assistant.name);
      } catch (error) {
        problems.push(`${assistant.name}: ${error.message}`);
      }
    }
    const lines = [];
    if (done.length) lines.push(c.t('Conectado: {0}. Reinicia o recarga el asistente para que cargue las herramientas.', done.join(', ')));
    if (problems.length) lines.push(c.t('No se pudo configurar: {0}', problems.join('; ')));
    if (chosen.some(item => item.assistant.id === 'claude' && !item.needsFolder)) lines.push(c.t('.mcp.json contiene una ruta de tu equipo: no lo subas al repositorio.'));
    const message = lines.join(' ');
    if (problems.length) window.showWarningMessage('DotPilot: ' + message); else window.showInformationMessage('DotPilot: ' + message);
  }
}

module.exports = { AgentApi, SERVER_FILES };
