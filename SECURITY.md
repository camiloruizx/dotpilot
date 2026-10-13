# Security

## Reporting a vulnerability

Please **do not open a public issue** for a security problem. Use GitHub's private vulnerability reporting
(Security → Report a vulnerability) on this repository, or write to the author through [acrocode.dev](https://acrocode.dev).
Include the DotPilot and VS Code versions, your OS, and steps to reproduce. You will get an answer as soon as possible.

## Scope and threat model

DotPilot runs entirely on your machine, has no telemetry and makes no network calls. The parts that deserve attention:

**Processes it starts.** Only projects and profiles it detected (a `.csproj`, a `package.json` script, `artisan serve`, a Compose file…),
and only on your request or on a request you allowed. The commands are built from detected names and validated arguments, never from free text.
It requires a **trusted workspace**.

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
