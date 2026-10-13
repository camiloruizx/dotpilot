# DotPilot

**Ejecuta, depura y compila .NET —y ejecuta proyectos Node.js, PHP, Python y Docker— desde un solo panel en VS Code. Deja que tu asistente de IA los maneje.**

DotPilot detecta los proyectos ejecutables de tu espacio de trabajo, te deja elegir proyecto y perfil de ejecución, y ofrece Ejecutar, Detener, Reiniciar, compilar y probar con un navegador vinculado que se cierra junto con tu aplicación. Además expone las mismas acciones a los asistentes de IA mediante MCP, siempre con tu permiso.

[English](README.md) · [Guía detallada](docs/GUIA.md) · [Cambios](CHANGELOG.md)

<img src="media/screenshots/panel-dotnet.png" alt="Panel de DotPilot con un proyecto .NET" width="280"> <img src="media/screenshots/panel-node.png" alt="Panel de DotPilot ejecutando una app React + Vite" width="280"> <img src="media/screenshots/panel-apache.png" alt="Panel de DotPilot ejecutando un sitio PHP con el Apache de Laragon" width="280">

## Qué hace

- **Detecta el tipo de proyecto** y muestra lo que encontró: .NET, Node.js (Vite, React, Vue, Angular, Next.js, Nuxt…), PHP/Laravel, Python (Django, FastAPI, Flask) y Docker Compose.
- **Ejecutar, Detener, Reiniciar** para todos, en una terminal de DotPilot. Detener cierra todo el árbol de procesos.
- **Lee la URL y el puerto de la salida del propio servidor**, así que lo sigue si cambia de puerto. La dirección es un enlace en el panel.
- **Navegador vinculado:** Edge o Chrome con un perfil temporal; al cerrar la ventana se detiene la aplicación. El navegador se elige por proyecto y, si lo cambias con la app en ejecución, se reabre en el nuevo.
- **Extras de .NET:** depuración con el depurador de C#, Hot Reload, compilar, recompilar, limpiar, restaurar, probar y analizar, con los perfiles de `launchSettings.json`.
- **Perfil Apache (Laragon) para PHP en Windows:** ejecuta el Apache de Laragon con su propia configuración (virtual hosts, `.htaccess`, módulos) en lugar de `php -S`.
- **Los asistentes de IA pueden usarlo** mediante un servidor MCP local y las herramientas de modelo de lenguaje de VS Code.

## Proyectos compatibles

| Tipo | Se detecta por | Se inicia con |
| --- | --- | --- |
| .NET / ASP.NET Core | `.csproj`, `.sln`, `launchSettings.json` | `dotnet run`, depurador de C#, `dotnet watch` |
| Node.js · React · Vue · Angular · Vite | scripts `dev`, `start`, `serve`, `develop` de `package.json` | `npm`, `pnpm`, `yarn` o `bun run <script>` (según el lockfile) |
| PHP · Laravel | `artisan`, `composer.json`, `index.php` | Apache de Laragon, `php artisan serve` o `php -S` |
| Python · Django · FastAPI · Flask | `manage.py`, `requirements.txt`, `pyproject.toml` | el servidor de desarrollo del framework, con `.venv`/`venv`/`env` si existen |
| Docker | `compose.yaml`, `docker-compose.yml` | `docker compose up` (todos los servicios o uno); Detener ejecuta `docker compose down` |

Depurar, Hot Reload, compilar y pruebas son solo de .NET; se desactivan para los otros tipos.

## Primeros pasos

1. Abre una carpeta con un proyecto en un **espacio de trabajo de confianza**.
2. Abre la vista **DotPilot** en el Explorador (o el menú azul de DotPilot en la barra del editor).
3. Elige proyecto y perfil y pulsa **Ejecutar** (`Ctrl+Alt+F5`), o **Depurar** (`Ctrl+Alt+F6`) en .NET.

| Atajo | Acción |
| --- | --- |
| `Ctrl+Alt+F5` | Ejecutar sin depurar |
| `Ctrl+Alt+F6` | Iniciar depuración (.NET) |
| `Ctrl+Alt+B` | Compilar (.NET) |

