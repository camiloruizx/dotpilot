# DotPilot — Changes / Cambios

## 1.0.0

First Marketplace release (versions before 0.9.0 were local builds). It adds companion APIs and packaging on top of 0.9.0. / Primera versión en el Marketplace (las anteriores a 0.9.0 fueron compilaciones locales). Agrega APIs complementarias y empaquetado sobre 0.9.0.

- The DotPilot panel has its own icon in the Activity Bar instead of living inside the Explorer. / El panel de DotPilot tiene su propio icono en la barra de actividad en lugar de estar dentro del Explorador.
- Companion APIs for .NET projects: choose one or more API projects (from any folder or solution) that DotPilot starts before your project, waiting until each one listens, and stops together with it. If your `appsettings*.json` points to a `localhost` address that is not the project's own, DotPilot asks once (add the detected API, choose its project, or don't ask again). An API that is already listening is reused. With **Debug**, the project is debugged and the API runs without the debugger. New **Companion APIs** field in the panel and command **DotPilot: Manage companion APIs**; assistants see them in `dotpilot_get_status` (`companionApis`). / APIs complementarias para proyectos .NET: elige una o varias APIs (de cualquier carpeta o solución) que DotPilot inicia antes que tu proyecto, esperando a que cada una escuche, y detiene junto con él. Si tu `appsettings*.json` apunta a una dirección `localhost` que no es del propio proyecto, DotPilot pregunta una vez (agregar la API detectada, indicar su proyecto o no preguntar más). Una API que ya está escuchando se reutiliza. Con **Depurar**, el proyecto se depura y la API corre sin depurador. Nuevo campo **APIs complementarias** en el panel y comando **DotPilot: Administrar APIs complementarias**; los asistentes las ven en `dotpilot_get_status` (`companionApis`).
- Companion APIs open their browser when ready: by default the profile's `launchBrowser`/`launchUrl` is followed and, if the API uses Swagger (Swashbuckle or NSwag), `/swagger` opens even when the profile does not ask for it. It opens in the browser chosen in DotPilot as an independent tab (closing it stops nothing), is skipped when the API was already running, and can be switched off per API in **Companion APIs**. / Las APIs complementarias abren su navegador al estar listas: por omisión se sigue `launchBrowser`/`launchUrl` del perfil y, si la API usa Swagger (Swashbuckle o NSwag), se abre `/swagger` aunque el perfil no lo pida. Se abre en el navegador elegido en DotPilot como una pestaña independiente (cerrarla no detiene nada), no se abre si la API ya estaba en ejecución y se puede desactivar por API en **APIs complementarias**.
- Packaging from DotPilot: **Package VSIX** for VS Code extensions (`engines.vscode`; runs the project's `package` script or `vsce`) and **Build APK** for Expo projects (EAS Build in the cloud with the `eas.json` profile that builds an APK, or local Gradle `assembleRelease`; asks which one when both are possible). The result is shown in the panel, with **Reveal in folder** / **Install in VS Code** for a VSIX and **Open download** / **Copy link** for an EAS APK. VS Code extensions without start scripts now appear in the project picker. Commands: **DotPilot: Package VS Code extension (VSIX)** and **DotPilot: Build Android APK (Expo)**. / Empaquetado desde DotPilot: **Empaquetar VSIX** para extensiones de VS Code (`engines.vscode`; ejecuta el script `package` del proyecto o `vsce`) y **Generar APK** para proyectos Expo (EAS Build en la nube con el perfil de `eas.json` que genera APK, o `assembleRelease` de Gradle local; pregunta cuál cuando ambas son posibles). El resultado se muestra en el panel, con **Mostrar en carpeta** / **Instalar en VS Code** para un VSIX y **Abrir descarga** / **Copiar enlace** para un APK de EAS. Las extensiones de VS Code sin scripts de inicio ahora aparecen en el selector de proyecto. Comandos: **DotPilot: Empaquetar extensión de VS Code (VSIX)** y **DotPilot: Generar APK de Android (Expo)**.
- The `package` script writes the VSIX next to the project folder with its own name and version, so bumping the version no longer requires editing the script. / El script `package` deja el VSIX junto a la carpeta del proyecto con su propio nombre y versión, así que subir la versión ya no obliga a editar el script.

## 0.9.0

- Build errors from `dotnet run` are published to the Problems panel by DotPilot itself (parsing MSBuild's error lines), so they appear on every VS Code version; the problem matcher did not apply to a custom terminal's output on VS Code 1.85. / Los errores de compilación de `dotnet run` se publican en el panel Problemas por DotPilot mismo (interpretando las líneas de error de MSBuild), así que aparecen en cualquier versión de VS Code; el problem matcher no se aplicaba a la salida de una terminal propia en VS Code 1.85.
- Internal: `extension.js` goes from 1,080 to about 380 lines; the rest of the Controller now lives in `src/controller/` by responsibility. No behavior change. / Interno: `extension.js` pasa de 1.080 a unas 380 líneas; el resto del Controller vive en `src/controller/` por responsabilidad. Sin cambios de comportamiento.
- Apache (Laragon) profile for PHP projects served by Laragon on Windows: runs Laragon's own Apache with its own configuration (virtual hosts, `.htaccess`, modules), opens the site's virtual host URL and streams Apache's error log, including PHP errors. An Apache that is already running is reused and left running on Stop. MySQL is only checked and warned about. New setting `dotpilot.laragonPath`. / Perfil Apache (Laragon) para proyectos PHP servidos por Laragon en Windows: ejecuta el Apache de Laragon con su propia configuración (virtual hosts, `.htaccess`, módulos), abre la URL del virtual host del sitio y muestra el registro de errores de Apache, incluidos los de PHP. Un Apache ya en ejecución se reutiliza y no se cierra al detener. MySQL solo se comprueba y se avisa. Nuevo ajuste `dotpilot.laragonPath`.
- .NET Run and Hot Reload now use the same runner as Node.js, PHP, Python and Docker: DotPilot captures the app's output, so assistants can read server logs and runtime exceptions (`dotpilot_get_output`) and the listening URL comes from Kestrel's own "Now listening on" line. The MSBuild problem matcher still fills the Problems panel. Debugging keeps using VS Code's Debug Console. / Ejecutar y Hot Reload de .NET usan ahora el mismo ejecutor que Node.js, PHP, Python y Docker: DotPilot captura la salida de la aplicación, así que los asistentes pueden leer el registro del servidor y las excepciones en ejecución (`dotpilot_get_output`) y la URL sale de la línea «Now listening on» de Kestrel. El problem matcher de MSBuild sigue llenando el panel Problemas. Depurar sigue usando la Consola de depuración de VS Code.
- Runner: executables (`dotnet`, `php`, `python`, `docker`) are launched directly, so project paths with spaces, `&` or `%` work; only `.cmd` shims (npm, yarn, pnpm) go through the shell. Stop now waits until the process has really exited, so the port is free when it returns. `terminal.integrated.env.*` variables are applied to the app. / Ejecutor: los ejecutables (`dotnet`, `php`, `python`, `docker`) se lanzan directamente, así que rutas con espacios, `&` o `%` funcionan; solo los scripts `.cmd` (npm, yarn, pnpm) pasan por el intérprete. Detener espera ahora a que el proceso haya salido de verdad, así que el puerto queda libre al volver. Las variables de `terminal.integrated.env.*` se aplican a la aplicación.
- Language: menus, command titles and settings use a single `package.nls` set and follow VS Code's display language; the panel and messages follow the DotPilot language setting. When the two differ, DotPilot tells you once and offers to change VS Code's language. / Idioma: menús, títulos de comandos y ajustes usan un solo juego de `package.nls` y siguen el idioma de pantalla de VS Code; el panel y los mensajes siguen el ajuste de idioma de DotPilot. Cuando difieren, DotPilot avisa una vez y ofrece cambiar el idioma de VS Code.
- First public release under the extension id `camiloruizx.dotpilot` and the `dotpilot.*` prefix for commands, settings and views. Earlier numbers (0.1–0.8) were local development builds. / Primera versión pública con el id de extensión `camiloruizx.dotpilot` y el prefijo `dotpilot.*` en comandos, ajustes y vistas. Los números anteriores (0.1–0.8) fueron compilaciones locales de desarrollo.

## 0.8.0

- Browser: changing the browser while the app runs reopens the linked window in the chosen browser (the app keeps running), and **Open in browser** with nothing running launches the chosen Chrome or Edge instead of the system default. / Navegador: cambiar el navegador con la aplicación en ejecución reabre la ventana vinculada en el elegido (la aplicación sigue), y **Navegador** sin ejecución abre Chrome o Edge según lo elegido en vez del predeterminado del sistema.
- Polish and efficiency: a single project scan at a time (bursts of file changes no longer pile up), .NET and other project searches run in parallel, large workspaces are bounded to the 300 shallowest folders, and `index.php` only counts at the workspace root, next to `composer.json` or in a direct subfolder, so WordPress-style trees stay quiet. / Pulido y eficiencia: una sola búsqueda de proyectos a la vez (las ráfagas de cambios ya no se acumulan), las búsquedas .NET y de otros tipos van en paralelo, los espacios grandes se limitan a las 300 carpetas menos profundas, y `index.php` solo cuenta en la raíz, junto a `composer.json` o en una subcarpeta directa, para que árboles como WordPress no hagan ruido.
- A server that prints a lot no longer costs CPU for URL detection after the first 256 KB; copying the assistant server files is skipped when unchanged. / Un servidor que imprime mucho ya no gasta CPU en detectar la URL después de los primeros 256 KB; la copia de los archivos del servidor para asistentes se omite si no cambiaron.
- Panel: the server address is a link that opens the browser, an "AI" badge shows when assistants are connected, the status shows "Looking for projects…" during the first scan, and the version badge follows package.json. / Panel: la dirección del servidor es un enlace que abre el navegador, una insignia «IA» indica que hay asistentes conectados, el estado muestra «Buscando proyectos…» durante la primera búsqueda y la versión se toma de package.json.
- Fixes: closing the terminal or pressing Ctrl+C is no longer reported as an application error; a command that cannot be quoted safely is reported instead of breaking the extension host; closing the assistant bridge while it starts leaves no open port; the running app is stopped when the extension unloads. / Correcciones: cerrar la terminal o pulsar Ctrl+C ya no se informa como error de la aplicación; un comando que no se puede escapar con seguridad se informa en vez de romper el host de extensiones; cerrar el puente de asistentes mientras arranca no deja un puerto abierto; la aplicación en ejecución se detiene al descargar la extensión.
- AI assistants can use DotPilot: Claude Code, Codex (ChatGPT), Gemini and GitHub Copilot can list projects, select a profile, run, stop, restart, build, open the browser and read output and problems. / Los asistentes de IA pueden usar DotPilot: Claude Code, Codex (ChatGPT), Gemini y GitHub Copilot pueden listar proyectos, elegir un perfil, ejecutar, detener, reiniciar, compilar, abrir el navegador y leer salida y problemas.
- **DotPilot: Connect AI assistants** detects the assistants installed in the editor and configures them: `.mcp.json` (Claude Code), `~/.codex/config.toml` (Codex), `.gemini/settings.json` (Gemini). Copilot uses VS Code language model tools and needs no file. / **DotPilot: Conectar asistentes de IA** detecta los asistentes instalados y los configura: `.mcp.json` (Claude Code), `~/.codex/config.toml` (Codex), `.gemini/settings.json` (Gemini). Copilot usa las herramientas de modelo de lenguaje de VS Code y no necesita archivo.
- One local MCP server (stdio, no dependencies) and a bridge that listens only on 127.0.0.1 with a random token. Off by default; the browser, other websites and repositories cannot enable it. / Un servidor MCP local (stdio, sin dependencias) y un puente que solo escucha en 127.0.0.1 con un token aleatorio. Desactivado por defecto; ni el navegador, ni sitios web ni un repositorio pueden activarlo.
- Actions that start work (run, debug, restart, build, open browser) ask for permission in VS Code, with an option to allow the session. Selecting, reading status, output, problems and stopping do not ask. / Las acciones que inician trabajo (ejecutar, depurar, reiniciar, compilar, abrir el navegador) piden permiso en VS Code, con opción de permitir la sesión. Elegir, leer estado, salida, problemas y detener no preguntan.
- New settings `dotpilot.assistantsEnabled` and `dotpilot.assistantsPermission` (user settings only) and an AI assistants section in the panel. / Nuevos ajustes `dotpilot.assistantsEnabled` y `dotpilot.assistantsPermission` (solo del usuario) y una sección de asistentes de IA en el panel.

## 0.7.0

- Automatic project type detection: .NET, Node.js (Vite, React, Vue, Angular, Next.js, Nuxt…), PHP/Laravel, Python (Django, FastAPI, Flask) and Docker Compose appear in the project picker, each with its detected type. / Detección automática del tipo de proyecto: .NET, Node.js (Vite, React, Vue, Angular, Next.js, Nuxt…), PHP/Laravel, Python (Django, FastAPI, Flask) y Docker Compose aparecen en el selector de proyecto, con su tipo detectado.
- Run, Stop and Restart for those projects in a DotPilot terminal; stopping ends the whole process tree, and Docker Compose runs `down`. / Ejecutar, Detener y Reiniciar para esos proyectos en una terminal de DotPilot; detener cierra todo el árbol de procesos y Docker Compose ejecuta `down`.
- Server URL and port detection: the address comes from the server's own output (so a moved port is followed), falling back to package scripts, Vite config, `.env`, framework defaults and Compose published ports. The address is shown in the panel. / Detección de URL y puerto: la dirección sale de la salida del propio servidor (se sigue un puerto cambiado) y, si no, de scripts, configuración de Vite, `.env`, valores del framework y puertos publicados de Compose. El panel la muestra.
- Launch profiles for non-.NET projects: package.json scripts (`dev`, `start`, `serve`), `artisan serve` or `php -S`, the Python dev server, and Compose services. The package manager (npm, pnpm, Yarn, Bun) and Python virtual environments are detected. / Perfiles para proyectos que no son .NET: scripts de package.json, `artisan serve` o `php -S`, el servidor de desarrollo de Python y servicios de Compose. Se detectan el gestor de paquetes y los entornos virtuales de Python.
- The browser selection, auto-open and linked-window stop behavior work for every project type. / La selección de navegador, la apertura automática y el cierre vinculado funcionan con todos los tipos de proyecto.
- New settings `dotpilot.pythonPath` and `dotpilot.phpPath`. .NET-only actions (debug, Hot Reload, build, tests) are disabled for other project types. / Nuevos ajustes `dotpilot.pythonPath` y `dotpilot.phpPath`. Las acciones solo de .NET (depurar, Hot Reload, compilar, pruebas) se desactivan para los otros tipos.
- Debugging is still .NET only in this version. / La depuración sigue siendo solo para .NET en esta versión.

## 0.6.1

- Refined two-tone blue icon with balanced geometry and subtly rounded corners. / Ícono azul de dos tonos con geometría equilibrada y esquinas suavizadas.
- Shared vector artwork for the extension tile, panel and toolbar; smaller PNG asset. / Mismo símbolo vectorial en la ficha, el panel y la barra; PNG más pequeño.
- Editor toolbar order: the DotPilot menu comes first, then Run without debugging. / Orden de la barra del editor: primero el menú de DotPilot y después Ejecutar sin depurar.

## 0.6.0

- Web browser picker beside the launch profile and a toolbar submenu with selection marks. / Selector de navegador junto al perfil y submenú con marcas de selección.
- Per-project Edge, Chrome or system-default choice, with workspace fallback. / Elección de Edge, Chrome o predeterminado por proyecto, con opción de volver al ajuste del espacio de trabajo.
- Lazy panel and status bar loading, deduplicated updates and a smaller distribution icon. / Carga del panel y barra inferior bajo demanda, actualizaciones sin duplicados e ícono de distribución reducido.
- Handle Chrome announcing its page before the root session. / Seguimiento correcto cuando Chrome anuncia la pestaña antes que la sesión principal.

## 0.5.0

- English and Spanish panel, messages, native commands and setting descriptions. / Panel, mensajes, comandos y descripciones de ajustes en inglés y español.
- A single branded toolbar menu groups DotPilot actions. / Menú propio con el ícono de DotPilot, separado de las otras extensiones.
- Redesigned Run and Settings tabs, project cards and collapsible tools. / Panel renovado con pestañas Ejecución y Ajustes, secciones de proyecto y herramientas plegables.
- Persistent language, appearance and browser settings; schema prepared for more sections. / Ajustes persistentes de idioma, apariencia y navegador, con un esquema preparado para añadir secciones.
- Keyboard navigation, responsive layout, theme colors and preserved panel state. / Navegación por teclado, diseño adaptable, colores del tema y estado del panel conservado.

## 0.4.0

- Navegador vinculado: cerrar la ventana de Edge o Chrome detiene la ejecución, Hot Reload o depuración de DotPilot. Detener y reiniciar gestionan también esa ventana.
- Ajuste de navegador: Edge por defecto, Chrome o navegador externo sin vínculo de cierre.
- Mostrar/Ocultar panel según su visibilidad real, también en la paleta de comandos.
- Publicador local `camiloruizx`. Desinstala la versión anterior de `local-dotnet-tools` antes de instalar esta versión para evitar duplicados; vuelve a seleccionar proyecto y perfil.

## 0.3.0

- Controles en la barra superior del editor: proyecto/perfil, ejecutar, depurar, pausar/continuar, detener, reiniciar y compilar.
- Los botones se adaptan al estado de ejecución y pueden ocultarse en los ajustes.
- Nuevo ícono de DotPilot, plano y azul, en la ficha de la extensión y el panel.
- Créditos con enlace al GitHub camiloruizx.
- La barra inferior queda oculta por defecto y puede activarse en los ajustes.

## 0.2.1

- Nuevo nombre: DotPilot.
- Créditos para Camilo Ruiz y acrocode.dev en el panel, metadatos, documentación y licencia.
- Actualización compatible con las instalaciones anteriores de .NET Controls.

## 0.2.0

- Hot Reload con `dotnet watch`, restauración de paquetes y ejecución de pruebas del proyecto o solución seleccionados.
- Selección persistente de solución/proyecto y framework; configuración Debug/Release visible en la barra inferior.
- Apertura web para Ejecutar, Depurar y Hot Reload, respetando `launchBrowser` y `launchUrl`; botón para abrir el navegador manualmente.
- Pasos de depuración: por encima, por instrucciones y salir de la función.
- Panel reorganizado, accesible por teclado y actualizado sin recargar su contenido ni perder el foco.
- Estado y errores visibles; accesos a perfiles, salida, problemas e información del SDK.
- Atajos propios y menú de compilación en el editor.
- Los perfiles malformados bloquean el inicio y muestran un mensaje claro.
- Correcciones de cancelación durante el arranque, actualizaciones de archivos durante la ejecución y notificación de errores al terminar una aplicación.

## 0.1.0

- Primera versión: ejecutar, depurar, pausar, detener, reiniciar y compilar proyectos del SDK .NET.
