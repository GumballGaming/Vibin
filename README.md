# Vibin

Vibin is a focused coding-agent CLI built with Bun and TypeScript. It supports OpenAI and OpenRouter, streams responses, uses bounded project context, and asks before making changes.

## Quick start

```powershell
bun install
bun run dev
```

For Windows, run `.\install.ps1` from the repository. It installs `vibin.exe` into your user-local PATH and launches it. Use `.\install.ps1 -NoLaunch` if you only want to install it.

Inside Vibin, run `/provider add`. Its guided setup connects the provider, fetches the models exposed by your API key, and presents a searchable picker—there is no model-ID setup step. Profile names are optional. It saves the selection locally to `.vibin/config.json` (which is ignored by Git), then activates it immediately. Use `/provider list` to see profiles and `/provider use <name>` to switch without restarting.

Environment variables in `.env` remain supported as an optional automation override. For OpenRouter, choose `openrouter` and a model such as `openai/gpt-4.1-mini`.

Run a single request with `bun run dev "explain this project"`. Install globally with `bun link`, then use `vibin` from a project directory.

## Updates

The Windows executable checks GitHub for a newer `dist/vibin.exe` on every restart. When one is found, Vibin downloads it to the ignored `.vibin` folder and replaces the executable after the current process exits. Project configuration, credentials, and sessions remain in `.vibin` and are never uploaded.

## Commands

`/help`, `/status`, `/model <name>`, `/provider list`, `/provider use <name>`, `/provider add`, `/clear`, `/quit`.

## Planning, sessions, and file mentions

Use `/plan <request>` to generate a numbered implementation plan without
changing files. Review it with `/plan show`, execute it with `/plan apply`, or
discard it with `/plan clear`.

Vibin saves completed conversations locally under its ignored `.vibin/sessions`
folder. Use `/session list`, `/session save [name]`, and `/session resume <name>`
to manage them. Session files exclude provider configuration and redact common
API-key and bearer-token formats.

Mention a workspace file in a prompt with `@src/path/to/file.ts`. Vibin reads
the explicitly mentioned relative file, keeps the content bounded, and adds it
to that request's context. Paths outside the workspace and unreadable files are
rejected locally.

## Thinking modes

Use `/thinking` to choose `Low`, `Medium`, `High`, `XHigh`, `MaxThinking`, or
`UltraAgent`. `MaxThinking` uses maximum-depth reasoning and can consume a lot
of your quota/tokens. `UltraAgent` runs parallel specialist sub-agents before
the main agent acts, and can also consume a lot of your quota/tokens. Both modes
ask for confirmation when selected.

## Checks

```powershell
bun run typecheck
bun test
bun run smoke
```
