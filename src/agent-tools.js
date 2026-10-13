'use strict';
// Herramientas que DotPilot ofrece a los asistentes de IA. Una sola definición alimenta:
//  - las herramientas de modelo de lenguaje de VS Code (Copilot en modo agente),
//  - el servidor MCP local (Claude Code, Codex, Gemini CLI y otros),
//  - la prueba que mantiene sincronizado package.json.
// No depende de VS Code: también la carga el servidor MCP, que corre fuera del editor.

const BUILD_ACTIONS = ['build', 'rebuild', 'clean', 'restore', 'test', 'analyze'];
const none = { type: 'object', properties: {}, additionalProperties: false };
const waitSeconds = { type: 'integer', minimum: 0, maximum: 120, description: 'Seconds to wait for the server to answer before returning. Default 30. Use 0 to return immediately.' };

// title / userDescription están en español, como el resto de textos de la extensión (se traducen con i18n).
// description es para el modelo y va en inglés.
const TOOLS = [
  {
    name: 'dotpilot_list_projects', title: 'Listar proyectos', icon: '$(list-tree)', mutating: false,
    userDescription: 'Lista los proyectos ejecutables del espacio de trabajo y sus perfiles.',
    description: 'List the runnable projects DotPilot found in the workspace (.NET, Node.js, PHP/Laravel, Python, Docker Compose), with the launch profiles of each and which project and profile are currently selected. Call this first to learn the valid project ids and profile names.',
    inputSchema: none
  },
  {
    name: 'dotpilot_get_status', title: 'Ver estado', icon: '$(pulse)', mutating: false,
    userDescription: 'Muestra si hay algo en ejecución, la URL del servidor y el resultado de la última operación.',
    description: 'Get what DotPilot is doing now: idle, busy, running, hot-reload, debugging or paused; the selected project and profile; the server URL when known; and the result of the last operation, including errors.',
    inputSchema: none
  },
  {
    name: 'dotpilot_select_project', title: 'Seleccionar proyecto', icon: '$(project)', mutating: false,
    userDescription: 'Elige el proyecto que DotPilot ejecuta.',
    description: 'Select the project DotPilot will run. `project` is an id, name or path from dotpilot_list_projects. Starts nothing. Fails while an app is running: stop it first.',
    inputSchema: { type: 'object', properties: { project: { type: 'string', description: 'Project id, name or path.' } }, required: ['project'], additionalProperties: false }
  },
  {
    name: 'dotpilot_select_profile', title: 'Seleccionar perfil', icon: '$(settings-gear)', mutating: false,
    userDescription: 'Elige el perfil de ejecución (perfil .NET, script npm, servidor o servicio de Compose).',
    description: 'Select the launch profile of the selected project: a .NET launch profile (or "none"), an npm script, a PHP/Python server or a Docker Compose service. Valid names come from dotpilot_list_projects. Fails while an app is running.',
    inputSchema: { type: 'object', properties: { profile: { type: 'string', description: 'Profile name.' } }, required: ['profile'], additionalProperties: false }
  },
  {
    name: 'dotpilot_run', title: 'Ejecutar proyecto', icon: '$(play)', mutating: true,
    userDescription: 'Ejecuta el proyecto seleccionado sin depurar.',
    description: 'Run the selected project without debugging. For web servers it waits until the server answers (up to wait_seconds) and returns its URL. The app keeps running until dotpilot_stop is called. Opens the browser when the profile and settings ask for it.',
    inputSchema: { type: 'object', properties: { wait_seconds: waitSeconds }, additionalProperties: false }
  },
  {
    name: 'dotpilot_debug', title: 'Depurar proyecto .NET', icon: '$(debug-alt)', mutating: true,
    userDescription: 'Compila e inicia el proyecto .NET con el depurador de C#.',
    description: 'Build and start the selected .NET project under the C# debugger (requires the Microsoft C# extension). Breakpoints set in the editor apply. .NET projects only.',
    inputSchema: { type: 'object', properties: { wait_seconds: waitSeconds }, additionalProperties: false }
  },
  {
    name: 'dotpilot_hot_reload', title: 'Ejecutar con Hot Reload', icon: '$(zap)', mutating: true,
    userDescription: 'Ejecuta el proyecto .NET con dotnet watch.',
    description: 'Run the selected .NET project with `dotnet watch` so code changes are applied on save. .NET projects only.',
    inputSchema: { type: 'object', properties: { wait_seconds: waitSeconds }, additionalProperties: false }
  },
  {
    name: 'dotpilot_stop', title: 'Detener', icon: '$(debug-stop)', mutating: false,
    userDescription: 'Detiene la ejecución o depuración iniciada por DotPilot.',
    description: 'Stop the run, hot reload, debug session or build started by DotPilot, together with its child processes and linked browser. Docker Compose projects run `docker compose down`.',
    inputSchema: none
  },
  {
    name: 'dotpilot_restart', title: 'Reiniciar', icon: '$(debug-restart)', mutating: true,
    userDescription: 'Detiene y vuelve a iniciar la ejecución actual en el mismo modo.',
    description: 'Stop the current run and start it again in the same mode. Only works while something started by DotPilot is running.',
    inputSchema: { type: 'object', properties: { wait_seconds: waitSeconds }, additionalProperties: false }
  },
  {
    name: 'dotpilot_build', title: 'Compilar o probar (.NET)', icon: '$(tools)', mutating: true,
    userDescription: 'Compila, limpia, restaura, prueba o analiza el proyecto o solución .NET.',
    description: 'Run a build step on the selected .NET project or solution and wait for it to finish: build, rebuild, clean, restore (NuGet), test or analyze. Returns success or failure plus the compiler errors from the Problems panel. .NET only.',
    inputSchema: { type: 'object', properties: { action: { type: 'string', enum: BUILD_ACTIONS, description: 'Build step. Default build.' } }, additionalProperties: false }
  },
  {
    name: 'dotpilot_open_browser', title: 'Abrir en el navegador', icon: '$(browser)', mutating: true,
    userDescription: 'Abre la aplicación en el navegador seleccionado.',
    description: 'Open the running app (or the selected profile URL) in the browser chosen in DotPilot.',
    inputSchema: none
  },
  {
    name: 'dotpilot_get_output', title: 'Ver salida', icon: '$(output)', mutating: false,
    userDescription: 'Devuelve las últimas líneas de salida de la aplicación iniciada con Ejecutar o Hot Reload.',
    description: 'Return the most recent output lines of the app DotPilot started with Run or Hot Reload, for every project type: server logs, unhandled exceptions with their stack traces, build errors and the URL it listens on. A debug session writes to the VS Code Debug Console instead and is not available here. Use dotpilot_get_problems for structured compiler errors.',
    inputSchema: { type: 'object', properties: { lines: { type: 'integer', minimum: 1, maximum: 500, description: 'How many trailing lines to return. Default 80.' } }, additionalProperties: false }
  },
  {
    name: 'dotpilot_get_problems', title: 'Ver problemas', icon: '$(warning)', mutating: false,
    userDescription: 'Devuelve los errores y advertencias del panel Problemas de VS Code.',
    description: 'Return the errors (and optionally warnings) currently listed in the VS Code Problems panel for files in the workspace: file, line, message. Useful after a build.',
    inputSchema: { type: 'object', properties: { include_warnings: { type: 'boolean', description: 'Include warnings. Default false.' } }, additionalProperties: false }
  }
];

