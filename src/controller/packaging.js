'use strict';
// Empaquetado: VSIX para extensiones de VS Code y APK de Android para proyectos Expo.
// Son métodos del Controller: extension.js los mezcla en su prototipo. Reciben sus dependencias (incluido
// `vscode`) para que las pruebas unitarias puedan ejecutarlos con un VS Code simulado.
module.exports = ({ vscode, path, fs, os, CancelledOperation }) => {
  const { stripAnsi } = require('../runner');
  const KIND = { packageVsix: 'vsix', packageApk: 'apk' };
  const ARTIFACT = /https:\/\/expo\.dev\/artifacts\/eas\/[^\s)"'<>]+/;
  const BUILD_PAGE = /https:\/\/expo\.dev\/accounts\/[^\s)"'<>]+\/builds\/[\w-]+/;
  const VSIX = /Packaged:\s*(.+?\.vsix)/;

  return {
    // Ruta del SDK de Android cuando ANDROID_HOME no está definida (instalación estándar de Android Studio).
    async androidSdk() {
      const home = os.homedir();
      const candidates = [process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Android', 'Sdk'),
        path.join(home, 'Library', 'Android', 'sdk'), path.join(home, 'Android', 'Sdk')].filter(Boolean);
      for (const candidate of candidates) { try { await fs.access(candidate); return candidate; } catch { /* siguiente */ } }
      return undefined;
    },

    vsixPlan(info) {
      const dir = this.app.dir;
      const plan = { label: `${this.t('Empaquetar VSIX')} ${path.basename(dir)}`, cwd: dir, env: {}, kind: 'vsix' };
      if (info.script) Object.assign(plan, { command: info.manager || 'npm', args: ['run', info.script] });
      else Object.assign(plan, { command: 'npx', args: ['--yes', '@vscode/vsce', 'package', '--allow-missing-repository'] });
      return plan;
    },

    async apkPlan(info) {
      const dir = this.app.dir;
      const modes = [];
      if (info.easProfile) modes.push({ value: 'eas', label: this.t('EAS Build (en la nube)'), detail: `eas build --platform android --profile ${info.easProfile}` });
      if (info.local) modes.push({ value: 'local', label: this.t('Local (Gradle)'), detail: 'android/gradlew assembleRelease' });
      if (!modes.length) throw new Error(this.t('Para generar un APK agrega a eas.json un perfil con android.buildType «apk», o genera la carpeta android con «npx expo prebuild».'));
      const key = `apkMode:${this.project.toString()}`;
      let mode = modes[0].value;
      if (modes.length > 1) {
        const last = this.context.workspaceState.get(key);
        const items = [...modes].sort((a, b) => Number(b.value === last) - Number(a.value === last))
          .map(item => ({ ...item, description: item.value === last ? this.t('Último usado') : '' }));
        const chosen = await vscode.window.showQuickPick(items, { title: this.t('Generar APK'), placeHolder: this.t('Selecciona cómo generar el APK') });
        if (!chosen) return undefined;
        mode = chosen.value;
        await this.context.workspaceState.update(key, mode);
      }
      const label = `${this.t('Generar APK')} ${path.basename(dir)}`;
      if (mode === 'eas') {
        return { kind: 'apk', mode, label, cwd: dir, env: {}, command: process.platform === 'win32' ? 'eas.cmd' : 'eas',
          args: ['build', '--platform', 'android', '--profile', info.easProfile, '--non-interactive'] };
      }
      const android = path.join(dir, 'android');
      const env = {};
      if (!process.env.ANDROID_HOME && !process.env.ANDROID_SDK_ROOT) {
        const sdk = await this.androidSdk();
        if (sdk) env.ANDROID_HOME = sdk;
      }
      return { kind: 'apk', mode, label, cwd: android, env, args: ['assembleRelease', '--console=plain'],
        command: path.join(android, process.platform === 'win32' ? 'gradlew.bat' : 'gradlew'),
        file: path.join(android, 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk') };
    },

    // Ejecuta el comando de empaquetado en una terminal propia y espera su fin (Detener lo cancela).
    async runPackaging(plan) {
      const generation = this.generation;
      let finish;
      const done = new Promise(resolve => { finish = resolve; });
      const state = { name: plan.label, output: '', exitCode: undefined, proc: undefined, silent: true,
        collect: text => { state.output = (state.output + text).slice(-40000); }, onExit: code => finish(code) };
      const terminal = this.appTerminal({ command: plan.command, args: plan.args, cwd: plan.cwd, env: { ...this.terminalEnv(), ...plan.env }, detectUrl: false }, generation, state);
      await this.executeTask(plan.label, [], this.project, true, terminal, true);
      const code = await done;
      // Detener, cerrar la terminal o Ctrl+C cancelan; no son un fallo del empaquetado.
      if (generation !== this.generation || state.requested) throw new CancelledOperation();
      return { code, output: stripAnsi(state.output) };
    },

    async packageProject(action) {
      if (!(await this.ensureProject())) return;
      const info = this.app?.packaging;
      if (!info || info.kind !== KIND[action]) throw new Error(this.t('Este proyecto no se puede empaquetar con DotPilot.'));
      const plan = info.kind === 'vsix' ? this.vsixPlan(info) : await this.apkPlan(info);
      if (!plan) return;
      if (!(await vscode.workspace.saveAll(false))) throw new Error(this.t('No se pudieron guardar todos los archivos.'));
      this.result = this.t('Empaquetando… {0}', plan.label); this.resultError = false; this.render();
      const { code, output } = await this.runPackaging(plan);
      if (code !== 0) {
        const hints = [];
        if (code === 127 && plan.mode === 'eas') hints.push(this.t('Instala EAS CLI con «npm i -g eas-cli».'));
        if (plan.mode === 'eas' && /eas login|not logged in|Expo user account|authenticat/i.test(output)) hints.push(this.t('Inicia sesión con «eas login» en una terminal y vuelve a intentarlo.'));
        throw new Error([this.t('{0} terminó con errores (código {1}). Consulta Terminal y Problemas.', plan.label, code), ...hints].join(' '));
      }
      const artifact = await this.findArtifact(plan, output);
      this.result = artifact.file ? this.t('Paquete generado: {0}', artifact.file) : artifact.url ? this.t('APK generado: {0}', artifact.url) : this.t('El paquete se generó, pero DotPilot no pudo leer su ubicación. Revisa la terminal.');
      this.resultError = false;
      this.render();
      this.announcePackage(plan, artifact);
    },

    async findArtifact(plan, output) {
      if (plan.kind === 'vsix') {
        const match = VSIX.exec(output);
        const file = match && path.resolve(plan.cwd, match[1].trim());
        if (!file) return {};
        try { await fs.access(file); } catch { throw new Error(this.t('No se encontró el archivo generado: {0}', file)); }
        return { file };
      }
      if (plan.mode === 'eas') {
        const url = (ARTIFACT.exec(output) || BUILD_PAGE.exec(output))?.[0];
        return url ? { url } : {};
      }
      try { await fs.access(plan.file); } catch { throw new Error(this.t('No se encontró el archivo generado: {0}', plan.file)); }
      return { file: plan.file };
    },

    // Aviso con acciones; no bloquea la operación, el resultado ya quedó en el panel.
    announcePackage(plan, artifact) {
      const reveal = this.t('Mostrar en carpeta'), install = this.t('Instalar en VS Code'), open = this.t('Abrir descarga'), copy = this.t('Copiar enlace');
      const buttons = artifact.file ? [reveal, ...(plan.kind === 'vsix' ? [install] : [])] : artifact.url ? [open, copy] : [];
      const message = artifact.file ? this.t('Paquete generado: {0}', path.basename(artifact.file)) : artifact.url ? this.t('APK generado: {0}', artifact.url) : this.t('El paquete se generó, pero DotPilot no pudo leer su ubicación. Revisa la terminal.');
      void vscode.window.showInformationMessage(message, ...buttons).then(async choice => {
        if (choice === reveal) await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(artifact.file));
        else if (choice === install) await this.installVsix(artifact.file);
        else if (choice === open) await vscode.env.openExternal(vscode.Uri.parse(artifact.url));
        else if (choice === copy) { await vscode.env.clipboard.writeText(artifact.url); vscode.window.setStatusBarMessage('DotPilot: ' + this.t('Enlace copiado.'), 3000); }
      }).then(undefined, error => this.output.appendLine(error.message));
    },

    async installVsix(file) {
      await vscode.commands.executeCommand('workbench.extensions.installExtension', vscode.Uri.file(file));
      const reload = this.t('Recargar ventana');
      const choice = await vscode.window.showInformationMessage(this.t('Extensión instalada. Recarga la ventana para usarla.'), reload);
      if (choice === reload) await vscode.commands.executeCommand('workbench.action.reloadWindow');
    }
  };
};
