# Vibin CLI design

## Goal

Vibin is a polished Bun + TypeScript terminal coding agent. It supports OpenAI and OpenRouter through an OpenAI-compatible API boundary, uses selective working-context rather than indiscriminate repository loading, and gives users clear control over file and shell changes.

## First-release scope

- Interactive streaming chat with a distinctive, accessible terminal interface.
- OpenAI and OpenRouter provider presets, plus a custom compatible endpoint.
- Read, list, search, write, and patch project files; run shell commands only after confirmation.
- Compact per-session transcript and explicit project context discovery (`AGENTS.md`, relevant files only).
- Slash commands for help, model/provider switching, session status, clear, and quit.
- First-run setup and environment/config-file loading.
- A reusable high-quality agent system prompt.

## Session, planning, and file-reference extension

Vibin persists the active session after each completed request in the ignored
`.vibin/sessions` directory. A session contains the bounded chat history,
prompt history, timestamps, and an optional named plan. It never contains a
provider profile or API key. `/session save [name]` assigns a stable session
identifier, `/session list` shows saved sessions, and `/session resume <id>`
restores its history and plan. Invalid or missing session files produce a
recoverable CLI error.

Planning is explicit. `/plan <request>` asks the provider for a concise,
numbered plan and retains it as the active plan without editing the workspace.
`/plan show` displays it, `/plan clear` removes it, and `/plan apply` sends the
approved plan to the normal agent loop. This prevents surprise planning calls
for ordinary questions while providing a deliberate review point before a
coding task.

Prompts may name workspace files with `@relative/path`. Before contacting the
provider, the agent resolves each mention within the workspace, reads each
unique UTF-8 file, and appends labeled content to the request context. File
content is bounded per file and across all mentions. Missing, out-of-workspace,
or unreadable mentions fail locally with a useful error, so they are never sent
as ambiguous requests. The original prompt is otherwise unchanged.

## Package layout

```
src/
  api/          provider adapters, request/streaming types, transport errors
  agent/        system prompt, agent loop, context collector, message state
  cli/          terminal rendering, prompt loop, commands, application entry
  config/       defaults, validation, config and environment loading
  tools/        filesystem and shell tools plus confirmation boundary
  shared/       domain types, errors, utilities
```

`src/index.ts` starts the CLI and does not contain application logic. Each package has a narrow public API so future agents/providers can be added without changing UI code.

## UI and interaction

Use a calm dark interface with an indigo/cyan accent, a compact banner, readable streamed assistant output, distinct user/assistant/tool rows, and a stable status line displaying provider, model, working directory, and context count. Standard terminal expectations apply: Ctrl+C interrupts a request, Ctrl+D exits, non-interactive mode can accept a prompt argument, and all errors tell the user what to do next.

## API architecture

`api/provider.ts` defines the streaming-chat interface. `api/openai-compatible.ts` implements HTTP streaming for OpenAI-compatible APIs. Presets resolve OpenAI and OpenRouter base URLs, headers, and default models. Keys are read only from environment variables or the user config; they are never printed, persisted to a project file, or included in diagnostics.

## Agent contract and context

The system prompt prioritizes direct progress, minimal context, incremental inspection, careful edits, test verification, and honest reporting. The context collector searches upward for `AGENTS.md`, takes a bounded project snapshot, and only reads files when a task needs them. The agent loop stores a bounded history, converts tool results to compact summaries, and stops on cancellation or repeated non-progress.

## Safety and errors

Read-only tools run immediately. Mutating file and shell tools require a preview and explicit approval. Paths are constrained to the working directory. API, configuration, JSON, network, cancellation, and filesystem errors have typed user-facing messages. Ctrl+C cancels the active stream without corrupting the session.

## Quality gates

- Unit tests cover config normalization, provider construction, path protection, slash-command parsing, and system-prompt constraints.
- `bun run typecheck`, `bun test`, and a non-network `bun run smoke` must pass.
- The README documents setup for both OpenAI and OpenRouter and shows the exact run commands.

## Out of scope

Authentication flows, cloud sync, plugins, autonomous destructive execution, multi-agent orchestration, and support for non-OpenAI-compatible protocols are deferred.
