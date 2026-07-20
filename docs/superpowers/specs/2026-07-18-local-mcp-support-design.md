# Local MCP Support Design

## Goal

Add local stdio Model Context Protocol (MCP) support to Vibin. Users can import standard MCP JSON, assign their own Vibin-specific server names, manage global and project configurations, and let the agent discover and call external MCP tools.

## Scope

The first release supports:

- Local stdio MCP servers only.
- MCP tools only.
- `vibin mcp add [json-file]`.
- `vibin mcp list`.
- `vibin mcp remove`.
- Global and project-specific MCP configuration.
- Per-server approval policy.

It does not support remote HTTP/SSE transports, MCP resources, MCP prompts, sampling, elicitation, OAuth, or a connection-test command.

## Configuration Format and Storage

MCP configuration is stored separately from provider configuration in an `mcp.json` file. Global configuration lives in Vibin's user data directory. Project configuration lives in the current project's `.vibin` directory.

Launch trust is stored only in Vibin's user data directory, never inside the project. This prevents a checked-out repository from granting trust to itself. Trust records contain canonical project identities and server configuration fingerprints, not executable configuration copies or environment values.

Both files use this shape:

```json
{
  "mcpServers": {
    "Roblox Studio": {
      "command": "cmd.exe",
      "args": [
        "/c",
        "cd /d %LOCALAPPDATA%\\Roblox && .\\mcp.bat"
      ],
      "autoApprove": false
    }
  }
}
```

Supported server properties are:

- `command`: required non-empty string.
- `args`: optional array of strings; defaults to an empty array.
- `env`: optional string-to-string map passed to the child process.
- `cwd`: optional working directory for the child process.
- `autoApprove`: optional boolean; defaults to `false`.

Project servers override global servers with the same user-chosen name. Configuration validation rejects malformed JSON, blank names, blank commands, invalid argument arrays, invalid environment maps, and invalid approval values. Diagnostics never print environment values.

## CLI Experience

### Add

`vibin mcp add` launches an interactive setup. The user chooses global or project scope, pastes multiline JSON, and ends input with a line containing only a single period (`.`). Blank lines are preserved as input and never terminate entry. Vibin also accepts the platform's normal end-of-input shortcut where practical. `vibin mcp add path/to/file.json` reads the JSON from that file instead.

The importer accepts either a raw server definition representing exactly one server or an object containing a non-empty `mcpServers` object with one or more entries. Imported entries are processed in their original object order. Names in imported JSON are never used as Vibin server names; they are shown only as temporary labels so the user knows which entry they are naming. Vibin asks the user to name every imported server.

All imported server definitions are validated before prompting or writing. The complete import remains in memory until naming and replacement decisions finish. If the user cancels during a multi-server import, Vibin asks whether to save the entries completed so far; without explicit confirmation, nothing from that import is written.

The chosen name is used in lists, approvals, activity messages, errors, and tool namespaces. If that name already exists in the selected scope, Vibin asks whether to replace it. Declining leaves the existing server unchanged.

### List

`vibin mcp list` shows the effective merged server list. Each row includes the user-chosen name, source scope, command, and whether calls require approval. Environment values are omitted.

When a project definition overrides a global definition, the effective project entry is shown and marked as an override.

### Remove

`vibin mcp remove` shows configured entries and asks which source entry to remove. Removing a project override may reveal a same-named global server. The command requests confirmation before writing the updated configuration.

### Atomic writes

Add and remove operations build and validate the complete updated configuration in memory before touching disk. When a write is required, Vibin creates missing parent directories, writes a uniquely named temporary file beside `mcp.json`, flushes it, closes it, and renames it over the destination. A failed write or rename leaves the original configuration intact and cleans up the temporary file when possible. Direct partial writes to `mcp.json` are not allowed.

## Runtime Architecture

### MCP configuration module

A module under `src/config` parses, validates, loads, merges, adds, and removes MCP configuration. It performs configuration work only and does not spawn processes.

### MCP client manager

A module under `src/tools` owns the official stable MCP TypeScript SDK v1 clients and stdio transports. It:

1. Starts each effective server only after the launch-trust layer approves it.
2. Negotiates the MCP connection.
3. Lists available tools.
4. Preserves or safely converts MCP JSON Schema input schemas into Vibin `ToolDefinition` values.
5. Routes tool calls to the correct client.
6. Converts MCP content results to bounded text for the agent.
7. Closes all clients when Vibin exits.

Initialization returns structured data without constructing an agent prompt:

```ts
interface McpInitializationResult {
  tools: ToolDefinition[];
  instructions: McpServerInstruction[];
  warnings: McpWarning[];
}
```

Servers initialize concurrently with a fixed concurrency limit of four. Each connection has an internal ten-second timeout for the first release. The manager accepts an internal timeout option for tests and embedding, but this value is not exposed in `mcp.json` or the CLI in the first release. One server failing or timing out produces one concise, secret-safe warning and does not prevent other servers or Vibin itself from starting. The result contains every tool successfully initialized from the remaining servers. Tool-call failures return a bounded text error result to the agent rather than throwing through the session loop.

