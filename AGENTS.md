# Vibin contributor guide

Vibin is a Bun + TypeScript CLI coding agent. Keep changes small, typed, tested, and modular.

## Boundaries

- `src/api`: network providers and streaming protocol only.
- `src/agent`: orchestration, system prompt, session/context policy.
- `src/cli`: display and user input only; no provider logic.
- `src/tools`: file/shell operations, with approval for mutations.
- `src/config`: parsing and validation only.
- `src/shared`: cross-cutting types and utility functions.

## Guardrails

- Do not print or persist secrets.
- Keep repository context bounded; inspect files only when needed.
- Require explicit confirmation before writes or shell commands.
- Run `bun run typecheck`, `bun test`, and `bun run smoke` after changes.
