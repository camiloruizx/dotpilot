'use strict';
// Servidor MCP (stdio) de DotPilot. Lo inician los asistentes de IA (Claude Code, Codex, Gemini…)
// y reenvía cada llamada al puente local de DotPilot que corre dentro de VS Code.
// Sin dependencias: JSON-RPC por líneas, según la especificación de MCP.
const path = require('node:path');
const { TOOLS } = require('./agent-tools');
const { findBridge, callBridge } = require('./bridge');

const SUPPORTED = ['2025-06-18', '2025-03-26', '2024-11-05'];
const SERVER = { name: 'dotpilot', version: process.env.DOTPILOT_VERSION || '0.9.0' };
let clientName = 'MCP client';

function send(message) { process.stdout.write(JSON.stringify(message) + '\n'); }
function reply(id, result) { send({ jsonrpc: '2.0', id, result }); }
function fail(id, code, message) { send({ jsonrpc: '2.0', id, error: { code, message } }); }
function text(value, isError = false) {
  return { content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }], ...(isError ? { isError: true } : {}) };
}

function toolList() {
  return TOOLS.map(tool => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
    annotations: { title: tool.title, readOnlyHint: !tool.mutating, destructiveHint: false, openWorldHint: false }
  }));
}

async function callTool(name, args) {
  if (!TOOLS.some(tool => tool.name === name)) return text(`Unknown tool: ${name}`, true);
  const cwd = process.env.DOTPILOT_WORKSPACE || process.cwd();
  const found = findBridge(path.resolve(cwd));
  if (found.error === 'none') {
    return text('DotPilot is not running. Open this folder in VS Code with the DotPilot extension and turn on "AI assistants" (command: DotPilot: Connect AI assistants).', true);
  }
  if (found.error === 'ambiguous') {
    return text(`Several VS Code windows are running DotPilot and none has this folder open (${cwd}). Open it in VS Code, or set DOTPILOT_WORKSPACE to one of: ${found.folders.join(', ')}`, true);
  }
  try {
    const { status, body } = await callBridge(found.bridge, name, args || {}, clientName);
    if (status === 401 || status === 403) return text('DotPilot refused the connection. Reload the VS Code window and try again.', true);
    return text(body, body.ok === false || status >= 400);
  } catch (error) {
    return text(`Could not reach DotPilot: ${error.message}`, true);
  }
}

async function handle(message) {
  const { id, method, params } = message;
  const isRequest = id !== undefined && id !== null;
  if (method === 'initialize') {
    clientName = String(params?.clientInfo?.name || clientName).slice(0, 60);
    const requested = params?.protocolVersion;
    return reply(id, { protocolVersion: SUPPORTED.includes(requested) ? requested : SUPPORTED[0], capabilities: { tools: { listChanged: false } }, serverInfo: SERVER });
  }
  if (method === 'ping') return isRequest && reply(id, {});
  if (method === 'tools/list') return reply(id, { tools: toolList() });
  if (method === 'tools/call') return reply(id, await callTool(params?.name, params?.arguments));
  if (!isRequest) return undefined; // notificaciones (initialized, cancelled…)
  return fail(id, -32601, `Method not found: ${method}`);
}

function main() {
  let buffer = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => {
    buffer += chunk;
    let index;
    while ((index = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      if (!line) continue;
      let message;
      try { message = JSON.parse(line); } catch { fail(null, -32700, 'Parse error'); continue; }
      handle(message).catch(error => { if (message.id !== undefined) fail(message.id, -32603, error.message); });
    }
  });
  process.stdin.on('end', () => process.exit(0));
}

if (require.main === module) main();
module.exports = { toolList, handle };