### Project and server launch trust

No MCP child process starts before launch trust is resolved. Project-scoped MCP servers require two independent gates:

1. The current project must be explicitly trusted for MCP launch. The trust prompt identifies the canonical project path and explains that its local MCP configuration may start processes. Declining skips all project-scoped MCP servers for that session. Global MCP servers do not require project trust.
2. Every new or changed effective server requires a first-run confirmation before its process starts.

The server confirmation shows the user-selected server name, source scope, command, complete argument list, effective working directory, and environment variable names only. Environment values are never displayed. Long fields are bounded with a visible truncation marker, without changing the actual launch configuration.

Vibin computes the server trust fingerprint from the server scope, canonical project identity when project-scoped, user-selected server name, command, ordered arguments, effective `cwd`, and the complete environment map including names and values. Any change to `command`, `args`, `cwd`, or `env` therefore invalidates the prior fingerprint and requires confirmation again. New servers have no trusted fingerprint and always require confirmation. Trust records store only a cryptographic fingerprint and identifying metadata; they do not copy environment values.

Changing `autoApprove` does not grant launch trust and does not bypass either gate. Launch trust controls whether a process may start; `autoApprove` controls whether individual tool calls require confirmation after a trusted server has started. These decisions remain separate in storage, UI, and code.

Declining a server confirmation skips that server for the session without starting it and without blocking other trusted servers. Accepting records the fingerprint in the user trust store using the same atomic-write discipline as MCP configuration. A changed server replaces its prior trusted fingerprint only after confirmation.

### Tool names

External tools use `mcp__<server-name>__<tool-name>`. For both segments, sanitization keeps ASCII letters and digits, replaces every sequence of unsupported characters with one underscore, collapses repeated underscores, removes leading and trailing underscores, and rejects an empty result. Original letter casing is preserved for both display and namespace generation.

Configuration stores only the user-selected display name, never a sanitized name. Namespaces are derived at runtime. Collision detection is case-insensitive; a warning names both conflicting source server/tool pairs, and the later conflicting tool is not registered.

For example, a user-chosen name of `Roblox Studio` and an MCP tool named `run-script` become `mcp__Roblox_Studio__run_script`.

### Agent integration

The agent layer receives `McpInitializationResult`, combines built-in tool definitions with discovered MCP definitions for normal work-mode requests, appends labeled MCP instructions, and reports warnings. Planning mode remains tool-free. Built-in tools continue routing to `ToolRunner`; namespaced MCP tools route to the MCP client manager. Prompt construction remains entirely outside the MCP manager.

Before an MCP call, Vibin shows the user-selected server name, original MCP tool name, sanitized registered tool name, and bounded structured arguments. Calls require confirmation unless that server has `autoApprove: true`. Approval is evaluated from the effective merged server definition.

Approval previews limit nesting to six levels, arrays to twenty displayed items, strings to 500 characters, and total output to 4,000 characters. Preview serialization protects against circular values. Values are replaced with `[REDACTED]` when their key case-insensitively equals `token`, `password`, `passwd`, `secret`, `apiKey`, `api_key`, `authorization`, `cookie`, `privateKey`, or `private_key`, or contains one of those spellings as a segment separated by a non-alphanumeric character. Redaction affects display only; after approval, the original unmodified arguments are sent to the MCP server. Subagents do not receive MCP tools in the first release.

### Schema compatibility

MCP input schemas are JSON Schema. Vibin preserves the original schema whenever the active provider's tool format supports it directly. When provider compatibility requires conversion, the converter supports ordinary object schemas, properties, required fields, arrays, enums, primitive types, descriptions, defaults, and nested objects.

`$ref`, `oneOf`, `anyOf`, `allOf`, tuple arrays, and unsupported schema keywords are handled conservatively. Conversion must never broaden a schema so an unsafe argument appears valid. If a schema cannot be represented safely, that MCP tool is skipped with a concise warning naming its server and original tool; other tools from the same server remain registered.

### Result flattening and limits

MCP content item order is preserved. Text content becomes text directly. Structured content becomes compact JSON. Image, audio, binary, embedded-resource, and unsupported content becomes a short descriptive placeholder rather than raw data. Tool errors become bounded text error results and do not throw through the agent session loop.

Implementation uses named constants with these first-release values:

- `MCP_MAX_CONTENT_ITEM_TEXT = 16_000` characters.
- `MCP_MAX_COMBINED_RESULT = 48_000` characters.
- `MCP_MAX_ERROR_TEXT = 2_000` characters.
- `MCP_MAX_SERVER_INSTRUCTIONS = 8_000` characters per server.
- `MCP_MAX_COMBINED_INSTRUCTIONS = 24_000` characters.
- `MCP_MAX_APPROVAL_PREVIEW = 4_000` characters.
- `MCP_CONNECTION_TIMEOUT_MS = 10_000` milliseconds per server.
- `MCP_INITIALIZATION_CONCURRENCY = 4` servers.
- `MCP_SHUTDOWN_TIMEOUT_MS = 5_000` milliseconds total.

