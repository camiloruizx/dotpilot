'use strict';
const vscode = require('vscode');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const net = require('node:net');
const fs = require('node:fs/promises');
const os = require('node:os');
const { profilesFrom, buildArgs, runArgs, browserUrl, localEndpoint } = require('./core');
const { resolveLanguage, translate, languageMismatch } = require('./i18n');
const { fields, validSetting, readSettings } = require('./settings');

const EXCLUDE = '**/{bin,obj,node_modules,.git}/**';
const EXCLUDE_APPS = '**/{bin,obj,node_modules,.git,vendor,.venv,venv,__pycache__,.next,.nuxt}/**';
const NOISE = /[\\/](?:node_modules|\.git|vendor|\.venv|venv|__pycache__)[\\/]/;
// Acciones que solo tienen sentido con un proyecto .NET seleccionado.
const DOTNET_ONLY = new Set(['manageCompanions', 'debug', 'watch', 'selectConfiguration', 'selectFramework', 'selectTarget', 'diagnostics', 'buildMenu', 'build', 'rebuild', 'clean', 'restore', 'test', 'analyze']);
const LABELS = { build: 'Compilar', rebuild: 'Recompilar', clean: 'Limpiar', restore: 'Restaurar NuGet', test: 'Ejecutar pruebas', analyze: 'Analizar código' };
const BROWSERS = { edge: 'Microsoft Edge', chrome: 'Google Chrome', external: 'Predeterminado del sistema' };
const ACTIONS = ['run', 'debug', 'watch', 'showSettings', 'advancedSettings', 'continue', 'pause', 'stop', 'restart', ...Object.keys(LABELS), 'selectProject', 'selectProfile', 'selectConfiguration', 'selectFramework', 'selectTarget', 'refresh', 'buildMenu', 'openBrowser', 'editProfile', 'showOutput', 'showProblems', 'diagnostics', 'stepOver', 'stepInto', 'stepOut'];
ACTIONS.push('selectBrowser', 'browserEdge', 'browserChrome', 'browserExternal', 'browserDefault', 'connectAssistants', 'manageCompanions', 'packageVsix', 'packageApk');
class CancelledOperation extends Error { constructor() { super('Operation stopped.'); } }

function portIsOpen(endpoint) {
  return new Promise(resolve => {
    const socket = net.createConnection(endpoint);
    const finish = value => { socket.destroy(); resolve(value); };
    socket.setTimeout(400);
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
    socket.once('timeout', () => finish(false));
  });
}

class Controller {
  constructor(context) {
    this.context = context;
    this.projects = [];
    this.apps = [];
    this.app = undefined;
    this.appProcess = undefined;
    this.companions = [];
    this.listeningUrl = undefined;
    this.occupiedAtLaunch = false;
    this.refreshing = undefined;
    this.refreshAgain = false;
    this.scanning = false;
    this.scanned = false;
    this.recentOutput = [];
    this.recentPartial = '';
    this.bridge = undefined;
    this.agent = undefined;
    this.profiles = [];
    this.project = undefined;
    this.profile = '';
    this.configuration = context.workspaceState.get('configuration', 'Debug');
    this.tasks = new Set();
    this.session = undefined;
    this.runTask = undefined;
    this.lastMode = 'run';
    this.busy = false;
    this.paused = false;
    this.generation = 0;
    this.result = '';
    this.resultError = false;
    this.selectedFramework = '';
    this.target = undefined;
    this.browserTimer = undefined;
    this.browserOpened = false;
    this.pendingRefresh = false;
    this.statusItems = [];
    this.contextValues = new Map();
    this.output = vscode.window.createOutputChannel('DotPilot');
    context.subscriptions.push(this.output);
  }

