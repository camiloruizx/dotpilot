'use strict';
// Navegador vinculado: elección, apertura, ventana propia y su ciclo de vida.
// Son métodos del Controller: extension.js los mezcla en su prototipo. Reciben sus dependencias (incluido
// `vscode`) para que las pruebas unitarias puedan ejecutarlos con un VS Code simulado.
module.exports = ({ vscode, path, fs, os, randomBytes, portIsOpen, BROWSERS, browserUrl, localEndpoint }) => ({
  browser() {
    const stored = this.project && this.context.workspaceState.get(`browser:${this.project.toString()}`);
    const value = stored || this.config().get('browser', 'edge');
    return Object.hasOwn(BROWSERS, value) ? value : 'edge';
  },

  async chooseBrowser(value) {
    if (value !== 'default' && !Object.hasOwn(BROWSERS, value)) throw new Error(this.t('Opción o valor no válido.'));
    const before = this.browser();
    if (this.project) await this.context.workspaceState.update(`browser:${this.project.toString()}`, value === 'default' ? undefined : value);
    else {
      const target = vscode.workspace.workspaceFolders?.length ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global;
      await this.config().update('browser', value === 'default' ? undefined : value, target);
    }
    this.render();
    const after = this.browser();
    // Con la aplicación en ejecución el cambio se aplica ya: si el navegador estaba abierto, se reabre en el elegido.
    if (this.active() && after !== before) {
      this.runningBrowser = after;
      if (this.browserRun || this.browserOpened) {
        void this.reopenBrowser().catch(error => this.output.appendLine(error.message));
      }
    }
  },

  async reopenBrowser() {
    const generation = this.generation;
    await this.closeBrowser();
    if (generation !== this.generation || !this.active()) return;
    this.browserOpened = false;
    await this.openBrowser();
  },

  // Abre la URL en Chrome o Edge directamente; en espacios remotos se deja al editor reenviar el puerto.
  launchInBrowser(browser, url) {
    if (vscode.env.remoteName) return false;
    return require('../browsers').open(browser, url);
  },

  async selectBrowser() {
    const current = this.browser();
    const items = Object.entries(BROWSERS).map(([value, label]) => ({ value, label: this.t(label),
      description: current === value ? this.t('Seleccionado') : '',
      detail: this.t(value === 'external' ? 'Su cierre no detiene la aplicación.' : 'Cerrar la pestaña de la aplicación detiene el proyecto.') }));
    if (this.project) items.push({ value: 'default', label: this.t('Usar ajustes del espacio de trabajo') });
    const choice = await vscode.window.showQuickPick(items, { title: 'DotPilot · ' + this.t('Navegador web'), placeHolder: this.t('Se recuerda por proyecto. Con la aplicación abierta, se reabre en el navegador elegido.') });
    if (choice) await this.chooseBrowser(choice.value);
  },

  cancelBrowserMonitor() { clearTimeout(this.browserTimer); this.browserTimer = undefined; },

  monitorBrowser(profile, generation) {
    const endpoint = localEndpoint(profile);
    if (!endpoint || !profile.launchBrowser || !this.config().get('openBrowser', true)) return;
    let attempts = 0;
    const check = async () => {
      if (generation !== this.generation || !this.runTask || this.browserOpened) return;
      const ready = await portIsOpen(endpoint);
      if (generation !== this.generation || !this.runTask || this.browserOpened) return;
      if (ready) { await this.openBrowser(profile).catch(error => this.output.appendLine(error.message)); return; }
      if (++attempts < 120) this.browserTimer = setTimeout(check, 500);
    };
    this.browserTimer = setTimeout(check, 500);
  },

  async openBrowser(profile = this.profiles.find(p => p.name === this.profile)) {
    const url = browserUrl(profile, this.listeningUrl);
    if (!url) throw new Error(this.t('El perfil seleccionado no contiene una URL HTTP/HTTPS válida.'));
    if (this.browserRun) return this.browserRun.opening;
    const generation = this.generation;
    this.browserOpened = true;
    const uri = await vscode.env.asExternalUri(vscode.Uri.parse(url));
    if (generation !== this.generation) return;
    const browser = this.active() ? this.runningBrowser || this.browser() : this.browser();
    if (!this.active() || browser === 'external') {
      // Sin una ejecución vinculada se abre el navegador elegido, no el predeterminado del sistema.
      if (browser !== 'external' && this.launchInBrowser(browser, uri.toString())) return;
      if (!(await vscode.env.openExternal(uri))) throw new Error(this.t('No se pudo abrir el navegador.'));
      return;
    }
    // Another request may have opened the browser while the URL was forwarded.
    if (this.browserRun) return this.browserRun.opening;
    const run = { token: randomBytes(16).toString('hex'), generation, launched: false, ended: false, closing: false };
    this.browserRun = run;
    run.opening = this.launchBrowser(run, uri, browser);
    return run.opening;
  },

  async launchBrowser(run, uri, browser) {
    try {
      run.directory = await fs.mkdtemp(path.join(os.tmpdir(), 'dotpilot-browser-'));
      if (run.closing || run.generation !== this.generation) return;
      const started = await vscode.debug.startDebugging(this.folder(), {
        name: 'DotPilot: ' + this.t('Navegador'), type: browser === 'chrome' ? 'pwa-chrome' : 'pwa-msedge',
        request: 'launch', url: uri.toString(), webRoot: path.dirname(this.project.fsPath),
        userDataDir: run.directory, cleanUp: 'wholeBrowser', timeout: 15000,
        __dotpilotBrowser: run.token
      }, { noDebug: true, suppressDebugToolbar: true, suppressDebugStatusbar: true, suppressDebugView: true });
      if (!started) throw new Error(this.t('No se pudo abrir el navegador vinculado. Revisa que Edge o Chrome esté instalado, o elige «external» en DotPilot: Browser.'));
      run.launched = true;
      if ((run.ended || run.pageClosed) && !run.closing && run.generation === this.generation && this.active()) void this.invoke('stop');
    } catch (error) {
      run.closing = true;
      if (run.session && !run.ended) await this.endBrowserSession(run.session);
      if (this.browserRun === run) this.browserRun = undefined;
      this.browserOpened = false;
      throw error;
    } finally {
      if (!run.session || run.ended) {
        if (this.browserRun === run) this.browserRun = undefined;
        await this.removeBrowserDirectory(run);
      }
    }
  },

  async endBrowserSession(session) {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { listener.dispose(); reject(new Error(this.t('El navegador no terminó a tiempo.'))); }, 10000);
      const listener = vscode.debug.onDidTerminateDebugSession(ended => {
        if (ended.id === session.id) { clearTimeout(timer); listener.dispose(); resolve(); }
      });
      vscode.debug.stopDebugging(session).then(undefined, error => { clearTimeout(timer); listener.dispose(); reject(error); });
    });
  },

  async closeBrowser() {
    const run = this.browserRun;
    if (!run) return;
    run.closing = true;
    if (!run.closingPromise) run.closingPromise = (async () => {
      await run.opening.catch(() => {});
      if (run.session && !run.ended) await this.endBrowserSession(run.session);
      if (this.browserRun === run) this.browserRun = undefined;
      await this.removeBrowserDirectory(run);
    })();
    await run.closingPromise;
  },

  async removeBrowserDirectory(run) {
    if (!run.directory) return;
    await fs.rm(run.directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
      .catch(error => this.output.appendLine(this.t('No se pudo limpiar el perfil temporal del navegador: {0}', error.message)));
  },

  browserStarted(session) {
    const run = this.browserRun;
    // js-debug also creates child sessions for pages; only own the launch root.
    if (run && session.configuration.__dotpilotBrowser === run.token && !session.parentSession) run.session = session;
    // Chrome can announce its page before the root's start event.
    const parent = session.parentSession;
    if (run && parent && !parent.parentSession && parent.configuration.__dotpilotBrowser === run.token) run.session ||= parent;
    if (run?.session && session.parentSession?.id === run.session.id && session.configuration.__browserTargetType === 'page' && !run.pageSession) run.pageSession = session;
  },

  browserTerminated(session) {
    const run = this.browserRun;
    if (!run) return;
    if (run.session?.id === session.id) run.ended = true;
    else if (run.pageSession?.id === session.id) run.pageClosed = true;
    else return;
    if (run.launched && !run.closing && run.generation === this.generation && this.active()) void this.invoke('stop');
  }
});
