# Privacy policy / Política de privacidad

**DotPilot** · Last updated / Última actualización: 2026-10-22

## English

DotPilot is a VS Code extension to run, debug and build projects from one panel. **It does not collect, transmit, sell or share any data.** Everything happens on your machine.

**What DotPilot does not do**
- It has no telemetry, analytics, accounts or advertising, and it makes no network calls of its own.
- It never runs arbitrary commands: only the projects and profiles it detected in your workspace, started on your request, in a trusted workspace.

**Where the network can still be used (by the tools you start, not by DotPilot)**
- Your own applications use the network as they normally would.
- The optional packaging commands: `npx @vscode/vsce` may download `vsce`, and `eas build` talks to Expo's servers. They run only when you press the button or command.

**What DotPilot stores, only on your machine**
- Its settings (`dotpilot.*`) in VS Code's settings, and the list of companion APIs in VS Code's own workspace state, never in your repository.
- A temporary browser profile while a linked browser window is open (deleted afterwards). If you choose the persistent profile (`dotpilot.browserProfile`), that profile is kept between runs.
- With AI assistants enabled: `~/.dotpilot` (a copy of the MCP server and a discovery file with a random token, readable only by your user account). On Windows with Laragon, a console log in the temporary folder.
- It never edits your projects, `launch.json` or `tasks.json`. **Connect AI assistants** writes only the configuration files you choose: `.mcp.json` (Claude Code), `~/.codex/config.toml` (Codex) and `.gemini/settings.json` (Gemini).

**AI assistants (off by default)**
- Only you can turn them on, from your user settings, and actions that start work ask for your permission in VS Code unless you change that setting.
- The local bridge listens only on `127.0.0.1`, uses a random token that changes on every start and rejects requests that come from a web page.
- A connected assistant can read what the tools expose: the app's output and the Problems panel. What the assistant does with it is governed by that assistant's own provider and privacy policy, not by DotPilot.

**We do not sell or transfer data** to third parties or use it for purposes other than the extension's purpose. DotPilot is not directed at children and collects nothing from anyone.

**Changes and contact.** Changes will be published in this file with their date. Questions: open an issue at https://github.com/camiloruizx/dotpilot or visit https://acrocode.dev/. Security problems: see [SECURITY.md](SECURITY.md).

## Español

DotPilot es una extensión de VS Code para ejecutar, depurar y compilar proyectos desde un solo panel. **No recopila, envía, vende ni comparte ningún dato.** Todo ocurre en tu equipo.

**Lo que DotPilot no hace**
- No tiene telemetría, analítica, cuentas ni publicidad, y no hace llamadas de red propias.
- Nunca ejecuta comandos arbitrarios: solo los proyectos y perfiles que detectó en tu espacio de trabajo, iniciados a petición tuya y en un espacio de trabajo de confianza.

**Dónde puede usarse la red (por las herramientas que inicias, no por DotPilot)**
- Tus propias aplicaciones usan la red como lo harían normalmente.
- Los comandos opcionales de empaquetado: `npx @vscode/vsce` puede descargar `vsce` y `eas build` se comunica con los servidores de Expo. Solo se ejecutan cuando pulsas el botón o el comando.

**Qué guarda DotPilot, solo en tu equipo**
- Sus ajustes (`dotpilot.*`) en la configuración de VS Code, y la lista de APIs complementarias en el estado del espacio de trabajo de VS Code, nunca en tu repositorio.
- Un perfil temporal del navegador mientras hay una ventana vinculada abierta (se elimina después). Si eliges el perfil persistente (`dotpilot.browserProfile`), ese perfil se conserva entre ejecuciones.
- Con los asistentes de IA activados: `~/.dotpilot` (una copia del servidor MCP y un archivo de descubrimiento con un token aleatorio, legible solo por tu cuenta de usuario). En Windows con Laragon, un registro de consola en la carpeta temporal.
- Nunca edita tus proyectos, `launch.json` ni `tasks.json`. **Conectar asistentes de IA** escribe solo los archivos de configuración que eliges: `.mcp.json` (Claude Code), `~/.codex/config.toml` (Codex) y `.gemini/settings.json` (Gemini).

**Asistentes de IA (desactivados por defecto)**
- Solo tú puedes activarlos, desde tu configuración de usuario, y las acciones que inician trabajo piden tu permiso en VS Code salvo que cambies ese ajuste.
- El puente local escucha solo en `127.0.0.1`, usa un token aleatorio que cambia en cada inicio y rechaza las solicitudes que vienen de una página web.
- Un asistente conectado puede leer lo que exponen las herramientas: la salida de la aplicación y el panel de Problemas. Lo que haga con ello lo rige el proveedor de ese asistente y su política de privacidad, no DotPilot.

**No vendemos ni transferimos datos** a terceros ni los usamos para fines distintos del propósito de la extensión. DotPilot no está dirigido a menores y no recopila nada de nadie.

**Cambios y contacto.** Los cambios se publicarán en este archivo con su fecha. Dudas: abre un issue en https://github.com/camiloruizx/dotpilot o visita https://acrocode.dev/. Problemas de seguridad: consulta [SECURITY.md](SECURITY.md).