  config() { return vscode.workspace.getConfiguration('dotpilot', this.project || null); }
  language() { return this.cachedLanguage ??= resolveLanguage(vscode.workspace.getConfiguration('dotpilot').get('language', 'auto'), vscode.env.language); }
  t(message, ...values) { return translate(this.language(), message, ...values); }
  folder() { return this.project && vscode.workspace.getWorkspaceFolder(this.project); }
  assertTrusted() {
    if (!vscode.workspace.isTrusted) throw new Error(this.t('Confía en este espacio de trabajo antes de ejecutar o compilar.'));
    if (!vscode.workspace.workspaceFolders?.length) throw new Error(this.t('Abre una carpeta con un proyecto compatible.'));
  }

  // Listen before starting the task, so even a fast process cannot escape tracking.
  // `terminal` es un Pseudoterminal propio (proyectos que no son .NET); sin él se ejecuta `dotnet`.
  // `secondary`: tarea en ejecución que acompaña al proyecto principal (una API); no es `runTask`.
  async executeTask(label, args, target, running = false, terminal = undefined, secondary = false) {
    const id = randomBytes(16).toString('hex');
    const execution = terminal ? new vscode.CustomExecution(async () => terminal)
      : new vscode.ProcessExecution(this.config().get('dotnetPath', 'dotnet'), args, { cwd: path.dirname(target.fsPath), env: { DOTNET_WATCH_SUPPRESS_LAUNCH_BROWSER: '1' } });
    const task = new vscode.Task({ type: 'dotpilot', operation: label, id }, this.folder(), label, 'DotPilot', execution, terminal ? terminal.matcher : '$msCompile');
    task.presentationOptions = { reveal: vscode.TaskRevealKind.Always, panel: secondary ? vscode.TaskPanelKind.Dedicated : vscode.TaskPanelKind.Shared, clear: true };
    if (!running) task.group = args[0] === 'test' ? vscode.TaskGroup.Test : vscode.TaskGroup.Build;
    const generation = this.generation;
    let finish;
    const done = new Promise(resolve => { finish = resolve; });
    let started;
    const ready = new Promise(resolve => { started = resolve; });
    let exitCode;
    let ended = false;
    const startListener = (terminal ? vscode.tasks.onDidStartTask : vscode.tasks.onDidStartTaskProcess)(event => {
      if (event.execution.task.definition.id === id) {
        started(); startListener.dispose();
        if (generation !== this.generation) event.execution.terminate();
      }
    });
    const processListener = vscode.tasks.onDidEndTaskProcess(event => {
      if (event.execution.task.definition.id !== id) return;
      exitCode = event.exitCode;
      if (running && exitCode && generation === this.generation) {
        this.result = this.t('La aplicación terminó con código {0}. Revisa Terminal y Problemas.', exitCode);
        this.resultError = true;
      }
      finish(event.exitCode);
    });
    const endListener = vscode.tasks.onDidEndTask(event => {
      if (event.execution.task.definition.id !== id) return;
      ended = true;
      this.tasks.delete(event.execution);
      if (this.runTask === event.execution) {
        this.runTask = undefined; this.cancelBrowserMonitor();
        void this.closeBrowser().catch(error => this.output.appendLine(error.message));
        // Si el proyecto principal termina por sí mismo, sus APIs no quedan huérfanas.
        if (generation === this.generation) void this.stopCompanions();
      }
      setTimeout(() => { finish(exitCode); started(); startListener.dispose(); processListener.dispose(); endListener.dispose(); this.render(); }, 0);
    });
    try {
      const execution = await vscode.tasks.executeTask(task);
      if (!ended) {
        this.tasks.add(execution);
        if (running && !secondary) this.runTask = execution;
      }
      this.render();
    } catch (error) {
      startListener.dispose(); processListener.dispose(); endListener.dispose(); throw error;
    }
    if (running) { await ready; return; }
    const code = await done;
    if (generation !== this.generation) throw new CancelledOperation();
    if (code !== 0) throw new Error(code === undefined ? this.t('La tarea se canceló o no pudo iniciarse.') : this.t('{0} terminó con errores (código {1}). Consulta Terminal y Problemas.', label, code));
  }

