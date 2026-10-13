'use strict';
// Proyectos: búsqueda, selección de proyecto, perfil y destino.
// Son métodos del Controller: extension.js los mezcla en su prototipo. Reciben sus dependencias (incluido
// `vscode`) para que las pruebas unitarias puedan ejecutarlos con un VS Code simulado.
module.exports = ({ vscode, path, EXCLUDE, EXCLUDE_APPS, profilesFrom }) => ({
  // Una sola búsqueda a la vez: una ráfaga de cambios de archivos pide una repetición, no varias en paralelo.
  refresh(duringOperation = false) {
    if (this.refreshing) { this.refreshAgain = true; return this.refreshing; }
    const run = async () => {
      do { this.refreshAgain = false; await this.scan(duringOperation); } while (this.refreshAgain);
    };
    this.refreshing = run().finally(() => { this.refreshing = undefined; });
    return this.refreshing;
  },

  async scan(duringOperation) {
    if (this.active() || (this.busy && !duringOperation)) { this.pendingRefresh = true; return; }
    if (!this.projects.length && !this.apps.length && !this.scanned) { this.scanning = true; this.render(); }
    let projects, apps;
    try {
      [projects, apps] = await Promise.all([vscode.workspace.findFiles('**/*.{csproj,fsproj,vbproj}', EXCLUDE), this.detectApps()]);
    } finally { this.scanning = false; this.scanned = true; }
    this.projects = projects.sort((a, b) => a.fsPath.localeCompare(b.fsPath));
    this.apps = apps;
    const previous = this.project?.toString() || this.context.workspaceState.get('project');
    this.project = [...this.projects, ...this.apps.map(app => app.uri)].find(uri => uri.toString() === previous)
      || (this.projects.length === 1 ? this.projects[0] : !this.projects.length && this.apps.length === 1 ? this.apps[0].uri : undefined);
    this.app = this.apps.find(app => app.uri.toString() === this.project?.toString());
    await this.loadProfiles();
    this.selectedFramework = this.project && !this.app ? this.context.workspaceState.get(`framework:${this.project.toString()}`, '') : '';
    await this.loadTarget();
    this.render();
  },

  // Busca proyectos que no son .NET (Node.js, PHP/Laravel, Python, Docker Compose) y cómo iniciarlos.
  async detectApps() {
    if (!vscode.workspace.workspaceFolders?.length) return [];
    const { MARKERS, MAX_DIRS, addPhpEntries, detectWorkspace } = require('../detect');
    const uris = await vscode.workspace.findFiles(`**/{${MARKERS.join(',')}}`, EXCLUDE_APPS, MAX_DIRS * 6);
    const files = new Map(), byPath = new Map();
    for (const uri of uris) {
      const dir = path.dirname(uri.fsPath);
      if (!files.has(dir)) files.set(dir, new Set());
      files.get(dir).add(path.basename(uri.fsPath));
      byPath.set(uri.fsPath, uri);
    }
    const io = require('../workspace-io').createIo(vscode);
    await addPhpEntries(files, vscode.workspace.workspaceFolders.map(folder => folder.uri.fsPath), io.exists, io.listDirectories);
    const apps = await detectWorkspace(files, io);
    // Proyectos PHP servibles por Laragon: Apache con su configuración real (virtual hosts, .htaccess, módulos).
    await require('../laragon').addApacheProfiles(apps, io, {
      script: path.join(__dirname, '..', '..', 'assets', 'laragon.ps1'), hints: [this.config().get('laragonPath', '')]
    });
    return apps.map(app => ({ ...app, uri: byPath.get(app.marker) || vscode.Uri.file(app.marker) }));
  },

  projectName() {
    if (!this.project) return this.t('Seleccionar proyecto');
    return this.app ? path.basename(this.app.dir) || this.app.dir : path.basename(this.project.fsPath);
  },

  profileLabel(name = this.profile) {
    const profile = this.profiles.find(p => p.name === name);
    return profile?.label ? this.t(profile.label) : name || this.t('Sin perfil');
  },

  async loadProfiles() {
    this.cachedLanguage = undefined;
    this.profiles = [];
    this.profile = '';
    this.profileError = undefined;
    if (!this.project) return;
    if (this.app) this.profiles = this.app.profiles.map(profile => ({ ...profile }));
    else {
      const uri = vscode.Uri.joinPath(this.project, '..', 'Properties', 'launchSettings.json');
      try {
        const text = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8');
        this.profiles = profilesFrom(text);
      } catch (error) {
        if (error.code !== 'FileNotFound' && error.code !== 'ENOENT') {
          this.profileError = this.t('No se pudo leer launchSettings.json. Corrígelo con Editar perfiles antes de ejecutar.');
          this.output.appendLine(this.t('No se pudieron leer perfiles de {0}: {1}', uri.fsPath, error.message));
          vscode.window.showWarningMessage(this.t('launchSettings.json no se pudo leer. Consulta la salida de DotPilot.'));
        }
      }
    }
    const stored = this.context.workspaceState.get(`profile:${this.project.toString()}`);
    this.profile = stored === '' && !this.app ? '' : (this.profiles.find(p => p.name === stored) || this.profiles[0])?.name || '';
  },

  async selectProject() {
    if (this.active()) throw new Error(this.t('Detén la ejecución antes de cambiar el proyecto.'));
    await this.refresh(true);
    if (!this.projects.length && !this.apps.length) throw new Error(this.t('No se encontraron proyectos compatibles (.NET, Node.js, PHP, Python o Docker).'));
    const items = [];
    const separator = label => { if (this.projects.length && this.apps.length) items.push({ label, kind: vscode.QuickPickItemKind.Separator }); };
    separator('.NET');
    for (const uri of this.projects) items.push({ label: path.basename(uri.fsPath), description: vscode.workspace.asRelativePath(uri), uri });
    separator(this.t('Otros proyectos'));
    for (const app of this.apps) items.push({
      label: path.basename(app.dir) || app.dir, description: `${app.framework} · ${vscode.workspace.asRelativePath(app.dir)}`, uri: app.uri, app
    });
    const choice = await vscode.window.showQuickPick(items, { title: this.t('Proyecto de inicio'), placeHolder: this.t('Selecciona la aplicación que quieres ejecutar') });
    if (!choice) return false;
    await this.applyProject(choice.uri, choice.app);
    return true;
  },

  // Usado por el selector del panel y por los asistentes de IA.
  async applyProject(uri, app) {
    this.project = uri;
    this.app = app;
    await this.context.workspaceState.update('project', this.project.toString());
    await this.loadProfiles();
    this.selectedFramework = this.app ? '' : this.context.workspaceState.get(`framework:${this.project.toString()}`, '');
    await this.loadTarget();
    this.render();
  },

  async applyProfile(name) {
    this.profile = name;
    await this.context.workspaceState.update(`profile:${this.project.toString()}`, this.profile);
    this.render();
  },

  async ensureProject() {
    this.assertTrusted();
    if (!this.project && !(await this.selectProject())) return false;
    return !!this.project;
  },

  async selectProfile() {
    if (this.active()) throw new Error(this.t('Detén la ejecución antes de cambiar el perfil.'));
    if (!(await this.ensureProject())) return;
    await this.loadProfiles();
    const choice = await vscode.window.showQuickPick(this.app ? this.profiles.map(p => ({
      label: this.profileLabel(p.name), description: p.description || [p.command, ...p.args].join(' '), detail: p.description ? undefined : p.url, value: p.name
    })) : [
      ...this.profiles.map(p => ({ label: p.name, description: p.url, value: p.name })),
      { label: this.t('Sin perfil'), description: this.t('Ejecutar sin launchSettings.json'), value: '' }
    ], { title: this.t('Perfil de ejecución'), placeHolder: this.t(this.app ? 'Elige cómo iniciar el proyecto' : 'Perfiles Project; IIS Express y Docker no son compatibles') });
    if (!choice) return;
    await this.applyProfile(choice.value);
  },

  async selectConfiguration() {
    if (this.active()) throw new Error(this.t('Detén la ejecución antes de cambiar la configuración.'));
    const choice = await vscode.window.showQuickPick(['Debug', 'Release'], { title: this.t('Configuración de compilación') });
    if (choice) {
      this.configuration = choice;
      await this.context.workspaceState.update('configuration', choice);
      this.render();
    }
  },

  async loadTarget() {
    this.target = undefined;
    if (!this.project || this.app) return;
    const stored = this.context.workspaceState.get(`target:${this.folder().uri.toString()}`);
    if (stored === 'project' || (!stored && this.config().get('buildScope') === 'project')) { this.target = this.project; return; }
    const solutions = await vscode.workspace.findFiles(new vscode.RelativePattern(this.folder(), '**/*.{sln,slnx}'), EXCLUDE);
    this.target = solutions.find(uri => uri.toString() === stored) || (solutions.length === 1 ? solutions[0] : !solutions.length ? this.project : undefined);
  },

  assertDotnet() {
    if (this.app) throw new Error(this.t('Esta acción solo está disponible para proyectos .NET.'));
  },

  async selectTarget() {
    if (!(await this.ensureProject())) return false;
    this.assertDotnet();
    const solutions = await vscode.workspace.findFiles(new vscode.RelativePattern(this.folder(), '**/*.{sln,slnx}'), EXCLUDE);
    const chosen = await vscode.window.showQuickPick([
      { label: this.t('Proyecto de inicio'), description: path.basename(this.project.fsPath), uri: this.project, value: 'project' },
      ...solutions.map(uri => ({ label: path.basename(uri.fsPath), description: vscode.workspace.asRelativePath(uri), uri, value: uri.toString() }))
    ], { title: this.t('Destino para compilar, limpiar, restaurar y ejecutar pruebas') });
    if (!chosen) return false;
    this.target = chosen.uri;
    await this.context.workspaceState.update(`target:${this.folder().uri.toString()}`, chosen.value);
    this.render();
    return true;
  },

  async buildTarget() {
    await this.loadTarget();
    if (!this.target && !(await this.selectTarget())) return undefined;
    return this.target;
  },

  async editProfile() {
    if (!(await this.ensureProject())) return;
    // En proyectos que no son .NET se abre el archivo que define cómo se inicia (package.json, compose.yaml…).
    if (this.app) { await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(this.project)); return; }
    const uri = vscode.Uri.joinPath(this.project, '..', 'Properties', 'launchSettings.json');
    try { await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(uri)); }
    catch { throw new Error(this.t('El proyecto no tiene Properties/launchSettings.json. Puedes ejecutar con Sin perfil.')); }
  }
});