En macOS usa `Cmd` en lugar de `Ctrl`.

## Apache y Laragon para PHP (Windows)

`php -S` no reproduce un sitio real: sin virtual hosts, sin `.htaccess`, sin módulos de Apache. Cuando un proyecto PHP lo sirve **Laragon** —dentro de su carpeta `www`, o con un virtual host en `etc\apache2\sites-enabled`— DotPilot añade un perfil **Apache (Laragon)** y lo deja como predeterminado; `php -S` sigue disponible.

- **Ejecutar** inicia el Apache de Laragon con su propio `httpd.conf`, abre la URL del sitio (por ejemplo `http://miapp.test/`) y muestra en vivo el registro de errores de Apache, incluidos los de PHP.
- Si Apache ya está en ejecución en su puerto, DotPilot lo reutiliza, sigue su registro y **no lo cierra** al detener. Si no, Detener cierra solo el Apache que DotPilot inició.
- **No** inicia MySQL. Solo avisa si su puerto no responde: inícialo desde Laragon.
- No necesita administrador ni toca el archivo `hosts`. El ajuste `dotpilot.laragonPath` sirve para una instalación no estándar.
- Fuera de alcance: XAMPP/WAMP, nginx, virtual hosts HTTPS, Linux y macOS.

## Asistentes de IA

Ejecuta **DotPilot: Conectar asistentes de IA**. DotPilot detecta los asistentes instalados en el editor y configura cada uno:

| Asistente | Cómo se conecta | Dónde escribe |
| --- | --- | --- |
| Claude Code | Servidor MCP | `.mcp.json` del proyecto (no lo subas al repositorio: lleva una ruta de tu equipo) |
| Codex | Servidor MCP | `~/.codex/config.toml` |
| Gemini | Servidor MCP | `.gemini/settings.json` del proyecto |
| GitHub Copilot | Herramientas de modelo de lenguaje de VS Code (modo agente) | ningún archivo |

**Estado de la verificación — léelo.** Probado con los CLIs reales, en modo no interactivo, manejando un proyecto Node.js y uno .NET a través de DotPilot:

| Asistente | Resultado |
| --- | --- |
| Claude Code 2.1 | Sesión completa verificada (listar, elegir, ejecutar, leer salida, detener), también cargando el `.mcp.json` generado |
| Codex CLI 0.149 | Sesión completa verificada; Codex también lee el `config.toml` generado. Carga las herramientas como diferidas, así que el modelo debe buscarlas |
| Gemini CLI 0.46 | Lee el `.gemini/settings.json` generado y conecta con el servidor. No se pudo probar una sesión con modelo: el nivel de la cuenta de Gemini ya no es compatible con ese CLI |
| GitHub Copilot CLI 1.0 | Lee el `.mcp.json` generado como servidor del espacio de trabajo. No se pudo probar una sesión con modelo: sin sesión iniciada |
| Copilot en VS Code | Registro e invocación de las herramientas verificados; la confirmación del chat la gestiona VS Code y no se ejercitó |

Las sesiones interactivas dentro de VS Code (de cualquier asistente) no se verificaron.

Las herramientas se llaman `dotpilot_*`: listar proyectos, elegir proyecto o perfil, ejecutar, depurar (.NET), Hot Reload (.NET), detener, reiniciar, compilar/probar (.NET), abrir el navegador, leer la salida de la app y el panel Problemas, y consultar el estado con la URL. No pueden ejecutar comandos arbitrarios, solo los proyectos y perfiles que DotPilot detectó.

**Permiso y seguridad**

- Está apagado hasta que conectes un asistente y solo tú puedes activarlo: el ajuste vive en tu configuración de usuario, así que un repositorio no puede activarlo.
- Las acciones que inician trabajo (ejecutar, depurar, reiniciar, compilar, abrir el navegador) preguntan en VS Code cada vez: Permitir / Permitir en esta sesión / Rechazar. Con `dotpilot.assistantsPermission` en `allow` deja de preguntar.
- El puente escucha solo en `127.0.0.1`, exige un token aleatorio que cambia en cada inicio y rechaza solicitudes que vengan de una página web.
- El servidor MCP necesita `node` en el PATH y la ventana de VS Code con la carpeta debe estar abierta.

