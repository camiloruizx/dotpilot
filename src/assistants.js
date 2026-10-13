'use strict';
// Asistentes de IA con los que DotPilot sabe conectarse, cómo detectarlos y qué configuración
// necesitan para usar el servidor MCP. No depende de VS Code (recibe `getExtension`).
const path = require('node:path');
const os = require('node:os');
const { parseJsonc } = require('./core');

const SERVER_NAME = 'dotpilot';

const ASSISTANTS = [
  { id: 'claude', name: 'Claude Code', extensions: ['anthropic.claude-code'], kind: 'mcp-json', file: root => path.join(root, '.mcp.json'), scope: 'project' },
  { id: 'codex', name: 'Codex (ChatGPT)', extensions: ['openai.chatgpt', 'openai.codex'], kind: 'toml', file: () => path.join(os.homedir(), '.codex', 'config.toml'), scope: 'user' },
  { id: 'gemini', name: 'Gemini', extensions: ['google.geminicodeassist', 'google.gemini-cli-vscode-ide-companion'], kind: 'mcp-json', file: root => path.join(root, '.gemini', 'settings.json'), scope: 'project' },
  // Copilot usa las herramientas de modelo de lenguaje de VS Code: no necesita archivo.
  { id: 'copilot', name: 'GitHub Copilot', extensions: ['github.copilot-chat', 'github.copilot'], kind: 'native', scope: 'editor' }
];

function installedAssistants(getExtension) {
  return ASSISTANTS.map(assistant => ({ ...assistant, installed: assistant.extensions.some(id => !!getExtension(id)) }));
}

function serverEntry(serverScript) {
  return { command: 'node', args: [serverScript] };
}

// Mezcla `mcpServers.dotpilot` en un JSON existente sin tocar el resto. Devuelve texto o lanza si el JSON no es válido.
function mergeJsonConfig(existing, serverScript) {
  let data = {};
  if (existing && existing.trim()) {
    data = parseJsonc(existing);
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('The file is not a JSON object.');
  }
  if (data.mcpServers !== undefined && (typeof data.mcpServers !== 'object' || data.mcpServers === null || Array.isArray(data.mcpServers))) {
    throw new Error('"mcpServers" is not an object.');
  }
  const next = { ...data, mcpServers: { ...(data.mcpServers || {}), [SERVER_NAME]: serverEntry(serverScript) } };
  return JSON.stringify(next, null, 2) + '\n';
}

// Añade `[mcp_servers.dotpilot]` a config.toml si no existe. Devuelve undefined si ya estaba.
function mergeTomlConfig(existing, serverScript) {
  const text = existing || '';
  if (/^\s*\[mcp_servers\.(?:"dotpilot"|dotpilot)\]/m.test(text)) return undefined;
  const separator = text && !text.endsWith('\n') ? '\n\n' : text ? '\n' : '';
  const entry = serverEntry(serverScript);
  return `${text}${separator}[mcp_servers.${SERVER_NAME}]\ncommand = ${JSON.stringify(entry.command)}\nargs = [${entry.args.map(arg => JSON.stringify(arg)).join(', ')}]\n`;
}

module.exports = { SERVER_NAME, ASSISTANTS, installedAssistants, serverEntry, mergeJsonConfig, mergeTomlConfig };