  active() { return !!(this.runTask || this.session); }

  async launch(mode) {
    if (this.active()) throw new Error(this.t('Ya hay una ejecución activa. Usa Detener o Reiniciar.'));
    const generation = ++this.generation;
    const cancelled = () => generation !== this.generation;
    await this.closeBrowser();
    if (cancelled()) return;
    if (!(await this.ensureProject())) return;
    await this.loadProfiles();
    if (this.profileError) throw new Error(this.profileError);
    if (!(await vscode.workspace.saveAll(false))) throw new Error(this.t('No se pudieron guardar todos los archivos.'));
    if (this.app) return this.launchApp(mode, generation);
    const framework = await this.framework();
    if (!framework || cancelled()) return;
    // APIs complementarias: se inician (y se espera a que escuchen) antes del proyecto principal.
    await this.offerCompanions(generation);
    if (cancelled()) return;
    try {
      await this.startCompanions(generation);
      if (cancelled()) return;
      await this.launchDotnet(mode, framework, generation);
    } catch (error) {
      await this.stopCompanions();
      throw error;
    }
  }

  async launchDotnet(mode, framework, generation) {
    const cancelled = () => generation !== this.generation;
    this.lastMode = mode;
    this.runningBrowser = this.browser();
    this.browserOpened = false;
    const selected = this.profiles.find(p => p.name === this.profile);
    if (mode === 'run' || mode === 'watch') {
      // Mismo ejecutor que los demás tipos: la salida (incluidas excepciones en ejecución) queda disponible
      // para los asistentes, y los errores de compilación se publican en el panel Problemas.
      await this.runManaged({
        label: `${mode === 'watch' ? 'Hot Reload' : this.t('Ejecutar')} ${path.basename(this.project.fsPath)}`,
        command: this.config().get('dotnetPath', 'dotnet'),
        args: runArgs(this.project.fsPath, this.configuration, this.profile, framework, mode === 'watch'),
        cwd: path.dirname(this.project.fsPath),
        env: { DOTNET_WATCH_SUPPRESS_LAUNCH_BROWSER: '1', DOTNET_SYSTEM_CONSOLE_ALLOW_ANSI_COLOR_REDIRECTION: '1' },
        diagnostics: true
      }, selected, generation);
      return;
    }
    const csharp = vscode.extensions.getExtension('ms-dotnettools.csharp');
    if (!csharp) throw new Error(this.t('Instala la extensión C# de Microsoft (ms-dotnettools.csharp) para depurar.'));
    await csharp.activate();
    if (cancelled()) return;
    const args = buildArgs('build', this.project.fsPath, this.configuration);
    args.push('--framework', framework);
    await this.executeTask(`${this.t('Preparar depuración')} ${path.basename(this.project.fsPath)}`, args, this.project);
    if (cancelled()) return;
    const props = await this.queryProperties(framework, ['TargetPath', 'TargetFramework']);
    if (cancelled()) return;
    if (!props.TargetPath) throw new Error(this.t('MSBuild no devolvió la ruta de la aplicación.'));
    const config = {
      name: `DotPilot: ${path.basename(this.project.fsPath)} (${this.profile || this.t('Sin perfil')})`,
      type: 'coreclr', request: 'launch', program: props.TargetPath,
      cwd: selected?.workingDirectory ? path.resolve(path.dirname(this.project.fsPath), selected.workingDirectory) : path.dirname(this.project.fsPath), console: 'integratedTerminal', stopAtEntry: false,
      launchSettingsFilePath: path.join(path.dirname(this.project.fsPath), 'Properties', 'launchSettings.json'),
      launchSettingsProfile: this.profile || null, __dotpilot: true
    };
    // Open the browser only after the server reports readiness. CoreCLR uses
    // launchSettings for args/env/URLs, but does not implement launchBrowser.
    if (selected?.url && selected.launchBrowser && this.config().get('openBrowser', true)) {
      config.console = 'internalConsole';
    }
    if (!(await vscode.debug.startDebugging(this.folder(), config))) throw new Error(this.t('No se pudo iniciar el depurador C#. Consulta la consola de depuración.'));
    if (cancelled()) await this.stop();
  }