Bounds are applied before content enters conversation context, prompts, warnings, approval UI, or logs. Truncated tool results end with a visible `[MCP result truncated]` marker; other truncated fields use an equally explicit field-specific marker.

### Server instructions

Each instruction block is labeled with the user-selected server name, bounded separately to `MCP_MAX_SERVER_INSTRUCTIONS`, and included in a combined MCP section bounded to `MCP_MAX_COMBINED_INSTRUCTIONS`. The agent system prompt identifies these as untrusted external instructions subordinate to Vibin's own system and safety rules.

The MCP manager may parse and bound instructions but does not construct or modify the system prompt. Malformed or oversized instructions produce a bounded or omitted instruction block without preventing that server's valid tools from registering.

## Lifecycle

Configured servers are merged first, then project trust and per-server fingerprint trust are resolved, and only then are approved servers initialized. Trusted servers connect once during interactive application startup and remain available for the session. An untrusted, declined, failed, or timed-out server is skipped for that session. Warnings name the server and concise reason but never include environment values or full child-process output.

Vibin calls an idempotent `closeAll()` in its application `finally` path. Calling it repeatedly is safe. Clients and transports are closed independently so one failure cannot block the others. The transport wrapper retains the process-control handle needed for forced termination. Shutdown has a total five-second timeout; after it expires, remaining local stdio child processes are forcibly terminated. Shutdown errors are bounded and never prevent Vibin from exiting.

One-shot prompts also initialize configured MCP servers and close them after the response. MCP management commands do not start the interactive application or connect to servers.

## Security and Approvals

- External MCP calls require approval by default because Vibin cannot infer whether an arbitrary external tool mutates data.
- `autoApprove: true` is an explicit per-server tool-call approval decision, not launch trust.
- Project launch trust and per-server launch trust are required before applicable MCP processes start.
- Launch trust is stored outside the project and cannot be supplied by project configuration.
- Every new server and every change to command, ordered arguments, working directory, or environment invalidates server launch trust.
- Server launch confirmations show environment variable names only, never their values.
- Launch trust and `autoApprove` are independent; neither implies the other.
- Commands are passed directly to the stdio transport rather than concatenated into an additional shell command.
- Imported configuration is data, not executed during setup.
- Environment values are never displayed in lists, errors, or logs.
- MCP results and errors are bounded before entering conversation context.
- Approval previews are bounded, depth-limited, circular-safe, and redact secret-looking fields without modifying actual arguments.
- No remote transport is accepted in this release.

## Error Handling

- Invalid command syntax prints MCP-specific usage.
- Invalid JSON reports the parse failure without echoing the full input.
- Invalid server definitions identify the entry and invalid field.
- Empty `mcpServers` objects are rejected.
- Missing import files return a concise path error.
- Startup failures identify the user-chosen server without exposing environment values.
- Declined project trust skips every project-scoped server without starting a process.
- Declined or stale server trust skips only that server without starting it.
- Duplicate effective tool names are detected case-insensitively, skipped, and reported with both conflicting sources.
- Unsupported individual tool schemas skip only those tools.
- Tool errors return bounded text to the agent rather than escaping the session loop.
- Removal of a missing entry leaves configuration unchanged.
- Add/remove write failures preserve the original configuration.

## Testing

Tests cover:

- CLI routing for add, list, and remove.
- Standard `mcpServers` imports and raw single-server imports.
- Period-terminated multiline input, embedded blank lines, and practical platform EOF handling.
- Empty imports, original entry order, validate-before-write, and cancellation without accidental partial writes.
- Mandatory user naming independent of imported keys.
- Validation and secret-safe errors.
- Global/project merging and project override behavior.
- Duplicate-name replacement decisions.
- Atomic add/remove writes, failure preservation, and delayed directory creation.
- Tool-name sanitization and collision handling.
- Case-insensitive collisions that report both sources without persisting sanitized names.
- Supported schema preservation/conversion, unsupported constructs, and partial tool registration.
- Ordered result flattening, placeholders, error results, and every named size limit.
- Default approval and `autoApprove` routing.
- Approval preview bounds, circular protection, redaction, and unmodified dispatched arguments.
- Concurrent initialization, connection timeouts, bounded concurrency, and partial startup failure isolation.
- Project trust storage outside the repository and project-wide launch denial.
- First-run server confirmation before spawn, including command, ordered arguments, working directory, and environment names only.
- Fingerprint stability, invalidation on command/argument/cwd/environment changes, and environment-value sensitivity without disclosure.
- Separation between launch trust and `autoApprove`, including changes to either setting.
- Instruction labeling, per-server/combined bounds, malformed instructions, and prompt-layer construction.
- Normal shutdown, repeated shutdown, one broken client, shutdown timeout, and a process that refuses to exit.
- Agent dispatch between built-in and MCP tools.

After implementation, run `bun run typecheck`, `bun test`, and `bun run smoke`. Do not mark implementation complete unless all three commands exit successfully. If any command fails, report that exact command and a concise failure reason.
