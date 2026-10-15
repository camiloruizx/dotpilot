'use strict';
// Panel, ajustes y barra de estado.
// Son métodos del Controller: extension.js los mezcla en su prototipo. Reciben sus dependencias (incluido
// `vscode`) para que las pruebas unitarias puedan ejecutarlos con un VS Code simulado.
module.exports = ({ vscode, path, DOTNET_ONLY, LABELS, BROWSERS, ACTIONS, browserUrl, fields, validSetting, readSettings }) => ({
  async showSettings() {
    this.requestedTab = 'settings';
    await vscode.commands.executeCommand('dotpilot.panel.focus');
    if (this.webviewReady && this.view?.visible) {
      // Keep the request for the next ready event if the hidden webview is
      // still being restored and cannot receive messages yet.
      if (await this.view.webview.postMessage({ type: 'tab', tab: 'settings' })) this.requestedTab = undefined;
    }
  },

  async updateSetting(key, value) {
    if (!validSetting(key, value)) throw new Error(this.t('Opción o valor no válido.'));
    if (key === 'browser') return this.chooseBrowser(value);
    const field = fields.find(field => field.key === key);
    const config = field.scope === 'window' ? vscode.workspace.getConfiguration('dotpilot') : this.config();
    const folderOverride = field.scope !== 'window' && config.inspect(key)?.workspaceFolderValue !== undefined;
    const target = field.scope === 'machine' ? vscode.ConfigurationTarget.Global
      : folderOverride && this.folder() ? vscode.ConfigurationTarget.WorkspaceFolder
      : vscode.workspace.workspaceFolders?.length ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global;
    await config.update(key, value, target);
    this.cachedLanguage = undefined;
    this.render();
  },

  resolveWebviewView(view) {
    this.view = view;
    this.webviewReady = false;
    this.viewLanguage = undefined;
    this.lastViewState = undefined;
    this.context.subscriptions.push(view.onDidChangeVisibility(() => this.render()), view.onDidDispose(() => {
      if (this.view === view) { this.view = undefined; this.webviewReady = false; }
      this.render();
    }));
    const media = vscode.Uri.joinPath(this.context.extensionUri, 'media');
    view.webview.options = { enableScripts: true, localResourceRoots: [media] };
    view.webview.html = require('../view').panelHtml({ iconUri: view.webview.asWebviewUri(vscode.Uri.joinPath(media, 'dotpilot-icon.png')).toString(), cspSource: view.webview.cspSource, language: this.language() });
    const allowed = new Set(ACTIONS);
    this.context.subscriptions.push(view.webview.onDidReceiveMessage(async message => {
      if (message?.action === 'ready') {
        this.viewLanguage = undefined; this.lastViewState = undefined;
        this.webviewReady = true; this.render();
        if (this.requestedTab) { await view.webview.postMessage({ type: 'tab', tab: this.requestedTab }); this.requestedTab = undefined; }
        return;
      }
      if (message?.action === 'updateSetting') {
        let error;
        try { await this.updateSetting(message.key, message.value); } catch (failure) { error = failure.message; }
        await view.webview.postMessage({ type: 'settingResult', key: typeof message.key === 'string' ? message.key : '', error });
        this.render(); return;
      }
      if (message && allowed.has(message.action)) void this.invoke(message.action);
    }));
    this.render();
  },

  render() {
    const active = this.active();
    const project = this.projectName();
    const dotnet = !this.app;
    const hasProjects = !!(this.projects.length || this.apps.length);
    const selectedProfile = this.profiles.find(p => p.name === this.profile);
    const address = this.listeningUrl || browserUrl(selectedProfile) || '';
    const status = this.scanning ? this.t('Buscando proyectos…') : this.busy ? this.t('Operación en curso…') : this.session ? (this.paused ? this.t('En pausa') : this.t('Depurando')) : this.runTask ? (this.lastMode === 'watch' ? this.t('Hot Reload activo') : this.t('Ejecutando')) : this.t('Listo');
    const enabled = ['showOutput', 'showProblems', 'editProfile', 'advancedSettings', 'selectBrowser', 'connectAssistants'];
    if (!this.busy) enabled.push('refresh');
    if (!this.busy && dotnet) enabled.push('selectTarget', 'buildMenu', ...Object.keys(LABELS));
    if (!this.busy && !active) enabled.push('selectProject', 'selectProfile');
    if (!this.busy && !active && (!this.app || this.app.profiles.length)) enabled.push('run');
    const companionCount = this.companionList().length;
    const apiSeparate = companionCount > 0 && this.companionMode() === 'separate';
    const apiRunning = this.apiRunning();
    if (!this.busy && !active && companionCount) enabled.push('selectCompanionMode');
    if (apiSeparate && !apiRunning) enabled.push('runApi');
    if (apiSeparate && apiRunning) enabled.push('stopApi');
    const packaging = this.app?.packaging?.kind || '';
    if (!this.busy && !active && packaging) enabled.push(packaging === 'vsix' ? 'packageVsix' : 'packageApk');
    if (!this.busy && !active && dotnet) enabled.push('selectConfiguration', 'selectFramework', 'manageCompanions', 'debug', 'watch', 'diagnostics');
    if (active || this.busy || this.tasks.size) enabled.push('stop');
    if (active && !this.busy) enabled.push('restart');
    if (this.session) enabled.push('pause');
    if (this.session && this.paused) enabled.push('stepOver', 'stepInto', 'stepOut');
    if (browserUrl(selectedProfile, this.listeningUrl)) enabled.push('openBrowser');
    if (this.config().get('showStatusBar', false) && !this.statusItems.length) this.createStatusItems();
    for (const item of this.statusItems) {
      item.tooltip = 'DotPilot: ' + this.t(item.label);
      if (item.action === 'buildMenu') item.text = '$(tools) ' + this.t('Compilar');
      if (item.action === 'selectProject') item.text = '$(project) ' + project;
      if (item.action === 'selectProfile') item.text = this.profileLabel() + ' $(chevron-down)';
      if (item.action === 'selectConfiguration') item.text = this.configuration + ' $(chevron-down)';
      if (item.action === 'pause') item.text = this.paused ? '$(debug-continue)' : '$(debug-pause)';
      item.command = enabled.includes(item.action) ? 'dotpilot.' + item.action : undefined;
      item.color = enabled.includes(item.action) ? undefined : new vscode.ThemeColor('disabledForeground');
      item.accessibilityInformation = { label: item.tooltip };
      const visible = this.config().get('showStatusBar', false) && hasProjects && (!this.app || !DOTNET_ONLY.has(item.action)) && (item.action !== 'pause' || this.session) && (!['stop', 'restart'].includes(item.action) || active || this.busy || this.tasks.size);
      if (visible) item.show(); else item.hide();
    }
    for (const [key, value] of Object.entries({ hasProjects, dotnet, busy: this.busy, active, debugging: !!this.session, paused: this.paused, canStop: active || this.busy || !!this.tasks.size, browser: this.browser(), apiSeparate, apiRunning })) {
      if (this.contextValues.get(key) !== value) {
        this.contextValues.set(key, value);
        void vscode.commands.executeCommand('setContext', 'dotpilot.' + key, value);
      }
    }
    if (!this.view?.visible || !this.webviewReady) return;
    const names = this.companionList().map(entry => require('../companions').companionName(entry.project)).join(', ');
    const companions = names ? (apiRunning ? this.t('{0} · en ejecución', names) : names) : this.t('Ninguna');
    const state = { type: 'state', language: this.language(), browser: this.t(BROWSERS[this.browser()]), settings: { ...readSettings(this.config(), vscode.workspace.getConfiguration('dotpilot')), browser: this.browser() }, workspaceSettings: !!vscode.workspace.workspaceFolders?.length, project, isApp: !dotnet, kind: this.app ? this.app.framework : '.NET', companions, hasCompanions: companionCount > 0, companionMode: companionCount ? this.t(apiSeparate ? 'Por separado' : 'Juntas con el proyecto') : '', apiSeparate, apiRunning, packaging, address, assistants: !!this.bridge?.port, profile: this.profileLabel(), configuration: this.configuration, framework: this.selectedFramework || this.t('Automático'), target: this.target ? path.basename(this.target.fsPath) : this.t('Seleccionar destino'), status, path: this.project ? vscode.workspace.asRelativePath(this.project) : '', result: this.result, error: this.resultError, active, paused: this.paused, debugging: !!this.session, hasProjects, enabled };
    const signature = JSON.stringify(state);
    if (signature === this.lastViewState && this.viewLanguage === state.language) return;
    this.lastViewState = signature;
    if (this.viewLanguage !== state.language) {
      state.translations = state.language === 'en' ? require('../i18n').english : {};
      this.viewLanguage = state.language;
    }
    void this.view.webview.postMessage(state).then(sent => { if (!sent) { this.lastViewState = undefined; this.viewLanguage = undefined; } });
  },

  createStatusItems() {
    const buttons = [['selectProject', '$(project)', 'Proyecto de inicio'], ['run', '$(play)', 'Ejecutar sin depurar'], ['selectProfile', '', 'Perfil de ejecución'], ['selectConfiguration', '', 'Configuración de compilación'], ['debug', '$(debug-alt)', 'Iniciar depuración'], ['pause', '$(debug-pause)', 'Pausar / Continuar'], ['stop', '$(debug-stop)', 'Detener'], ['restart', '$(debug-restart)', 'Reiniciar'], ['buildMenu', '', 'Compilar / Recompilar / Limpiar / Analizar']];
    buttons.forEach(([action, text, label], index) => {
      const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 200 - index);
      item.action = action; item.text = text; item.label = label; item.name = 'DotPilot: ' + this.t(label);
      this.statusItems.push(item); this.context.subscriptions.push(item);
    });
  }
});