  stop() {
    if (this.stopping) return this.stopping;
    this.stopping = this.stopOwnedExecution().finally(() => { this.stopping = undefined; this.render(); });
    return this.stopping;
  }

  async stopOwnedExecution() {
    this.generation++;
    this.cancelBrowserMonitor();
    this.queryProcess?.kill();
    this.listeningUrl = undefined;
    const session = this.session;
    const tasks = [...this.tasks];
    const pending = [this.closeBrowser(), this.stopCompanions()];
    if (this.appProcess && !this.appProcess.exited) pending.push(this.appProcess.stop());
    if (session) pending.push(new Promise((resolve, reject) => {
      const timer = setTimeout(() => { listener.dispose(); reject(new Error(this.t('El depurador no terminó a tiempo.'))); }, 10000);
      const listener = vscode.debug.onDidTerminateDebugSession(ended => {
        if (ended.id === session.id) { clearTimeout(timer); listener.dispose(); resolve(); }
      });
      vscode.debug.stopDebugging(session).then(undefined, error => { clearTimeout(timer); listener.dispose(); reject(error); });
    }));
    for (const execution of tasks) pending.push(new Promise((resolve, reject) => {
      const timer = setTimeout(() => { listener.dispose(); reject(new Error(this.t('La tarea no terminó a tiempo.'))); }, 10000);
      const listener = vscode.tasks.onDidEndTask(event => {
        if (event.execution === execution) { clearTimeout(timer); listener.dispose(); resolve(); }
      });
      execution.terminate();
    }));
    const results = await Promise.allSettled(pending);
    const failed = results.find(result => result.status === 'rejected');
    if (failed) throw failed.reason;
    this.render();
  }

  async invoke(action) {
    let acquired = false;
    try {
      if (action === 'showSettings') return await this.showSettings();
      if (action === 'advancedSettings') return await vscode.commands.executeCommand('workbench.action.openSettings', '@ext:camiloruizx.dotpilot');
      if (action === 'selectBrowser') return await this.selectBrowser();
      if (action === 'connectAssistants') return await this.agentApi().connect();
      if (action in { browserEdge: 1, browserChrome: 1, browserExternal: 1, browserDefault: 1 }) return await this.chooseBrowser({ browserEdge: 'edge', browserChrome: 'chrome', browserExternal: 'external', browserDefault: 'default' }[action]);
      if (action === 'showOutput') return this.output.show();
      if (action === 'showProblems') return await vscode.commands.executeCommand('workbench.actions.view.problems');
      this.assertTrusted();
      if (this.app && DOTNET_ONLY.has(action)) this.assertDotnet();
      if (action === 'stop') return await this.stop();
      if (action === 'pause' || action === 'continue') return await this.pause();
      if (['stepOver', 'stepInto', 'stepOut'].includes(action)) return await this.step(action);
      if (action === 'openBrowser') return await this.openBrowser();
      if (this.busy) throw new Error(this.t('Hay una operación en curso. Puedes detenerla con el botón Detener.'));
      this.busy = true; acquired = true; this.render();
      this.result = ''; this.resultError = false;
      if (action in LABELS) await this.build(action);
      else if (['run', 'debug', 'watch'].includes(action)) await this.launch(action);
      else if (action === 'restart') { await this.stop(); await this.launch(this.lastMode); }
      else if (action === 'selectProject') await this.selectProject();
      else if (action === 'selectProfile') await this.selectProfile();
      else if (action === 'selectConfiguration') await this.selectConfiguration();
      else if (action === 'selectFramework') { if (await this.ensureProject()) { if (this.active()) throw new Error(this.t('Detén la ejecución antes de cambiar el framework.')); await this.framework(true); } }
      else if (action === 'selectTarget') await this.selectTarget();
      else if (action === 'manageCompanions') await this.manageCompanions();
      else if (action === 'packageVsix' || action === 'packageApk') await this.packageProject(action);
      else if (action === 'editProfile') await this.editProfile();
      else if (action === 'diagnostics') { if (await this.ensureProject()) await this.executeTask(this.t('Información del SDK .NET'), ['--info'], this.project); }
      else if (action === 'refresh') await this.refresh(true);
      else if (action === 'buildMenu') {
        const chosen = await vscode.window.showQuickPick(Object.entries(LABELS).map(([value, label]) => ({ label: this.t(label), value })), { title: this.t('Compilar') });
        if (chosen) await this.build(chosen.value);
      }
    } catch (error) {
      if (error instanceof CancelledOperation) { this.result = this.t('Operación detenida.'); this.resultError = false; return; }
      this.output.appendLine(error.stack || error.message);
      this.result = error.message; this.resultError = true;
      void vscode.window.showErrorMessage(`DotPilot: ${error.message}`, this.t('Ver salida')).then(choice => { if (choice) this.output.show(); });
    } finally {
      // Stop/pause can be invoked while a build is awaiting completion.
      if (acquired) this.busy = false;
      if (this.pendingRefresh && !this.active() && !this.busy) { this.pendingRefresh = false; await this.refresh(); }
      this.render();
    }
  }

