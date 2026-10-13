'use strict';
// Ejecución con el ejecutor propio (Node.js, PHP, Python, Docker, Apache y .NET sin depurar).
// Son métodos del Controller: extension.js los mezcla en su prototipo. Reciben sus dependencias (incluido
// `vscode`) para que las pruebas unitarias puedan ejecutarlos con un VS Code simulado.
module.exports = ({ vscode, path, portIsOpen, localEndpoint }) => ({
  // Inicia un proyecto que no es .NET (Node.js, PHP, Python, Docker) en una terminal propia de DotPilot.
  async launchApp(mode, generation) {
    if (mode !== 'run') throw new Error(this.t('Este tipo de proyecto solo admite Ejecutar, Detener y Reiniciar.'));
    const selected = this.profiles.find(p => p.name === this.profile);
    if (!selected) throw new Error(this.t('No se encontró cómo iniciar este proyecto.'));
    this.lastMode = 'run';
    this.runningBrowser = this.browser();
    this.browserOpened = false;
    const config = this.config();
    const command = selected.tool === 'php' ? config.get('phpPath', 'php') || 'php'
      : selected.tool === 'python' && config.get('pythonPath', '') ? config.get('pythonPath') : selected.command;
    // Python guarda print() en un búfer cuando la salida es una tubería; sin esto la URL llegaría tarde.
    const env = { ...selected.env, ...(selected.tool === 'python' ? { PYTHONUNBUFFERED: '1' } : {}), ...(selected.tool === 'laragon' ? { DOTPILOT_LANG: this.language() } : {}) };
    await this.runManaged({
      label: `${this.t('Ejecutar')} ${path.basename(this.app.dir)}`, command, args: selected.args, cwd: this.app.dir, env,
      stop: selected.stop, detectUrl: selected.detectUrl
    }, selected, generation);
  },

  // Variables definidas en terminal.integrated.env.*: las tareas de proceso las heredaban y aquí se conservan.
  terminalEnv() {
    const key = { win32: 'windows', darwin: 'osx' }[process.platform] || 'linux';
    const value = vscode.workspace.getConfiguration('terminal.integrated').get(`env.${key}`);
    return Object.fromEntries(Object.entries(value && typeof value === 'object' ? value : {}).filter(([, item]) => typeof item === 'string'));
  },

  // Inicia un servidor en una terminal propia de DotPilot, capturando su salida y su URL.
  async runManaged(spec, profile, generation) {
    const cancelled = () => generation !== this.generation;
    // Si una ejecución anterior aún limpia (por ejemplo docker compose down), se espera a que termine.
    await this.appProcess?.stopping;
    if (cancelled()) return;
    this.listeningUrl = undefined;
    const endpoint = localEndpoint(profile);
    const occupied = endpoint ? await portIsOpen(endpoint) : false;
    if (cancelled()) return;
    this.occupiedAtLaunch = occupied;
    this.recentOutput = [];
    this.recentPartial = '';
    // Errores de compilación de dotnet run → panel Problemas (se limpian al iniciar cada ejecución).
    if (spec.diagnostics) {
      if (!this.diagnosticCollection) {
        this.diagnosticCollection = vscode.languages.createDiagnosticCollection('dotpilot');
        this.context.subscriptions.push(this.diagnosticCollection);
      }
      const { DiagnosticFeed } = require('../msbuild');
      this.diagnosticFeed = new DiagnosticFeed(vscode, this.diagnosticCollection, spec.cwd);
      this.diagnosticFeed.clear(spec.cwd);
    } else this.diagnosticFeed = undefined;
    const terminal = this.appTerminal({
      command: spec.command, args: spec.args, cwd: spec.cwd, env: { ...this.terminalEnv(), ...spec.env }, stop: spec.stop, detectUrl: spec.detectUrl !== false
    }, generation);
    await this.executeTask(spec.label, [], this.project, true, terminal);
    if (!cancelled() && !occupied) this.monitorBrowser(profile, generation);
  },

  appTerminal(spec, generation) {
    const { AppProcess } = require('../runner');
    const writer = new vscode.EventEmitter(), closer = new vscode.EventEmitter();
    const queue = [];
    let opened = false, closed = false, requested = false;
    const write = text => {
      this.remember(text);
      const data = String(text).replace(/\r?\n/g, '\r\n');
      if (opened) writer.fire(data); else queue.push(data);
    };
    const finish = code => { if (closed) return; closed = true; closer.fire(code); };
    const proc = new AppProcess(spec, {
      onOutput: write,
      onUrl: url => this.appUrl(url, generation),
      onError: error => write(`[DotPilot] ${this.t('No se pudo iniciar {0}: {1}', spec.command, error.message)}\n`),
      onExit: code => {
        // Un cierre pedido por el usuario (Ctrl+C, cerrar la terminal) no es un fallo de la aplicación.
        if (generation === this.generation && code && !requested) {
          this.result = this.t('La aplicación terminó con código {0}. Revisa Terminal y Problemas.', code);
          this.resultError = true;
        }
        write(`\n[DotPilot] ${this.t('El proceso terminó con código {0}.', code)}\n`);
        finish(code);
      }
    });
    this.appProcess = proc;
    return {
      onDidWrite: writer.event,
      onDidClose: closer.event,
      open: () => {
        opened = true;
        for (const data of queue.splice(0)) writer.fire(data);
        try { proc.start(); } catch (error) {
          write(`[DotPilot] ${this.t('No se pudo iniciar {0}: {1}', spec.command, error.message)}\n`);
          if (generation === this.generation) { this.result = error.message; this.resultError = true; }
          finish(1);
        }
      },
      // Cerrar la terminal o pulsar Ctrl+C detiene el servidor; la limpieza continúa en segundo plano.
      close: () => { requested = true; void proc.stop(); finish(); },
      handleInput: data => { if (data === '\u0003') { requested = true; void proc.stop(); finish(); } else proc.write(data); }
    };
  },

  // Últimas líneas de salida del servidor, para que un asistente de IA pueda leerlas.
  remember(text) {
    const { stripAnsi } = require('../runner');
    const lines = (this.recentPartial + stripAnsi(text)).replace(/\r/g, '').split('\n');
    this.recentPartial = lines.pop();
    for (const line of lines) {
      this.recentOutput.push(line.slice(0, 500));
      this.diagnosticFeed?.addLine(line);
    }
    if (this.recentOutput.length > 1000) this.recentOutput.splice(0, this.recentOutput.length - 1000);
  },

  // La URL se tomó de la salida del propio servidor, así que es la que realmente quedó escuchando.
  appUrl(url, generation) {
    if (generation !== this.generation) return;
    const profile = this.profiles.find(p => p.name === this.profile);
    this.listeningUrl = profile?.fixedUrl ? profile.url : url;
    this.render();
    if (profile?.launchBrowser && this.config().get('openBrowser', true) && !this.browserOpened) {
      void this.openBrowser(profile).catch(error => this.output.appendLine(error.message));
    }
  }
});
