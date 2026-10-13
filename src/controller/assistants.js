'use strict';
// Asistentes de IA: API para agentes, puente local y aviso de idioma.
// Son métodos del Controller: extension.js los mezcla en su prototipo. Reciben sus dependencias (incluido
// `vscode`) para que las pruebas unitarias puedan ejecutarlos con un VS Code simulado.
module.exports = ({ vscode, portIsOpen, browserUrl, localEndpoint, languageMismatch }) => ({
  // Los menús y la paleta de comandos los traduce VS Code según su propio idioma. Si el ajuste de DotPilot
  // es otro, se avisa una vez y se ofrece cambiar el idioma de VS Code.
  async hintLanguage() {
    const preference = vscode.workspace.getConfiguration('dotpilot').get('language', 'auto');
    if (!languageMismatch(preference, vscode.env.language)) return;
    const key = `languageHint:${preference}:${vscode.env.language}`;
    if (this.context.globalState.get(key)) return;
    await this.context.globalState.update(key, true);
    const change = this.t('Cambiar idioma de VS Code');
    const choice = await vscode.window.showInformationMessage(
      this.t('El panel y los mensajes de DotPilot usan {0}, pero los menús y la paleta de comandos siguen el idioma de VS Code ({1}).', preference === 'es' ? 'español' : 'English', vscode.env.language), change);
    if (choice === change) await vscode.commands.executeCommand('workbench.action.configureLocale');
  },

  agentApi() {
    if (!this.agent) {
      const { AgentApi } = require('../agent');
      this.agent = new AgentApi(this, vscode, { portIsOpen, localEndpoint, browserUrl });
    }
    return this.agent;
  },

  // Inicia o detiene el puente local con los asistentes de IA según el ajuste y la confianza del espacio.
  async syncBridge() {
    const wanted = vscode.workspace.getConfiguration('dotpilot').get('assistantsEnabled', false)
      && vscode.workspace.isTrusted && !!vscode.workspace.workspaceFolders?.length;
    if (!wanted && this.bridge) {
      const bridge = this.bridge;
      this.bridge = undefined;
      await bridge.dispose();
      this.render();
    } else if (wanted && !this.bridge) {
      const { Bridge } = require('../bridge');
      const api = this.agentApi();
      const bridge = new Bridge({
        handler: (name, input, origin) => api.call(name, input, origin),
        folders: vscode.workspace.workspaceFolders.map(folder => folder.uri.fsPath),
        version: this.context.extension?.packageJSON?.version || ''
      });
      this.bridge = bridge;
      try {
        await bridge.start();
        api.installServer();
        this.render();
      } catch (error) {
        this.bridge = undefined;
        this.output.appendLine(error.message);
      }
    }
  }
});