## Ajustes

| Ajuste | Uso |
| --- | --- |
| `dotpilot.language` | `auto`, `en` o `es` para el panel y los mensajes |
| `dotpilot.browser` | `edge`, `chrome` (ventana vinculada) o `external` (predeterminado del sistema, sin vínculo) |
| `dotpilot.openBrowser` | Abrir el navegador automáticamente cuando el perfil lo pide |
| `dotpilot.dotnetPath` / `pythonPath` / `phpPath` / `laragonPath` | Ejecutables o carpeta de instalación, si no están en el PATH |
| `dotpilot.buildScope` | Compilar la solución o solo el proyecto de inicio |
| `dotpilot.showEditorToolbar` / `showStatusBar` | Mostrar el menú y botones en el editor / controles en la barra inferior |
| `dotpilot.assistantsEnabled` / `assistantsPermission` | Puente para asistentes de IA y su modo de permiso (solo ajustes de usuario) |

Los menús y la paleta de comandos siguen el idioma de VS Code; el panel y los mensajes siguen `dotpilot.language`.

## Qué hace DotPilot en tu equipo

- **Sin telemetría** y sin llamadas de red. Todo es local.
- **Procesos:** solo los proyectos y perfiles que detectó, iniciados a petición tuya. Detener los cierra.
- **Puertos:** los que usan tus aplicaciones. Con asistentes de IA, un puerto aleatorio en `127.0.0.1` para el puente.
- **Archivos:** un perfil temporal del navegador mientras hay una ventana vinculada (se borra después); con asistentes de IA, `~/.dotpilot` (copia del servidor MCP y un archivo de descubrimiento con el token del puente); en Windows con Laragon, un registro de consola en la carpeta temporal. Nunca modifica tus proyectos, `launch.json` ni `tasks.json`. **Conectar asistentes de IA** solo escribe los archivos indicados, después de que los elijas.
- **PowerShell:** el perfil de Laragon ejecuta un script incluido en la extensión (`assets/laragon.ps1`, legible) con `-ExecutionPolicy Bypass` solo para ese proceso. Inicia o reutiliza Apache, sigue su registro y cierra lo que inició.

## Requisitos y límites

- VS Code 1.85 o posterior (1.95 o posterior para las herramientas de modelo de lenguaje de Copilot). Depurar requiere la **extensión C#** de Microsoft; SDK de .NET 8 o posterior.
- Requiere un espacio de trabajo de confianza; no admite espacios virtuales.
- **Probado en:** Windows 11 con VS Code 1.141 y 1.85.2 (el mínimo declarado), SDK de .NET 10 (destino net8.0), Node.js 24, PHP 8.3, Python 3.14. En la 1.85 no existen las herramientas de modelo de lenguaje (la integración con Copilot requiere la 1.95) y no se ejercitó la depuración de C#. **No probado:** Linux, macOS, WSL, SSH y contenedores de desarrollo. El CI ejecuta las pruebas unitarias en Windows, Linux y macOS.
- Solo perfiles `Project` de .NET (sin IIS Express ni perfiles Docker).
- La salida de una sesión de **depuración** va a la Consola de depuración de VS Code y no está disponible para los asistentes.

## Solución de problemas

- *El proyecto no aparece:* necesita un `.csproj`, un `package.json` con un script `dev`/`start`/`serve`/`develop`, `artisan`/`composer.json`/`index.php`, `manage.py`/`requirements.txt`/`pyproject.toml` o un archivo de Compose. Usa **Actualizar**.
- *El navegador no se abre:* revisa `dotpilot.openBrowser` y que el perfil lo pida; HTTPS necesita un certificado de desarrollo válido.
- *Canal de salida:* **DotPilot: Mostrar salida** tiene los diagnósticos de la extensión.

## Licencia

MIT © Camilo Ruiz · [acrocode.dev](https://acrocode.dev) · [GitHub](https://github.com/camiloruizx)