const byName = new Map(TOOLS.map(tool => [tool.name, tool]));

// Comprueba la entrada contra el esquema (solo lo que usan estas herramientas) y rellena valores predeterminados.
function validateInput(tool, input) {
  const value = input === undefined || input === null ? {} : input;
  if (typeof value !== 'object' || Array.isArray(value)) throw new TypeError('The input must be an object.');
  const schema = tool.inputSchema;
  for (const key of Object.keys(value)) {
    if (!Object.hasOwn(schema.properties, key)) throw new TypeError(`Unknown parameter "${key}".`);
  }
  for (const key of schema.required || []) {
    if (typeof value[key] !== 'string' || !value[key].trim()) throw new TypeError(`Parameter "${key}" is required.`);
  }
  for (const [key, spec] of Object.entries(schema.properties)) {
    const item = value[key];
    if (item === undefined) continue;
    if (spec.type === 'string' && (typeof item !== 'string' || item.length > 1000)) throw new TypeError(`Parameter "${key}" must be a string.`);
    if (spec.enum && !spec.enum.includes(item)) throw new TypeError(`Parameter "${key}" must be one of: ${spec.enum.join(', ')}.`);
    if (spec.type === 'integer' && (!Number.isInteger(item) || item < spec.minimum || item > spec.maximum)) {
      throw new TypeError(`Parameter "${key}" must be an integer from ${spec.minimum} to ${spec.maximum}.`);
    }
    if (spec.type === 'boolean' && typeof item !== 'boolean') throw new TypeError(`Parameter "${key}" must be true or false.`);
  }
  return value;
}

module.exports = { TOOLS, byName, BUILD_ACTIONS, validateInput };
