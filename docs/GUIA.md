# DotPilot — detailed guide / Guía detallada

> Long-form reference kept from the development builds. The short, current overview is in [README.md](../README.md) (English) and [README.es.md](../README.es.md) (Español). / Referencia extensa conservada de las compilaciones de desarrollo. El resumen actual está en README.md y README.es.md.

Created by **Camilo Ruiz** · [acrocode.dev](https://acrocode.dev) · [camiloruizx](https://github.com/camiloruizx)

## English

### Apache and Laragon for PHP

`php -S` does not reproduce a real site: no virtual hosts, no `.htaccess`, no Apache modules. On Windows, when a PHP project is served by **Laragon** (inside its `www` folder, or with a virtual host in `etc\apache2\sites-enabled`), DotPilot adds an **Apache (Laragon)** profile and makes it the default; `php -S` stays available.

- **Run** starts Laragon's own Apache with Laragon's own `httpd.conf` (virtual hosts, modules, PHP version), opens the site's URL (for example `http://myapp.test/`) and shows Apache's error log live, including PHP errors, so an assistant can read them.
- If Laragon's Apache is already running (port 80), DotPilot reuses it, follows its log and **does not close it** on Stop. Otherwise Stop closes only the Apache DotPilot started.
- The site URL comes from the project's virtual host when its name is in your `hosts` file (Laragon's "auto virtual hosts"); otherwise `http://localhost/<folder>/`.
- MySQL is not started: DotPilot only warns if its port does not answer. Start it from Laragon.
- Needs no administrator rights and does not touch `hosts`. Setting `dotpilot.laragonPath` points to a non-standard install.
- Not covered: XAMPP/WAMP, nginx, HTTPS virtual hosts, and Linux/macOS.

### New in 0.8 — AI assistants

Claude Code, Codex (ChatGPT), Gemini and GitHub Copilot can drive DotPilot, so you can say "run the web app and tell me the URL" or "build and fix the errors".

**Connect them once:** DotPilot menu → **Connect AI assistants** (or **Tools → Connect AI** in the panel). DotPilot detects the assistants installed in the editor, preselects them and configures each one:

| Assistant | How it connects | Where |
| --- | --- | --- |
| Claude Code | MCP server | `.mcp.json` in the project (do not commit it: it holds a path from your computer) |
| Codex (ChatGPT) | MCP server | `~/.codex/config.toml` |
| Gemini | MCP server | `.gemini/settings.json` in the project |
| GitHub Copilot | VS Code language model tools (agent mode) | no file needed |

Restart or reload the assistant afterwards so it loads the tools; Claude Code asks you to approve the project server the first time. The MCP server needs `node` in your PATH, and the VS Code window with the folder must be open.

**What they can do** (the tools are named `dotpilot_*`): list projects and profiles; select a project or profile; run, debug (.NET), Hot Reload (.NET), stop and restart; build, test, clean, restore and analyze (.NET); open the browser; read the running app's output for every project type, .NET included (server logs, unhandled exceptions with stack traces, build errors), and the Problems panel; and get the status with the server URL. They cannot run arbitrary commands: only the projects and profiles DotPilot detected.

**Permission and safety.**

