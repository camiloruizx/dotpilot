'use strict';
// APIs complementarias: proyectos .NET que se inician antes que el proyecto principal y se detienen junto con él.
// Son métodos del Controller: extension.js los mezcla en su prototipo. Reciben sus dependencias (incluido
// `vscode`) para que las pruebas unitarias puedan ejecutarlos con un VS Code simulado.
module.exports = ({ vscode, path, fs, os, portIsOpen, profilesFrom, localEndpoint, runArgs, browserUrl }) => {
  const { killTree } = require('../runner');
  const { portsOf, localUrls, matchCandidate, isWebProject, companionName, cleanList, waitForReady } = require('../companions');
  const READY_TIMEOUT = 90000;

  return {
    companionList() {
      if (!this.project || this.app) return [];
      return cleanList(this.context.workspaceState.get(`companions:${this.project.toString()}`, []));
    },

    async saveCompanions(list) {
      await this.context.workspaceState.update(`companions:${this.project.toString()}`, list.length ? list : undefined);
    },

    async readLaunchProfiles(project) {
      try { return profilesFrom(await fs.readFile(path.join(path.dirname(project), 'Properties', 'launchSettings.json'), 'utf8')); }
      catch { return []; }
    },

    // ¿Debe abrirse el navegador cuando la API esté lista, y en qué ruta? Por omisión sigue a su perfil
    // (launchBrowser/launchUrl) y, si la API usa Swagger, abre /swagger aunque el perfil no lo pida.
    async companionBrowse(entry, profile) {
      let swagger = false;
      try { swagger = /Swashbuckle\.AspNetCore|NSwag\./i.test(await fs.readFile(entry.project, 'utf8')); } catch { /* sin proyecto legible */ }
      return {
        open: typeof entry.browse === 'boolean' ? entry.browse : !!(profile?.launchBrowser || swagger),
        path: entry.path ?? (profile?.launchUrl || (swagger ? 'swagger' : ''))
      };
    },

    // Pestaña independiente: cerrarla no detiene nada (la vinculada con la ejecución es la del proyecto principal).
    async openCompanionBrowser(url) {
      const uri = await vscode.env.asExternalUri(vscode.Uri.parse(url));
      const browser = this.browser();
      if (browser !== 'external' && this.launchInBrowser(browser, uri.toString())) return;
      if (!(await vscode.env.openExternal(uri))) throw new Error(this.t('No se pudo abrir el navegador.'));
    },

    // Con las APIs «por separado», su ventana es de la API: cerrarla la detiene, y Detener API la cierra. Es una ventana
    // con perfil propio cuyo proceso se vigila (no una sesión de depuración, que mostraría la barra flotante de VS Code).
    // Con el navegador «external», en un espacio remoto o si no se puede abrir, es una pestaña independiente.
    async openApiBrowser(url, entry, cancelled) {
      const browser = this.browser();
      if (browser === 'external' || vscode.env.remoteName) return this.openCompanionBrowser(url);
      const uri = await vscode.env.asExternalUri(vscode.Uri.parse(url));
      if (cancelled()) return;
      await this.closeApiBrowser();
      const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'dotpilot-browser-'));
      const child = cancelled() ? undefined : this.launchOwnedBrowser(browser, uri.toString(), directory);
      if (!child) {
        await fs.rm(directory, { recursive: true, force: true }).catch(() => {});
        if (!cancelled()) await this.openCompanionBrowser(url);
        return;
      }
      const run = { child, directory, closing: false };
      this.apiBrowserRun = run;
      child.once('exit', () => {
        if (this.apiBrowserRun === run) this.apiBrowserRun = undefined;
        void this.removeBrowserDirectory(run);
        // Cerraron la ventana (no fue Detener API): la API se detiene.
        if (!run.closing) void this.invoke('stopApi');
      });
    },

    async closeApiBrowser() {
      const run = this.apiBrowserRun;
      if (!run) return;
      run.closing = true;
      this.apiBrowserRun = undefined;
      await killTree(run.child);
    },

    // Proyectos web del espacio de trabajo (menos el principal) que pueden servir de API.
    async apiCandidates() {
      const result = [];
      for (const uri of this.projects) {
        if (uri.fsPath === this.project.fsPath) continue;
        let text;
        try { text = await fs.readFile(uri.fsPath, 'utf8'); } catch { continue; }
        if (!isWebProject(text)) continue;
        result.push({ id: uri.fsPath, uri, name: companionName(uri.fsPath), profiles: await this.readLaunchProfiles(uri.fsPath) });
      }
      return result;
    },

    // ¿El proyecto principal apunta a un localhost que no es suyo? (appsettings*.json)
    async detectApi() {
      if (!this.project || this.app) return undefined;
      const dir = path.dirname(this.project.fsPath);
      let names;
      try { names = (await fs.readdir(dir)).filter(name => /^appsettings(\..+)?\.json$/i.test(name)); } catch { return undefined; }
      const own = portsOf(this.profiles.map(p => p.url));
      const urls = new Map();
      for (const name of names) {
        try {
          for (const item of localUrls(await fs.readFile(path.join(dir, name), 'utf8'))) {
            if (!own.has(item.port) && !urls.has(item.port)) urls.set(item.port, item);
          }
        } catch { /* archivo ilegible: se ignora */ }
      }
      if (!urls.size) return undefined;
      const taken = new Set(this.companionList().map(entry => entry.project));
      const candidates = (await this.apiCandidates()).filter(candidate => !taken.has(candidate.id));
      return { urls: [...urls.values()], candidates, match: matchCandidate([...urls.values()], candidates) };
    },

    async pickCompanionFile() {
      const chosen = await vscode.window.showOpenDialog({
        canSelectMany: false, canSelectFolders: false, title: this.t('Proyecto de la API'), openLabel: this.t('Seleccionar'),
        filters: { [this.t('Proyecto .NET')]: ['csproj', 'fsproj', 'vbproj'] }
      });
      return chosen?.[0]?.fsPath;
    },

    async addCompanionProject(project, preferredProfile = '') {
      if (project === this.project.fsPath) throw new Error(this.t('Un proyecto no puede ser su propia API.'));
      const list = this.companionList();
      if (list.some(entry => entry.project === project)) throw new Error(this.t('Esa API ya está agregada.'));
      const profiles = await this.readLaunchProfiles(project);
      let profile = profiles.some(p => p.name === preferredProfile) ? preferredProfile : '';
      if (!profile && profiles.length === 1) profile = profiles[0].name;
      if (!profile && profiles.length > 1) {
        const chosen = await vscode.window.showQuickPick(profiles.map(p => ({ label: p.name, description: p.url })), { title: this.t('Perfil de la API') });
        if (!chosen) return false;
        profile = chosen.label;
      }
      await this.saveCompanions([...list, { project, profile }]);
      vscode.window.setStatusBarMessage('DotPilot: ' + this.t('API agregada: {0}', companionName(project)), 4000);
      this.render();
      return true;
    },

    async chooseCompanion() {
      const found = await this.detectApi();
      const taken = new Set(this.companionList().map(entry => entry.project));
      const candidates = found?.candidates || (await this.apiCandidates()).filter(candidate => !taken.has(candidate.id));
      const items = candidates.map(candidate => ({
        label: candidate.name, description: vscode.workspace.asRelativePath(candidate.uri),
        detail: found?.match?.id === candidate.id ? this.t('Sugerida: usa {0}', found.match.url) : undefined,
        project: candidate.id, profile: found?.match?.id === candidate.id ? found.match.profile : ''
      }));
      items.sort((a, b) => Number(!!b.detail) - Number(!!a.detail));
      items.push({ label: '$(folder-opened) ' + this.t('Examinar…'), browse: true });
      const choice = await vscode.window.showQuickPick(items, { title: this.t('Proyecto de la API'), placeHolder: this.t('Selecciona la API que quieres iniciar junto con este proyecto') });
      if (!choice) return false;
      const project = choice.browse ? await this.pickCompanionFile() : choice.project;
      if (!project) return false;
      return this.addCompanionProject(project, choice.profile);
    },

    async manageCompanions() {
      if (this.active()) throw new Error(this.t('Detén la ejecución antes de cambiar las APIs.'));
      if (!(await this.ensureProject())) return;
      this.assertDotnet();
      const list = this.companionList();
      const items = [{ label: '$(add) ' + this.t('Agregar API…'), value: 'add' }];
      if (list.length) items.push({ label: this.t('APIs complementarias'), kind: vscode.QuickPickItemKind.Separator });
      for (const entry of list) {
        const profile = (await this.readLaunchProfiles(entry.project)).find(p => p.name === entry.profile);
        const view = await this.companionBrowse(entry, profile);
        const name = companionName(entry.project);
        items.push({ label: '$(trash) ' + this.t('Quitar {0}', name), description: entry.profile, detail: entry.project, value: 'remove', entry });
        items.push({ label: '$(globe) ' + this.t('Abrir navegador de {0} al iniciar: {1}', name, this.t(view.open ? 'Sí' : 'No')),
          description: view.open ? '/' + String(view.path).replace(/^\//, '') : '', value: 'browser', entry, open: view.open });
      }
      const choice = await vscode.window.showQuickPick(items, { title: this.t('APIs complementarias'), placeHolder: this.t('Se inician antes que el proyecto y se detienen juntas') });
      if (!choice) return;
      if (choice.value === 'add') await this.chooseCompanion();
      else if (choice.value === 'browser') {
        await this.saveCompanions(list.map(entry => entry.project === choice.entry.project ? { ...entry, browse: !choice.open } : entry));
        this.render();
      } else {
        await this.saveCompanions(list.filter(entry => entry.project !== choice.entry.project));
        this.render();
      }
    },

    // Al ejecutar un proyecto sin APIs configuradas: si su appsettings apunta a un localhost ajeno, se pregunta una vez.
    async offerCompanions(generation) {
      if (this.companionList().length) return;
      const askedKey = `companionsAsked:${this.project.toString()}`;
      if (this.context.workspaceState.get(askedKey)) return;
      const found = await this.detectApi();
      if (!found || generation !== this.generation) return;
      const match = found.match && found.candidates.find(candidate => candidate.id === found.match.id);
      const add = this.t('Agregar'), browse = this.t('Indicar proyecto…'), never = this.t('No preguntar más');
      const choice = await vscode.window.showInformationMessage(
        match ? this.t('Este proyecto parece usar la API {0} ({1}). ¿Quieres iniciarla junto con él?', match.name, found.match.url)
          : this.t('Este proyecto parece usar una API en {0}. ¿Quieres indicar su proyecto para iniciarla junto con él?', found.urls[0].url),
        { modal: true }, match ? add : browse, never);
      if (generation !== this.generation) return;
      if (choice === never) await this.context.workspaceState.update(askedKey, true);
      else if (choice === add) await this.addCompanionProject(match.id, found.match.profile);
      else if (choice === browse) {
        const project = await this.pickCompanionFile();
        if (project) await this.addCompanionProject(project);
      }
    },

    // 'together': las APIs se inician y se detienen con el proyecto. 'separate': tienen sus propios Ejecutar/Detener.
    companionMode() {
      if (!this.project || this.app) return 'together';
      return this.context.workspaceState.get(`companionMode:${this.project.toString()}`) === 'separate' ? 'separate' : 'together';
    },

    // ¿Hay alguna API en ejecución (o arrancando) iniciada por DotPilot?
    apiRunning() {
      return !!this.apiStarting || this.companions.some(state => state.proc && !state.proc.exited);
    },

    async selectCompanionMode() {
      if (this.active()) throw new Error(this.t('Detén la ejecución antes de cambiar las APIs.'));
      if (!(await this.ensureProject())) return;
      this.assertDotnet();
      if (!this.companionList().length) throw new Error(this.t('No hay APIs complementarias configuradas.'));
      const current = this.companionMode();
      const choice = await vscode.window.showQuickPick([
        { label: this.t('Juntas con el proyecto'), description: current === 'together' ? this.t('Seleccionado') : '', detail: this.t('Ejecutar inicia ambos y Detener cierra ambos.'), value: 'together' },
        { label: this.t('Por separado'), description: current === 'separate' ? this.t('Seleccionado') : '', detail: this.t('Ejecutar y Detener solo afectan al proyecto; la API tiene sus propios botones.'), value: 'separate' }
      ], { title: this.t('Ejecución de las APIs'), placeHolder: this.t('Elige cómo se ejecutan las APIs complementarias') });
      if (!choice) return;
      await this.context.workspaceState.update(`companionMode:${this.project.toString()}`, choice.value === 'together' ? undefined : choice.value);
      this.render();
    },

    // Inicia las APIs (modo por separado) sin tocar el proyecto principal.
    async runApi() {
      if (!(await this.ensureProject())) return;
      this.assertDotnet();
      if (!this.companionList().length) throw new Error(this.t('No hay APIs complementarias configuradas.'));
      if (this.companionMode() !== 'separate') throw new Error(this.t('Las APIs se inician junto con el proyecto. Elige «Por separado» para ejecutarlas aparte.'));
      if (this.apiRunning()) throw new Error(this.t('La API ya está en ejecución.'));
      const token = ++this.apiGeneration;
      this.apiStarting = true;
      this.render();
      try {
        await this.startCompanions(() => token !== this.apiGeneration, true);
      } catch (error) {
        await this.stopCompanions();
        throw error;
      } finally {
        this.apiStarting = false;
        this.render();
      }
    },

    async stopApi() {
      this.apiGeneration++;
      this.apiStarting = false;
      await this.closeApiBrowser().catch(error => this.output.appendLine(error.message));
      await this.stopCompanions();
      this.result = '';
      this.render();
    },

    // Con las APIs por separado: inicia la API (si no corre), espera a que esté lista y después ejecuta el proyecto.
    // Si la API falla no se ejecuta el proyecto. Un proyecto que ya corre no se vuelve a lanzar.
    async runAll() {
      if (!(await this.ensureProject())) return;
      this.assertDotnet();
      if (!this.companionList().length || this.companionMode() !== 'separate') throw new Error(this.t('Ejecutar todo requiere las APIs complementarias en modo «Por separado».'));
      if (!this.apiRunning()) await this.runApi();
      if (!this.active()) await this.invoke('run');
    },

    // Abre (o vuelve a abrir) la página de la API en marcha, su Swagger si lo usa. Útil si la ventana no se abrió sola
    // (ajuste «Abrir navegador automáticamente») o si se cerró con el navegador «Predeterminado del sistema».
    async openApi() {
      const state = this.companions.find(item => item.proc && !item.proc.exited && item.browseUrl);
      if (!state) throw new Error(this.t(this.apiStarting ? 'La API aún se está iniciando.' : 'La API no está en ejecución.'));
      await this.openApiBrowser(state.browseUrl, state.entry, () => false);
    },

    // Detiene la API y el proyecto; lo que no esté corriendo se deja como está.
    async stopAll() {
      if (this.apiRunning()) await this.stopApi();
      if (this.active() || this.busy || this.tasks?.size) await this.stop();
    },

    // Inicia las APIs en orden y espera a que cada una esté escuchando. Lanza si alguna falla.
    // `cancelled` indica si la espera ya no vale; `independent`, que la API tiene su propio ciclo de vida.
    async startCompanions(cancelled, independent = false) {
      for (const entry of this.companionList()) {
        if (cancelled()) return;
        await this.startCompanion(entry, cancelled, independent);
      }
    },

    async startCompanion(entry, cancelled, independent = false) {
      const generation = this.generation;
      const name = companionName(entry.project);
      try { await fs.access(entry.project); }
      catch { throw new Error(this.t('No se encontró el proyecto de la API: {0}. Quítalo o corrígelo en APIs complementarias.', entry.project)); }
      const profiles = await this.readLaunchProfiles(entry.project);
      const profile = profiles.find(p => p.name === entry.profile) || profiles[0];
      const endpoint = localEndpoint(profile);
      if (endpoint && await portIsOpen(endpoint)) {
        this.output.appendLine(`[DotPilot] ${this.t('La API {0} ya está en ejecución en el puerto {1}; se reutiliza.', name, endpoint.port)}`);
        return;
      }
      if (cancelled()) return;
      this.result = this.t('Iniciando API {0}…', name); this.resultError = false; this.render();
      const props = await this.queryProperties('', ['TargetFramework', 'TargetFrameworks', 'OutputType'], entry.project, independent);
      if (cancelled()) return;
      if (!['Exe', 'WinExe'].includes(props.OutputType)) throw new Error(this.t('La API {0} debe ser una aplicación ejecutable, no una biblioteca.', name));
      const framework = (props.TargetFramework || props.TargetFrameworks || '').split(';').filter(Boolean)[0] || '';
      // Si la API termina sola, su ventana se cierra con ella (solo cuando es independiente del proyecto).
      const state = { name, url: undefined, exitCode: undefined, proc: undefined,
        onExit: independent ? () => { void this.closeApiBrowser(); } : undefined };
      const terminal = this.appTerminal({
        command: this.config().get('dotnetPath', 'dotnet'), args: runArgs(entry.project, this.configuration, profile?.name || '', framework),
        cwd: path.dirname(entry.project), detectUrl: true,
        env: { ...this.terminalEnv(), DOTNET_WATCH_SUPPRESS_LAUNCH_BROWSER: '1', DOTNET_SYSTEM_CONSOLE_ALLOW_ANSI_COLOR_REDIRECTION: '1' }
      }, generation, state);
      this.companions.push(state);
      await this.executeTask(`API ${name}`, [], this.project, true, terminal, 'api');
      const outcome = await waitForReady({
        isOpen: endpoint ? () => portIsOpen(endpoint) : undefined,
        urlSeen: () => !!state.url, exited: () => state.exitCode !== undefined, cancelled, timeout: READY_TIMEOUT
      });
      if (outcome === 'cancelled' || cancelled()) return;
      if (outcome === 'exited') throw new Error(this.t('La API {0} terminó con código {1} antes de estar lista. Revisa su terminal.', name, state.exitCode));
      if (outcome === 'timeout') {
        void state.proc?.stop();
        throw new Error(this.t('La API {0} no respondió en {1} s. Revisa su terminal.', name, READY_TIMEOUT / 1000));
      }
      this.result = ''; this.render();
      // La página de la API (su Swagger si lo usa) se recuerda para el botón «Abrir API», aunque no se abra sola.
      const view = await this.companionBrowse(entry, profile);
      const pageUrl = browserUrl({ url: profile?.url || '', launchUrl: view.path }, state.url);
      state.entry = entry; state.browseUrl = pageUrl || state.url;
      if (this.config().get('openBrowser', true) && view.open && pageUrl && !cancelled()) {
        // Por separado, la ventana de la API es suya: cerrarla detiene la API. Juntas con el proyecto es una pestaña independiente.
        const opened = independent ? this.openApiBrowser(pageUrl, entry, cancelled) : this.openCompanionBrowser(pageUrl);
        await opened.catch(error => this.output.appendLine(error.message));
      }
    },

    async stopCompanions() {
      const list = this.companions;
      this.companions = [];
      await Promise.allSettled(list.map(state => state.proc?.stop()));
      for (const execution of [...this.apiTasks]) execution.terminate();
    }
  };
};
