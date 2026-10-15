'use strict';
// Acciones específicas de .NET: compilar, consultar MSBuild, framework, pausa y pasos.
// Son métodos del Controller: extension.js los mezcla en su prototipo. Reciben sus dependencias (incluido
// `vscode`) para que las pruebas unitarias puedan ejecutarlos con un VS Code simulado.
module.exports = ({ vscode, path, execFile, CancelledOperation, LABELS, buildArgs }) => ({
  async build(action) {
    if (!(await this.ensureProject())) return;
    this.assertDotnet();
    const target = await this.buildTarget();
    if (!target) return;
    if (!(await vscode.workspace.saveAll(false))) throw new Error(this.t('No se pudieron guardar todos los archivos.'));
    await this.executeTask(`${this.t(LABELS[action])} ${path.basename(target.fsPath)}`, buildArgs(action, target.fsPath, this.configuration), target);
    this.result = this.t('{0} completado: {1}', this.t(LABELS[action]), path.basename(target.fsPath));
    this.resultError = false;
    vscode.window.setStatusBarMessage('DotPilot: ' + this.t('{0} completado', this.t(LABELS[action])), 4000);
  },

  queryProperties(framework, properties, project = this.project.fsPath) {
    const generation = this.generation;
    return new Promise((resolve, reject) => {
      const args = ['msbuild', project, '-nologo', `-getProperty:${properties.join(',')}`, `-p:Configuration=${this.configuration}`];
      if (framework) args.push(`-p:TargetFramework=${framework}`);
      const child = execFile(this.config().get('dotnetPath', 'dotnet'), args, { cwd: path.dirname(project), timeout: 30000, maxBuffer: 4 * 1024 * 1024, windowsHide: true }, (error, stdout, stderr) => {
        if (this.queryProcess === child) this.queryProcess = undefined;
        if (generation !== this.generation) { reject(new CancelledOperation()); return; }
        if (error) {
          this.output.appendLine(`${stdout}\n${stderr}`);
          reject(new Error(this.t('No se pudo consultar el proyecto. Revisa el SDK de .NET y la salida de DotPilot.')));
          return;
        }
        try { resolve(JSON.parse(stdout.trim()).Properties); }
        catch { this.output.appendLine(stdout); reject(new Error(this.t('Se requiere un SDK .NET 8 o posterior para consultar el proyecto.'))); }
      });
      this.queryProcess = child;
    });
  },

  async framework(forcePick = false) {
    this.assertDotnet();
    const props = await this.queryProperties('', ['TargetFramework', 'TargetFrameworks', 'OutputType']);
    if (!['Exe', 'WinExe'].includes(props.OutputType)) throw new Error(this.t('El proyecto de inicio debe ser una aplicación ejecutable, no una biblioteca.'));
    const frameworks = (props.TargetFramework || props.TargetFrameworks || '').split(';').filter(Boolean);
    if (!forcePick && frameworks.includes(this.selectedFramework)) return this.selectedFramework;
    const selected = frameworks.length === 1 ? frameworks[0] : frameworks.length > 1 ? await vscode.window.showQuickPick(frameworks, { title: this.t('Framework que quieres ejecutar') }) : undefined;
    if (selected) {
      this.selectedFramework = selected;
      await this.context.workspaceState.update(`framework:${this.project.toString()}`, selected);
      this.render();
      return selected;
    }
    if (frameworks.length) return undefined;
    throw new Error(this.t('Este proyecto no declara TargetFramework. Esta versión admite proyectos del SDK de .NET.'));
  },

  async step(action) {
    if (!this.session || !this.paused || this.stoppedThread === undefined) throw new Error(this.t('Detén la ejecución en un breakpoint antes de avanzar por pasos.'));
    await this.session.customRequest({ stepOver: 'next', stepInto: 'stepIn', stepOut: 'stepOut' }[action], { threadId: this.stoppedThread });
  },

  async pause() {
    if (!this.session) throw new Error(this.t('Pausar requiere iniciar con Depurar.'));
    const result = await this.session.customRequest('threads');
    const threads = result.threads || [];
    if (!threads.length) throw new Error(this.t('El depurador todavía no tiene hilos disponibles.'));
    let thread = threads[0];
    if (threads.length > 1 && !this.paused) {
      const chosen = await vscode.window.showQuickPick(threads.map(t => ({ label: t.name, thread: t })), { title: this.t('Hilo que quieres pausar') });
      if (!chosen) return;
      thread = chosen.thread;
    }
    await this.session.customRequest(this.paused ? 'continue' : 'pause', { threadId: this.stoppedThread || thread.id });
  }
});