- Off until you connect an assistant, and only you can turn it on or off: the setting lives in user settings, so a repository cannot enable it.
- Actions that start work ask in VS Code every time (Allow / Allow for this session / Deny). Choose `allow` in `dotpilot.assistantsPermission` to stop asking. Copilot uses VS Code's own tool confirmation.
- The bridge listens only on 127.0.0.1, requires a random token that changes on each start, and rejects requests that come from a web page.
- There is no telemetry and DotPilot sends nothing over the network by itself. Only the tools you start use it: your own apps and, if you choose them, the packaging commands (`npx @vscode/vsce` may download `vsce`; `eas build` uses Expo's servers).

### New in 0.7

DotPilot now recognises more than .NET. Open a folder and the project picker lists every runnable project it finds, with its detected type:

| Type | Detected from | Starts with |
| --- | --- | --- |
| .NET / ASP.NET Core | `.csproj`, `.sln`, `launchSettings.json` | `dotnet run`, debugger, Hot Reload (as before) |
| Node.js · React · Vue · Angular · Vite | `package.json` scripts `dev`, `start`, `serve`, `develop` | `npm`, `pnpm`, `yarn` or `bun run <script>`, chosen from the lockfile |
| PHP · Laravel | `artisan`, `composer.json`, `index.php` | `php artisan serve` or `php -S` |
| Python · Django · FastAPI · Flask | `manage.py`, `requirements.txt`, `pyproject.toml` | the framework's dev server, using `.venv`, `venv` or `env` when present |
| Docker | `compose.yaml`, `docker-compose.yml` | `docker compose up` for all services or one; Stop runs `docker compose down` |

Run, Stop and Restart work the same way for all of them, **.NET included** (Run and Hot Reload use the same runner, so an assistant can read the app's output; debugging still uses VS Code's Debug Console). Output appears in a DotPilot terminal; Ctrl+C or closing the terminal stops the server and its child processes. The **Command** field lists the available scripts, services or servers.

**URL and port.** DotPilot reads the address the server prints (for example Vite's `Local:` line or Laravel's `Server running on`), so it follows the server when it moves to another port. Until then it uses the script flags, Vite config, `.env`, the framework default or the published Compose port. The address is shown under the browser field and **Open in browser** uses it. The selected browser, automatic opening and linked-window stop apply to every type.

Debugging, Hot Reload, build and tests remain .NET only and are disabled for the other types. Set `dotpilot.pythonPath` or `dotpilot.phpPath` to use a specific interpreter. Apache and other local servers are not managed; PHP uses its built-in server.

### Companion APIs (.NET)

If your web project calls an API that lives in another project (even in another solution or folder), you do not need a second VS Code window:

1. In the panel, open **Companion APIs** (or run **DotPilot: Manage companion APIs**) and choose **Add API…**. DotPilot suggests the workspace API whose port your `appsettings*.json` calls, or you can **Browse…** for any `.csproj`.
2. On **Run**, **Debug** or **Hot Reload**, DotPilot starts each API in its own terminal (`API <name>`), waits until it listens (up to 90 s), then starts your project. **Stop** ends both; if your project exits on its own, the APIs are stopped too.
3. An API that is already listening on its port is reused and left running.

The first time you run a project whose `appsettings*.json` points to a `localhost` address that is not its own, DotPilot asks once whether to add that API. With **Debug**, only the main project is debugged; the API runs without the debugger.

### Packaging: VSIX and Android APK

DotPilot shows a packaging button in **Tools** (and a command in the palette) when the selected project supports it:

- **VS Code extension** (`engines.vscode` in `package.json`) → **Package VSIX**. It runs the project's `package` script if it has one, otherwise `npx @vscode/vsce package`. When it ends you can **Reveal in folder** or **Install in VS Code** (then reload the window). Bumping the version stays in your hands (`npm version`).
- **Expo project** (`expo` dependency) → **Build APK**. If `eas.json` has a profile with `android.buildType: "apk"` it can run **EAS Build** in the cloud (`eas build --platform android --profile <profile> --non-interactive`; sign in first with `eas login`; EAS builds cannot run locally on Windows). If the `android/` folder exists it can run a **local Gradle** build (`gradlew assembleRelease`, needs a JDK and the Android SDK; `ANDROID_HOME` is taken from the standard Android Studio location when unset). When both are possible DotPilot asks and remembers the last choice. EAS builds finish with a download link you can open or copy; local builds produce `android/app/build/outputs/apk/release/app-release.apk`.

Stop cancels the packaging, and the output stays in a DotPilot terminal.

### New in 0.6

Choose **Web browser** directly below the launch profile, or open **DotPilot → Web browser** in the editor toolbar. Pick Google Chrome, Microsoft Edge or System default; a check mark shows the effective choice. DotPilot remembers it for each startup project. **Use workspace settings** clears that project's choice and uses the existing browser setting. Changing it while the app is running reopens the app in the chosen browser right away (the app keeps running). With nothing running, **Open in browser** launches the chosen browser instead of the system default. Edge/Chrome must be installed; System default uses the operating system handler and cannot track tab closure.

The panel is loaded on demand, status bar items are created only when enabled, unchanged context values are not resent, and hidden panels receive no state updates. Translations are sent only on panel initialization or language change. The distribution icon is 128 × 128 instead of 1254 × 1254. No runtime dependencies were added. These reduce work and package size; activation time still depends on your machine and workspace.

Run, debug and build .NET projects from a dedicated **DotPilot menu** and a redesigned **Run / Settings** panel.

### Install and start

1. In VS Code, choose **Extensions → … → Install from VSIX…** and select **dotpilot-1.0.0.vsix**. For versions 0.3.0 and earlier, uninstall the old local-dotnet-tools extension first to avoid duplicates.
2. Reload the window if requested. Open a trusted folder with a .NET SDK project and select your startup project, launch profile, configuration and framework in the DotPilot view (click the DotPilot icon in the Activity Bar).
3. Choose **Run**, **Debug** or **Hot Reload**. Debugging requires Microsoft's C# extension; .NET SDK 8+ and VS Code 1.85+ are required. C# Dev Kit is optional.

The editor toolbar shows the blue **DotPilot menu** first, followed by the direct **Run without debugging**, **Pause / Continue** (during debugging) and **Stop** buttons. The menu groups this extension's other actions. Build, rebuild, clean, NuGet restore, tests and analysis use the selected project or solution target. Build alone does not run a server. Only Project launch profiles are supported; IIS Express and Docker profiles are not supported.

### Language and settings

Open the **Settings** tab or **DotPilot: Open DotPilot settings**. Choose automatic, English or Spanish for the panel and DotPilot messages. The panel and DotPilot messages follow this setting immediately. Menus and the command palette are translated by VS Code, so they follow VS Code's display language (command **Configure Display Language**); if the two differ, DotPilot tells you once and offers to change it. Changes to the panel language are immediate; open tabs and collapsed sections are preserved.

Settings are grouped into General, Appearance and Run. Toggle the editor menu or status bar controls, automatic browser opening, and the linked browser. **More settings in VS Code** opens a filtered settings page for SDK path and advanced options. The browser choice is stored per startup project; other changes are saved to the workspace (or user settings when no workspace is open). Existing folder overrides are respected. Browser changes apply immediately, also while the app runs.

### Browser and shortcuts

Edge is the default linked browser. Closing its main app tab or window stops the project; Stop closes the owned window and Restart opens a new one. Chrome is also available. Each linked launch uses a separate temporary browser profile. The system default browser is unlinked: closing it does not stop the app. The selected launch profile must request browser launch; HTTPS requires a valid development certificate.

- **Ctrl+Alt+F5:** run without debugging.
- **Ctrl+Alt+F6:** debug.
- **Ctrl+Alt+B:** build. Use Cmd instead of Ctrl on macOS.
- Pause, continue and stepping require a C# debugging session. Project selection applies regardless of the file currently being edited.

## Español

### Apache y Laragon para PHP

`php -S` no reproduce un sitio real: sin virtual hosts, sin `.htaccess`, sin módulos de Apache. En Windows, cuando un proyecto PHP lo sirve **Laragon** (dentro de su carpeta `www`, o con un virtual host en `etc\apache2\sites-enabled`), DotPilot añade un perfil **Apache (Laragon)** y lo deja como predeterminado; `php -S` sigue disponible.

- **Ejecutar** inicia el Apache de Laragon con su propio `httpd.conf` (virtual hosts, módulos, versión de PHP), abre la URL del sitio (por ejemplo `http://miapp.test/`) y muestra en vivo el registro de errores de Apache, incluidos los errores de PHP, para que un asistente pueda leerlos.
- Si el Apache de Laragon ya está en ejecución (puerto 80), DotPilot lo reutiliza, sigue su registro y **no lo cierra** al detener. Si no, Detener cierra solo el Apache que DotPilot inició.
- La URL del sitio sale del virtual host del proyecto cuando su nombre está en tu archivo `hosts` (los «virtual hosts automáticos» de Laragon); si no, `http://localhost/<carpeta>/`.
- No inicia MySQL: solo avisa si su puerto no responde. Inícialo desde Laragon.
- No requiere permisos de administrador ni modifica `hosts`. El ajuste `dotpilot.laragonPath` indica una instalación no estándar.
- Fuera de alcance: XAMPP/WAMP, nginx, virtual hosts HTTPS, y Linux/macOS.

### Nuevo en 0.8 — Asistentes de IA

Claude Code, Codex (ChatGPT), Gemini y GitHub Copilot pueden manejar DotPilot: «ejecuta la web y dime la URL» o «compila y corrige los errores».

**Conéctalos una vez:** menú de DotPilot → **Conectar asistentes de IA** (o **Herramientas → Conectar IA** en el panel). DotPilot detecta los asistentes instalados en el editor, los deja marcados y configura cada uno:

| Asistente | Cómo se conecta | Dónde |
| --- | --- | --- |
| Claude Code | Servidor MCP | `.mcp.json` del proyecto (no lo subas al repositorio: lleva una ruta de tu equipo) |
| Codex (ChatGPT) | Servidor MCP | `~/.codex/config.toml` |
| Gemini | Servidor MCP | `.gemini/settings.json` del proyecto |
| GitHub Copilot | Herramientas de modelo de lenguaje de VS Code (modo agente) | no necesita archivo |

Después reinicia o recarga el asistente para que cargue las herramientas; Claude Code te pide aprobar el servidor del proyecto la primera vez. El servidor MCP necesita `node` en el PATH y la ventana de VS Code con la carpeta debe estar abierta.

**Qué pueden hacer** (las herramientas se llaman `dotpilot_*`): listar proyectos y perfiles; elegir proyecto o perfil; ejecutar, depurar (.NET), Hot Reload (.NET), detener y reiniciar; compilar, probar, limpiar, restaurar y analizar (.NET); abrir el navegador; leer la salida de la aplicación en ejecución de cualquier tipo de proyecto, .NET incluido (registro del servidor, excepciones sin controlar con su traza, errores de compilación) y el panel Problemas; y consultar el estado con la URL del servidor. No pueden ejecutar comandos arbitrarios: solo los proyectos y perfiles que DotPilot detectó.

**Permiso y seguridad.**

- Está apagado hasta que conectes un asistente y solo tú puedes activarlo o desactivarlo: el ajuste vive en la configuración de usuario, así que un repositorio no puede activarlo.
- Las acciones que inician trabajo preguntan en VS Code cada vez (Permitir / Permitir en esta sesión / Rechazar). Elige `allow` en `dotpilot.assistantsPermission` para dejar de preguntar. Copilot usa la confirmación propia de VS Code.
- El puente escucha solo en 127.0.0.1, exige un token aleatorio que cambia en cada inicio y rechaza solicitudes que vengan de una página web.
- No hay telemetría y DotPilot no envía nada por red por sí mismo. Solo la usan las herramientas que tú inicias: tus aplicaciones y, si los eliges, los comandos de empaquetado (`npx @vscode/vsce` puede descargar `vsce`; `eas build` usa los servidores de Expo).

### Nuevo en 0.7

DotPilot ahora reconoce más que .NET. Al abrir una carpeta, el selector de proyecto lista cada proyecto ejecutable que encuentra, con su tipo detectado:

| Tipo | Se detecta por | Se inicia con |
| --- | --- | --- |
| .NET / ASP.NET Core | `.csproj`, `.sln`, `launchSettings.json` | `dotnet run`, depurador, Hot Reload (como antes) |
| Node.js · React · Vue · Angular · Vite | scripts `dev`, `start`, `serve`, `develop` de `package.json` | `npm`, `pnpm`, `yarn` o `bun run <script>`, según el archivo de bloqueo |
| PHP · Laravel | `artisan`, `composer.json`, `index.php` | `php artisan serve` o `php -S` |
| Python · Django · FastAPI · Flask | `manage.py`, `requirements.txt`, `pyproject.toml` | el servidor de desarrollo del framework, con `.venv`, `venv` o `env` si existen |
| Docker | `compose.yaml`, `docker-compose.yml` | `docker compose up` para todos los servicios o uno; Detener ejecuta `docker compose down` |

Ejecutar, Detener y Reiniciar funcionan igual en todos. La salida aparece en una terminal de DotPilot; Ctrl+C o cerrar la terminal detiene el servidor y sus procesos hijos. El campo **Comando** lista los scripts, servicios o servidores disponibles.

**URL y puerto.** DotPilot lee la dirección que imprime el servidor (por ejemplo la línea `Local:` de Vite o `Server running on` de Laravel), así que sigue al servidor si cambia de puerto. Mientras tanto usa las opciones del script, la configuración de Vite, `.env`, el valor predeterminado del framework o el puerto publicado de Compose. La dirección se muestra bajo el navegador y **Navegador** la usa. La elección de navegador, la apertura automática y el cierre vinculado aplican a todos los tipos.

Depurar, Hot Reload, compilar y pruebas siguen siendo solo de .NET y se desactivan para los otros tipos. Usa `dotpilot.pythonPath` o `dotpilot.phpPath` para elegir un intérprete. No administra Apache ni otros servidores locales; PHP usa su servidor integrado.

### APIs complementarias (.NET)

Si tu proyecto web consume una API que vive en otro proyecto (incluso en otra solución o carpeta), no necesitas una segunda ventana de VS Code:

1. En el panel abre **APIs complementarias** (o ejecuta **DotPilot: Administrar APIs complementarias**) y elige **Agregar API…**. DotPilot sugiere la API del espacio de trabajo cuyo puerto llama tu `appsettings*.json`, o puedes **Examinar…** cualquier `.csproj`.
2. Al **Ejecutar**, **Depurar** o usar **Hot Reload**, DotPilot inicia cada API en su propia terminal (`API <nombre>`), espera a que escuche (hasta 90 s) y luego inicia tu proyecto. **Detener** cierra ambos; si tu proyecto termina por sí solo, las APIs también se detienen.
3. Una API que ya está escuchando en su puerto se reutiliza y no se cierra.

La primera vez que ejecutas un proyecto cuyo `appsettings*.json` apunta a una dirección `localhost` que no es suya, DotPilot pregunta una vez si quieres agregar esa API. Con **Depurar**, solo se depura el proyecto principal; la API corre sin depurador.

### Empaquetado: VSIX y APK de Android

DotPilot muestra un botón de empaquetado en **Herramientas** (y un comando en la paleta) cuando el proyecto seleccionado lo admite:

- **Extensión de VS Code** (`engines.vscode` en `package.json`) → **Empaquetar VSIX**. Ejecuta el script `package` del proyecto si lo tiene; si no, `npx @vscode/vsce package`. Al terminar puedes **Mostrar en carpeta** o **Instalar en VS Code** (y luego recargar la ventana). Subir la versión sigue en tus manos (`npm version`).
- **Proyecto Expo** (dependencia `expo`) → **Generar APK**. Si `eas.json` tiene un perfil con `android.buildType: "apk"` puede usar **EAS Build** en la nube (`eas build --platform android --profile <perfil> --non-interactive`; inicia sesión antes con `eas login`; EAS no compila localmente en Windows). Si existe la carpeta `android/` puede hacer una compilación **local con Gradle** (`gradlew assembleRelease`; requiere JDK y el SDK de Android, y toma `ANDROID_HOME` de la ruta estándar de Android Studio si no está definida). Cuando ambas son posibles DotPilot pregunta y recuerda la última elección. EAS termina con un enlace de descarga que puedes abrir o copiar; la local deja `android/app/build/outputs/apk/release/app-release.apk`.

Detener cancela el empaquetado, y la salida queda en una terminal de DotPilot.

### Nuevo en 0.6

Selecciona **Navegador web** debajo del perfil, o abre **DotPilot → Navegador web** en la barra del editor. Elige Google Chrome, Microsoft Edge o Predeterminado del sistema; una marca indica la elección activa. Se recuerda por proyecto de inicio. **Usar ajustes del espacio de trabajo** elimina la elección específica y vuelve al ajuste de navegador existente. Cambiarla con la aplicación en ejecución la reabre de inmediato en el navegador elegido (la aplicación sigue corriendo). Sin nada en ejecución, **Navegador** abre el navegador elegido y no el predeterminado del sistema. Edge/Chrome deben estar instalados; el navegador del sistema no permite detectar el cierre de su pestaña.

Para aligerarlo, el panel se carga al abrirlo, los controles inferiores se crean solo al habilitarlos y se evitan mensajes repetidos o hacia paneles ocultos. Las traducciones se envían únicamente al inicializar el panel o cambiar el idioma. El ícono de distribución pasa de 1254 × 1254 a 128 × 128. No se añadieron dependencias de ejecución. El tiempo de activación puede variar según equipo y proyecto.


**Creado por Camilo Ruiz · [acrocode.dev](https://acrocode.dev) · [GitHub: camiloruizx](https://github.com/camiloruizx)**

Controles en inglés y español para trabajar con proyectos .NET desde un menú propio de DotPilot y un panel con las pestañas Ejecución y Ajustes.

## Instalar o actualizar

1. En VS Code abre **Extensiones** (`Ctrl+Shift+X`).
2. Abre el menú `…` y elige **Instalar desde VSIX…**.
3. Si tienes DotPilot 0.3.0 o anterior, desinstálalo y recarga VS Code primero: el publicador cambió de `local-dotnet-tools` a `camiloruizx`, por lo que el editor los considera extensiones distintas. Tendrás que volver a seleccionar tu proyecto y perfil.
4. Selecciona **dotpilot-1.0.0.vsix**. La ficha mostrará `camiloruizx` como publicador local; este identificador todavía no implica una publicación en Marketplace.
5. Recarga la ventana si se solicita. Abre tu solución y el panel **DotPilot** con su icono en la barra de actividad.
6. Selecciona proyecto, perfil —por ejemplo `https`—, configuración y framework. Usa **Depurar**, **Ejecutar** o **Hot Reload**.

Necesitas **SDK .NET 8 o posterior**, VS Code 1.85 o posterior y, para depurar, **C# de Microsoft** (`ms-dotnettools.csharp`). C# Dev Kit es opcional. La carpeta debe ser de confianza.

## Controles superiores

Con un proyecto .NET abierto, aparece primero el menú azul de **DotPilot** y después los botones directos **Ejecutar sin depurar**, **Pausar / Continuar** (durante la depuración) y **Detener**, arriba a la derecha del editor. El menú agrupa las demás acciones de Ejecución, Proyecto, Compilación y pruebas, Mostrar/Ocultar panel y Ajustes. Así se distinguen las acciones de DotPilot de las otras extensiones. Los controles directos siguen disponibles dentro del panel y mediante los atajos.

VS Code no expone a extensiones la zona de la barra de título junto a «Try Agents Window». Se utiliza la barra del editor admitida por la API oficial. Si no se ve, abre un archivo y comprueba que las acciones del editor estén visibles en tu diseño de VS Code.

Puedes desactivar la barra superior con **DotPilot: Show Editor Toolbar** y activar los controles inferiores con **DotPilot: Show Status Bar**.

El menú de DotPilot y la paleta muestran **Mostrar panel DotPilot** cuando está oculto y **Ocultar panel DotPilot** cuando está visible. El estado también se actualiza al plegar el panel o esconder la barra lateral. Ocultar el panel mantiene la aplicación en ejecución.

## Idioma y ajustes

En el panel, abre **Ajustes**. También puedes usar **DotPilot: Abrir ajustes de DotPilot** desde la paleta o el menú de la barra superior.

- **Idioma:** Automático sigue VS Code (español para es/es-MX, inglés para los demás idiomas). Puedes elegir Español o English para el panel y los mensajes de DotPilot sin recargar. El panel y los mensajes de DotPilot siguen este ajuste al instante. Los menús y la paleta de comandos los traduce VS Code, así que siguen su idioma de pantalla (comando **Configurar idioma de pantalla**); si ambos difieren, DotPilot avisa una vez y ofrece cambiarlo; las salidas del SDK y otras extensiones conservan su idioma.
- **Apariencia:** mostrar el botón propio de DotPilot o los controles inferiores.
- **Ejecución:** abrir navegador automáticamente y elegir Edge, Chrome o el navegador del sistema. Se aplica de inmediato, también con la aplicación en ejecución.
- **Más ajustes en VS Code:** abre únicamente las opciones de DotPilot, incluida la ruta del ejecutable dotnet.

La elección de navegador se recuerda por proyecto de inicio. Los demás cambios se guardan en el espacio de trabajo abierto; sin carpeta abierta, se guardan para el usuario. Se respetan las opciones específicas de carpeta existentes. El panel recuerda su pestaña y las secciones plegadas, permite navegar entre pestañas con las flechas del teclado y se adapta al tema y ancho disponibles.

## Ejecución y depuración

| Control | Comportamiento |
| --- | --- |
| Depurar | Compila e inicia el depurador C#, con breakpoints |
| Ejecutar | Inicia `dotnet run` con el proyecto, configuración, framework y perfil elegidos |
| Hot Reload | Inicia `dotnet watch`; actualiza al guardar y reinicia cuando el cambio lo requiere |
| Pausar / Continuar | Pausa un hilo o continúa la sesión de depuración |
| Detener | Cancela las operaciones, tareas y sesión iniciadas por esta extensión |
| Reiniciar | Espera la terminación anterior e inicia otra ejecución con el mismo modo |
| Pasos | Avanzar por encima, entrar en una función o salir de ella; disponibles en pausa |
| Navegador | Abre la URL y ruta del perfil seleccionado |

La apertura automática respeta **launchBrowser** y **launchUrl**, y funciona en ejecución, depuración y Hot Reload. Se desactiva con **DotPilot: Open Browser**.

Por defecto, la aplicación se abre en una ventana de **Edge vinculada a DotPilot**. Cerrar la pestaña principal de la aplicación o esa ventana detiene el proyecto y libera su puerto. **Detener** también cierra esa ventana; **Reiniciar** abre una nueva. Se utiliza un perfil temporal separado, sin compartir tus sesiones habituales del navegador.

En **DotPilot: Browser** puedes elegir `edge`, `chrome` o `external`. Edge y Chrome requieren el navegador correspondiente instalado y el depurador JavaScript integrado de VS Code habilitado. Con `external` se usa el navegador predeterminado y debes detener el proyecto desde DotPilot: VS Code no informa del cierre de esas pestañas. **Compilar** por sí solo no inicia un servidor. Abrir el navegador sin una ejecución activa abre el navegador elegido (Chrome o Edge); con `external` usa el predeterminado del sistema.

En ejecución y Hot Reload espera hasta aproximadamente un minuto a que el puerto local empiece a responder. Omite la apertura automática si el puerto ya estaba ocupado antes del inicio. En depuración espera el mensaje `Now listening on:`. Si tu servidor registra otro mensaje, usa **Navegador**.

HTTPS necesita un certificado de desarrollo válido. La extensión no instala certificados ni cambia su confianza.

## Compilación y pruebas

Selecciona el **Destino de compilación y pruebas**: proyecto de inicio o solución. La extensión recuerda la elección. Si hay varias soluciones, pide elegir una.

| Control | Operación |
| --- | --- |
| Compilar | `dotnet build` |
| Recompilar | `dotnet build -t:Rebuild` |
| Limpiar | `dotnet clean` |
| Restaurar NuGet | `dotnet restore` |
| Ejecutar pruebas | `dotnet test` sobre el destino seleccionado |
| Analizar código | Recompila con los analizadores configurados en el proyecto habilitados |

Se usa **Debug / Release** para las operaciones. El framework seleccionado se aplica a ejecutar y depurar el proyecto de inicio; la compilación de solución conserva los frameworks de cada proyecto. Los resultados de pruebas aparecen en Terminal y los fallos se notifican como tareas fallidas. El proyecto debe tener sus pruebas configuradas.

## Atajos y herramientas

- **Ctrl+Alt+F5**: ejecutar sin depurar.
- **Ctrl+Alt+F6**: iniciar depuración.
- **Ctrl+Alt+B**: compilar.
- En macOS, usa Cmd en lugar de Ctrl. Puedes reasignar los atajos en VS Code.
- La paleta (`Ctrl+Shift+P`) ofrece todos los comandos con el prefijo **DotPilot**.
- **Editar perfiles**, **Ver salida**, **Problemas** y **Comprobar SDK** ayudan a configurar y diagnosticar el proyecto.
- El editor ofrece el menú propio de DotPilot con ejecución, proyecto, compilación y ajustes.

Los controles siempre ejecutan el **proyecto de inicio seleccionado**, aunque edites un archivo de otro proyecto. Los atajos nativos F5/F10/F11 conservan su comportamiento habitual.

## Ajustes

| Ajuste | Uso |
| --- | --- |
| `dotpilot.language` | auto, en o es para el panel y los mensajes |
| `dotpilot.dotnetPath` | Ruta del ejecutable dotnet, sin argumentos |
| `dotpilot.pythonPath` | Ruta de Python; vacío usa `.venv`, `venv`, `env` o el del sistema |
| `dotpilot.phpPath` | Ruta del ejecutable PHP, sin argumentos |
| `dotpilot.laragonPath` | Carpeta de Laragon (vacío la detecta); para el perfil Apache de proyectos PHP |
| `dotpilot.assistantsEnabled` | Puente local para asistentes de IA (solo ajustes de usuario; desactivado por defecto) |
| `dotpilot.assistantsPermission` | `ask` pregunta antes de ejecutar, reiniciar o compilar; `allow` no pregunta |
| `dotpilot.browser` | Edge o Chrome vinculados a la ejecución, o navegador externo sin detención automática |
| `dotpilot.showEditorToolbar` | Mostrar controles superiores (activado por defecto) |
| `dotpilot.showStatusBar` | Mostrar controles inferiores (desactivado por defecto) |
| `dotpilot.openBrowser` | Permitir apertura automática pedida por el perfil |
| `dotpilot.buildScope` | Destino inicial: solución o proyecto; la selección guardada del panel tiene prioridad |

## Alcance

- Proyectos ejecutables del SDK .NET: C#, F# y VB. Soluciones `.sln` y `.slnx` si el SDK instalado admite su formato.
- Además, Node.js, PHP/Laravel, Python y Docker Compose: ejecutar, detener y reiniciar con detección de URL. No incluyen depuración, Hot Reload ni compilación, y requieren tener Node.js, PHP, Python o Docker instalados.
- Perfiles `commandName: "Project"`. No ejecuta IIS Express, Docker ni proyectos antiguos de .NET Framework.
- Depuración CoreCLR con argumentos, variables y URL de perfiles; no reproduce todas las opciones avanzadas de Visual Studio.
- Pausa y pasos funcionan en **Depurar**. Hot Reload ejecuta sin depurador.
- Una ejecución activa por ventana. Detener controla las tareas y sesiones iniciadas por esta extensión.
- Al compilar o ejecutar guarda los archivos abiertos que ya tienen ruta. No modifica proyectos, `launch.json` ni `tasks.json`.
- Las herramientas se ejecutan en el host del espacio de trabajo. Esta versión se ha probado en Windows; macOS, Linux, WSL y contenedores necesitan validación adicional.
- No envía telemetría. NuGet usa los orígenes configurados en tus proyectos.

## Desarrollo

Abre esta carpeta en VS Code y pulsa **F5** para iniciar una ventana de desarrollo. No hay dependencias de producción.

```text
npm ci
npm test
npm run package
```

Consulta los archivos VALIDACION.md y CHANGELOG.md incluidos en el código fuente.

### Estructura del código

`src/extension.js` solo contiene el `Controller` (estado, orquestación de ejecutar/detener, `invoke`) y `activate`. El resto de sus métodos vive en módulos por responsabilidad que se mezclan en su prototipo:

| Módulo | Responsabilidad |
| --- | --- |
| `src/controller/projects.js` | Búsqueda de proyectos, selección de proyecto, perfil y destino |
| `src/controller/managed.js` | Ejecución con el ejecutor propio (Node.js, PHP, Python, Docker, Apache, .NET sin depurar) |
| `src/controller/browser.js` | Elección de navegador y ciclo de vida de la ventana vinculada |
| `src/controller/dotnet.js` | Compilar, consultas de MSBuild, framework, pausa y pasos |
| `src/controller/assistants.js` | API para agentes, puente local y aviso de idioma |
| `src/controller/panel.js` | Panel, ajustes y barra de estado |

Los módulos de `src/controller/` exportan una función que recibe sus dependencias (incluido `vscode`) y devuelve métodos; así las pruebas unitarias los ejecutan con un VS Code simulado. La lógica sin VS Code está aparte y se prueba directamente: `detect.js`, `runner.js`, `laragon.js`, `bridge.js`, `agent.js`, `agent-tools.js`, `assistants.js`, `core.js`.

Referencias: [API de VS Code](https://code.visualstudio.com/api/references/vscode-api), [depuración C#](https://code.visualstudio.com/docs/csharp/debugger-settings), [dotnet watch](https://learn.microsoft.com/en-us/dotnet/core/tools/dotnet-watch).


## Desinstalación

Desinstala DotPilot desde Extensiones. Si VS Code muestra **Reiniciar**, la extensión ya se eliminó del perfil pero la ventana necesita recargarse para descargarla de memoria. Pulsa ese botón o cierra y vuelve a abrir VS Code.
