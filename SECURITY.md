# Security

## Reporting a vulnerability

Please **do not open a public issue** for a security problem. Use GitHub's private vulnerability reporting
(Security → Report a vulnerability) on this repository, or write to the author through [acrocode.dev](https://acrocode.dev).
Include the DotPilot and VS Code versions, your OS, and steps to reproduce. You will get an answer as soon as possible.

## Scope and threat model

DotPilot runs on your machine, has no telemetry and makes no network calls of its own. Tools you start may use the network (your apps; and, only when you run the packaging commands, `npx @vscode/vsce` can download `vsce` and `eas build` talks to Expo). The parts that deserve attention:

**Processes it starts.** Only projects and profiles it detected (a `.csproj`, a `package.json` script, `artisan serve`, a Compose file…),
and only on your request or on a request you allowed. The commands are built from detected names and validated arguments, never from free text.
It requires a **trusted workspace**.

**Companion APIs and packaging.** The list of companion APIs is stored in VS Code's own workspace state, never in the repository, so a
project cannot add one by itself: you choose each API through a dialog (a `.csproj` you pick, or one found in your workspace). Packaging
runs only when you press the button or command: the project's own `package` script, `npx @vscode/vsce`, `eas build` (profile names are
validated against `eas.json`) or `gradlew assembleRelease`. Like running a project, they execute what that project defines.

**AI assistants (off by default).** When you connect an assistant, DotPilot starts a local bridge:

- listens only on `127.0.0.1`, on a random port;
- requires a random bearer token that changes on every start (stored in `~/.dotpilot/bridges`, readable only by your user account);
- rejects requests that carry an `Origin` header or a `Host` other than loopback, so a web page cannot reach it;
- exposes a closed list of tools (`dotpilot_*`): there is no tool that runs arbitrary commands or reads arbitrary files;
- asks for permission in VS Code before actions that start work (unless you set `dotpilot.assistantsPermission` to `allow`);
- can only be enabled from **user** settings, so a repository cannot turn it on.

The MCP server copied to `~/.dotpilot/mcp` talks to the bridge and to nothing else. What an assistant does with the output it reads
(server logs, the Problems panel) is up to that assistant.

**PowerShell script (Windows, Laragon profile).** `assets/laragon.ps1` is shipped readable. It runs with `-ExecutionPolicy Bypass` for
that process only, starts or reuses Laragon's Apache with Laragon's own configuration, tails its logs, and closes only what it started.
It needs no administrator rights and does not modify the `hosts` file.

## Out of scope

- Vulnerabilities in the projects you run, in Laragon, Apache, Node.js, PHP, Python, Docker or in the AI assistants themselves.
- A repository that you trust (and run) containing malicious scripts: DotPilot starts what the project defines, as running it manually would.
- Another process of your own user account reading `~/.dotpilot` while the bridge is on: that account already has your user's privileges.

## Supported versions

Only the latest published version receives fixes.