  dispose() { void this.bridge?.dispose().catch(() => {}); this.bridge = undefined; if (this.appProcess && !this.appProcess.exited) void this.appProcess.stop(); void this.stopCompanions(); this.cancelBrowserMonitor(); this.generation++; this.queryProcess?.kill(); for (const execution of this.tasks) execution.terminate(); void this.closeBrowser().catch(() => {}); }
}

// Responsabilidades del Controller repartidas por módulo (src/controller). Se mezclan en el prototipo.
const deps = { vscode, path, fs, os, randomBytes, execFile, portIsOpen, CancelledOperation, EXCLUDE, EXCLUDE_APPS, NOISE, DOTNET_ONLY, LABELS, BROWSERS, ACTIONS,
  profilesFrom, buildArgs, runArgs, browserUrl, localEndpoint, resolveLanguage, translate, languageMismatch, fields, validSetting, readSettings };
for (const name of ['browser', 'projects', 'managed', 'companions', 'packaging', 'assistants', 'dotnet', 'panel']) Object.assign(Controller.prototype, require('./controller/' + name)(deps));

function activate(context) {
  const controller = new Controller(context);
  context.subscriptions.push(controller);
  const actions = ACTIONS;
  for (const action of actions) context.subscriptions.push(vscode.commands.registerCommand(`dotpilot.${action}`, () => controller.invoke(action)));
  context.subscriptions.push(vscode.window.registerWebviewViewProvider('dotpilot.panel', controller));
  context.subscriptions.push(vscode.tasks.registerTaskProvider('dotpilot', {
    provideTasks: () => [], resolveTask: task => task.execution ? task : undefined
  }));
  context.subscriptions.push(vscode.debug.onDidStartDebugSession(session => {
    controller.browserStarted(session);
    if (session.configuration.__dotpilot) { controller.session = session; controller.paused = false; controller.render(); }
  }));
  context.subscriptions.push(vscode.debug.onDidTerminateDebugSession(session => {
    controller.browserTerminated(session);
    if (controller.session?.id === session.id) {
      controller.session = undefined; controller.paused = false; controller.stoppedThread = undefined; controller.render();
      void controller.stopCompanions();
      void controller.closeBrowser().catch(error => controller.output.appendLine(error.message));
    }
  }));
  context.subscriptions.push(vscode.debug.registerDebugAdapterTrackerFactory('coreclr', {
    createDebugAdapterTracker(session) {
      if (!session.configuration.__dotpilot) return;
      return { onDidSendMessage(message) {
        if (message.type !== 'event') return;
        if (message.event === 'stopped') { controller.paused = true; controller.stoppedThread = message.body?.threadId; controller.render(); }
        if (message.event === 'continued') { controller.paused = false; controller.stoppedThread = undefined; controller.render(); }
        const profile = controller.profiles.find(p => p.name === controller.profile);
        if (message.event === 'output' && /Now listening on:\s+https?:\/\//.test(message.body?.output || '') && profile?.launchBrowser && controller.config().get('openBrowser', true) && !controller.browserOpened) {
          void controller.openBrowser(profile).catch(error => controller.output.appendLine(error.message));
        }
      } };
    }
  }));
  const watcher = vscode.workspace.createFileSystemWatcher('**/*.{csproj,fsproj,vbproj,sln,slnx,launchSettings.json}');
  let timer;
  const refresh = () => { clearTimeout(timer); timer = setTimeout(() => controller.refresh().catch(error => controller.output.appendLine(error.message)), 250); };
  // Archivos que definen proyectos de Node.js, PHP, Python y Docker; se ignoran dependencias instaladas.
  const appWatcher = vscode.workspace.createFileSystemWatcher('**/{package.json,artisan,manage.py,composer.json,requirements.txt,pyproject.toml,compose.yaml,compose.yml,docker-compose.yaml,docker-compose.yml}');
  const appRefresh = uri => { if (!NOISE.test(uri.fsPath)) refresh(); };
  context.subscriptions.push(appWatcher, appWatcher.onDidCreate(appRefresh), appWatcher.onDidDelete(appRefresh), appWatcher.onDidChange(appRefresh));
  context.subscriptions.push(watcher, watcher.onDidCreate(refresh), watcher.onDidDelete(refresh), watcher.onDidChange(refresh), vscode.workspace.onDidChangeWorkspaceFolders(refresh), vscode.workspace.onDidChangeConfiguration(event => { if (event.affectsConfiguration('dotpilot', controller.project)) { controller.cachedLanguage = undefined; controller.render(); } }), { dispose: () => clearTimeout(timer) });
  // Herramientas para Copilot y otros agentes de VS Code; el resto de asistentes usa el servidor MCP.
  if (vscode.lm?.registerTool) {
    const { TOOLS } = require('./agent-tools');
    for (const tool of TOOLS) {
      try {
        context.subscriptions.push(vscode.lm.registerTool(tool.name, {
          prepareInvocation: () => tool.mutating
            ? { invocationMessage: controller.t(tool.title), confirmationMessages: { title: 'DotPilot · ' + controller.t(tool.title), message: controller.t(tool.userDescription) } }
            : { invocationMessage: controller.t(tool.title) },
          invoke: async options => {
            // Con token, la solicitud viene del chat y VS Code ya pidió confirmación.
            const origin = { client: options.toolInvocationToken ? 'GitHub Copilot' : controller.t('Otra extensión de VS Code'), confirmed: !!options.toolInvocationToken };
            const result = await controller.agentApi().call(tool.name, options.input, origin);
            return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(JSON.stringify(result, null, 2))]);
          }
        }));
      } catch (error) { controller.output.appendLine(`${tool.name}: ${error.message}`); }
    }
  }
  const syncBridge = () => controller.syncBridge().catch(error => controller.output.appendLine(error.message));
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(event => { if (event.affectsConfiguration('dotpilot.assistantsEnabled')) void syncBridge(); if (event.affectsConfiguration('dotpilot.language')) void controller.hintLanguage().catch(() => {}); }),
    vscode.workspace.onDidGrantWorkspaceTrust(() => void syncBridge())
  );
  void syncBridge();
  void controller.hintLanguage().catch(() => {});
  void controller.refresh().catch(error => controller.output.appendLine(error.message));
  return controller;
}

module.exports = { activate, Controller };
