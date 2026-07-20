import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { VibinError } from "../shared/errors";
import { color } from "./theme";

export type AssistantMode = "work" | "plan";

export function promptNeedsFullRedraw(previous: string, next: string): boolean {
  const hasSuggestions = (value: string): boolean => value.startsWith("/") || (value.split(/\s+/).at(-1) ?? "").startsWith("@");
  return hasSuggestions(previous) || hasSuggestions(next);
}

export function formatPromptFrame(mode: AssistantMode, model: string, cwd: string, value: string): string {
  return `\r\x1b[2K${color.dim(`  ${mode.toUpperCase()} · ${model || "setup required"} · ${cwd}`)}\r\n\r\n\r\x1b[2K${color.cyan(`  ❯ ${value}`)}`;
}

export function formatAssistantHeader(_mode: AssistantMode = "work"): string {
  return "  ✦ Vibin:";
}
export function formatAssistantText(text: string, continuationIndent: number): string {
  return text.replaceAll("\n", `\n${" ".repeat(continuationIndent)}`);
}
export function formatToolStatus(name: string, summary: string): string {
  let args: Record<string, unknown> = {};
  try { args = JSON.parse(summary) as Record<string, unknown>; } catch { /* Specialist reports are already plain text. */ }
  const path = typeof args.path === "string" ? args.path : "";
  if (name === "write_file") return `Writing ${path || "file"}…`;
  if (name === "read_file") return `Reading ${path || "file"}…`;
  if (name === "list_files") return `Listing ${path || "files"}…`;
  if (name === "search_files") return "Searching files…";
  if (name === "run_command") return "Running command…";
  if (name === "spawn_subagent") return "Spawning subagent…";
  if (name === "sub-agent") return `Consulting ${summary}…`;
  return `Using ${name}…`;
}

const visibleLength = (text: string): number => text.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "").length;

export function formatPanel(title: string, body: string): string[] {
  const bodyLines = body.split("\n");
  const contentWidth = Math.max(50, title.length + 2, ...bodyLines.map(visibleLength));
  return [
    `  ┌─ ${title} ${"─".repeat(Math.max(0, contentWidth - title.length - 1))}┐`,
    ...bodyLines.map((line) => `  │ ${line}${" ".repeat(contentWidth - visibleLength(line))} │`),
    `  └${"─".repeat(contentWidth + 2)}┘`,
  ];
}

export function formatColoredPanel(title: string, body: string): string[] {
  const plainLines = formatPanel(title, body);
  const contentWidth = visibleLength(plainLines[0]!) - 6;
  const bodyLines = body.split("\n");
  return [
    color.indigo(plainLines[0]!),
    ...bodyLines.map((line) => `${color.indigo("  \u2502 ")}${line}${" ".repeat(contentWidth - visibleLength(line))}${color.indigo(" \u2502")}`),
    color.indigo(plainLines.at(-1)!),
  ];
}

export class TerminalUI {
  private assistantContinuationIndent = 0;
  private assistantThinking = false;
  private assistantHeaderPending = false;
  private assistantMode: AssistantMode = "work";
  banner(provider: string, model: string, cwd: string): void {
    console.log(`\n${color.indigo(" ██╗   ██╗██╗██████╗ ██╗███╗   ██╗")}`);
    console.log(color.indigo(" ██║   ██║██║██╔══██╗██║████╗  ██║"));
    console.log(`${color.indigo(" ╚██╗ ██╔╝██║██████╔╝██║██╔██╗ ██║")}${color.cyan("  focused coding, beautifully contained")}`);
    console.log(color.indigo("  ╚████╔╝ ██║██╔══██╗██║██║╚██╗██║"));
    console.log(color.indigo("   ╚██╔╝  ██║██████╔╝██║██║ ╚████║"));
    console.log(color.indigo("    ╚═╝   ╚═╝╚═════╝ ╚═╝╚═╝  ╚═══╝"));
    console.log(color.dim(`\n  ${provider} · ${model} · ${cwd}\n`));
  }
  status(provider: string, model: string, cwd: string): void { console.log(color.dim(`\n  ${provider} · ${model} · ${cwd} · /help for commands\n`)); }
  async prompt(workspaceFiles: string[] = [], model = "", cwd = "", mode: AssistantMode = "work", toggleMode?: () => AssistantMode): Promise<string> {
    if (!input.isTTY) return this.ask("❯");
    const width = 48;
    const options: Array<[string, string]> = [
      ["/help", "see all commands"], ["/files", "browse workspace"], ["/read", "open a file"],
      ["/search", "find text"], ["/provider", "manage AI providers"], ["/model", "change active model"],
      ["/thinking", "set thinking depth"],
      ["/status", "view session details"], ["/clear", "clear session context"], ["/compact", "summarize session context"],
      ["/exit", "exit Vibin"],
    ];
    const innerWidth = width - 6;
    const fit = (text: string) => text.length > innerWidth ? `${text.slice(0, innerWidth - 1)}…` : text.padEnd(innerWidth);
    let value = ""; let hasPromptDetails = false; let activeToken = ""; let suggestions: Array<[string, string]> = [];
    const clearSuggestions = () => {
      if (hasPromptDetails) output.write("\x1b[2A\r\x1b[J");
    };
    const draw = () => {
      clearSuggestions();
      activeToken = value.split(/\s+/).at(-1) ?? "";
      const commandMatches = value.startsWith("/") ? options.filter(([command]) => command.startsWith(value.split(/\s/, 1)[0] || "/")).slice(0, 4) : [];
      const fileMatches = activeToken.startsWith("@") ? workspaceFiles.filter((file) => file.toLowerCase().includes(activeToken.slice(1).toLowerCase())).slice(0, 4).map((file) => [`@${file}`, "workspace file"] as [string, string]) : [];
      const matches = commandMatches.length ? commandMatches : fileMatches;
      suggestions = matches;
      const suggestionLabel = fileMatches.length ? "files" : "commands";
      output.write(formatPromptFrame(mode, model, cwd, value));
      if (matches.length) {
        const lines = [
          `${color.dim(`  ┌─ ${suggestionLabel} `)}${color.dim("─".repeat(width - suggestionLabel.length - 7))}${color.dim("┐")}`,
          ...matches.map(([command, description]) => `  ${color.dim("│")} ${color.cyan(fit(`${command}  ${description}`))}${color.dim(" │")}`),
          color.dim(`  └${"─".repeat(width - 4)}┘`),
        ];
        for (const line of lines) output.write(`\r\n${line}`);
      }
      // Return to the end of the editable prompt, not column 0. Leaving the
      // cursor at column 0 makes the terminal's block cursor cover the prompt.
      const renderedSuggestionLines = matches.length ? matches.length + 2 : 0;
      if (renderedSuggestionLines) output.write(`\x1b[${renderedSuggestionLines}A\r\x1b[${4 + value.length}C`);
      hasPromptDetails = true;
    };
    draw(); input.setRawMode(true); input.resume();
    return new Promise((resolve) => {
      const finish = (answer: string) => {
        clearSuggestions(); output.write(formatPromptFrame(mode, model, cwd, value));
        input.off("data", onData); input.setRawMode(false); output.write("\r\n"); resolve(answer);
      };
      const onData = (chunk: Buffer) => {
        const key = chunk.toString("utf8");
        if (key === "\r" || key === "\n") finish(value.trim());
        else if (key === "\u0003") finish("/quit");
        else if (key === "\t") {
          if (suggestions.length) {
            const completion = suggestions[0]![0];
            value = `${value.slice(0, value.length - activeToken.length)}${completion}`;
            draw();
          } else if (toggleMode && !value.startsWith("/") && !activeToken.startsWith("@")) {
            mode = toggleMode();
            draw();
          }
        }
        else if (key === "\u007f" || key === "\b") {
          if (value) {
            const previous = value;
            value = value.slice(0, -1);
            if (promptNeedsFullRedraw(previous, value)) draw();
            else output.write("\b \b");
          }
        }
        else if (!key.startsWith("\u001b") && key >= " ") {
          const previous = value;
          value += key;
          if (promptNeedsFullRedraw(previous, value)) draw();
          else output.write(color.cyan(key));
        }
      };
      input.on("data", onData);
    });
  }
  async ask(label: string): Promise<string> {
    const rl = createInterface({ input, output, terminal: true });
    try { return (await rl.question(`  ${label} `)).trim(); }
    finally { rl.close(); }
  }
  async multiline(label: string): Promise<string> {
    this.info(`${label} (finish with a line containing only .)`);
    const rl = createInterface({ input, output, terminal: true }); const lines: string[] = [];
    try {
      for await (const line of rl) { if (line === ".") break; lines.push(line); }
      return lines.join("\n");
    } finally { rl.close(); }
  }
  async choose(title: string, entries: Array<{ label: string; detail: string; value: string }>): Promise<string> {
    while (true) {
      this.panel(title, entries.map((entry, index) => `${color.cyan(String(index + 1).padStart(2))}  ${entry.label}\n    ${color.dim(entry.detail)}`).join("\n"));
      const answer = await this.ask("Choose:"); const index = Number(answer);
      if (Number.isInteger(index) && index >= 1 && index <= entries.length) return entries[index - 1]!.value;
      this.error("Choose one of the numbered options.");
    }
  }
  async chooseModel(models: string[]): Promise<string> {
    if (!input.isTTY) throw new VibinError("Interactive model selection requires a terminal.");
    const width = Math.max(42, Math.min(process.stdout.columns || 76, 76));
    let search = ""; let selected = -1; let renderedLines = 0;
    const draw = () => {
      const filtered = models.filter((model) => model.toLowerCase().includes(search.toLowerCase()));
      if (selected >= filtered.length) selected = filtered.length - 1;
      const start = Math.max(0, Math.min(selected - 4, Math.max(0, filtered.length - 9)));
      const shown = filtered.slice(start, start + 9);
      if (renderedLines) output.write(`\r\x1b[${renderedLines - 1}A\x1b[J`);
      output.write(color.indigo(`  ┌─ CHOOSE A MODEL ${"─".repeat(width - 21)}┐\n`));
      output.write(`  ${color.indigo("│")} ${color.dim("Search:")} ${search || color.dim("type to filter models")}${selected < 0 ? color.cyan("▌") : ""}`);
      output.write(`\n${color.dim(`  ├${"─".repeat(width - 3)}┤`)}`);
      if (!shown.length) output.write(`\n  ${color.indigo("│")} ${color.dim("No matching models")}`);
      for (let index = 0; index < shown.length; index += 1) {
        const active = start + index === selected; const marker = active ? color.cyan("❯") : color.dim(" ");
        output.write(`\n  ${color.indigo("│")} ${marker} ${active ? color.bold(shown[index]!) : shown[index]}`);
      }
      output.write(`\n${color.dim(`  ├${"─".repeat(width - 3)}┤`)}`);
      output.write(`\n  ${color.indigo("│")} ${color.dim(`${filtered.length} matching · ↑↓ move · Enter select · Esc cancel`)}`);
      output.write(`\n${color.indigo(`  └${"─".repeat(width - 3)}┘`)}`);
      renderedLines = 6 + Math.max(1, shown.length);
      return filtered;
    };
    let filtered = draw(); input.setRawMode(true); input.resume();
    return new Promise((resolve, reject) => {
      const finish = () => { input.off("data", onData); input.setRawMode(false); output.write("\n"); };
      const onData = (chunk: Buffer) => {
        const key = chunk.toString("utf8");
        if (key === "\r" || key === "\n") { const model = filtered[selected] ?? filtered[0]; if (model) { finish(); resolve(model); } }
        else if (key === "\u001b[A") { selected = selected < 0 ? filtered.length - 1 : Math.max(0, selected - 1); filtered = draw(); }
        else if (key === "\u001b[B") { selected = selected < 0 ? 0 : Math.min(Math.max(0, filtered.length - 1), selected + 1); filtered = draw(); }
        else if (key === "\u007f" || key === "\b") { if (search) { search = search.slice(0, -1); selected = -1; filtered = draw(); } }
        else if (key === "\u0003" || key === "\u001b") { finish(); reject(new VibinError("Model selection cancelled.")); }
        else if (!key.startsWith("\u001b") && key >= " ") { search += key; selected = -1; filtered = draw(); }
      };
      input.on("data", onData);
    });
  }
  async secret(label: string): Promise<string> {
    if (!input.isTTY) return this.ask(label);
    output.write(`  ${label} `); input.setRawMode(true); input.resume();
    return new Promise((resolve) => {
      let value = "";
      const finish = (answer: string) => { input.off("data", onData); input.setRawMode(false); output.write("\n"); resolve(answer); };
      const onData = (chunk: Buffer) => {
        const key = chunk.toString("utf8");
        if (key === "\r" || key === "\n") finish(value.trim());
        else if (key === "\u0003") finish("");
        else if (key === "\u007f" || key === "\b") { if (value) { value = value.slice(0, -1); output.write("\b \b"); } }
        else if (!key.startsWith("\u001b")) { value += key; output.write("•"); }
      };
      input.on("data", onData);
    });
  }
  startAssistant(mode: AssistantMode = "work"): void {
    this.assistantMode = mode;
    const header = formatAssistantHeader(mode);
    this.assistantContinuationIndent = header.length + 1;
    this.assistantThinking = true;
    this.assistantHeaderPending = false;
    process.stdout.write(`\n${color.indigo(header)} ${color.dim("Thinking…")}`);
  }
  text(text: string): void {
    if (this.assistantThinking) {
      this.assistantThinking = false;
      process.stdout.write(`\r\x1b[2K${color.indigo(formatAssistantHeader(this.assistantMode))} `);
    } else if (this.assistantHeaderPending) {
      this.assistantHeaderPending = false;
      process.stdout.write(`\n${color.indigo(formatAssistantHeader(this.assistantMode))} `);
    }
    process.stdout.write(formatAssistantText(text, this.assistantContinuationIndent));
  }
  tool(name: string, summary: string): void {
    if (this.assistantThinking) process.stdout.write("\r\x1b[2K");
    this.assistantThinking = false;
    this.assistantHeaderPending = true;
    process.stdout.write(`\n  ${color.dim("◌")} ${formatToolStatus(name, summary)}\n`);
  }
  finishAssistant(): void { this.assistantContinuationIndent = 0; this.assistantThinking = false; this.assistantHeaderPending = false; process.stdout.write("\n\n"); }
  async confirm(summary: string): Promise<boolean> { return /^(y|yes)$/i.test(await this.ask(`${color.yellow("approve")} ${summary} ${color.dim("[y/N]")}`)); }
  async confirmCommand(command: string): Promise<"allow" | "always" | "reject"> {
    return this.choose("COMMAND APPROVAL", [
      { value: "allow", label: "Allow once", detail: `Run: ${command}` },
      { value: "always", label: "Always allow", detail: "Allow this exact command in future Vibin sessions for this project." },
      { value: "reject", label: "Reject", detail: "Do not run this command." },
    ]) as Promise<"allow" | "always" | "reject">;
  }
  info(message: string): void { console.log(`  ${message}`); }
  panel(title: string, body: string): void {
    console.log();
    for (const line of formatColoredPanel(title, body)) console.log(line);
  }
  error(message: string, hint?: string): void { console.error(`\n  ${color.red("error")} ${message}${hint ? `\n  ${color.dim(hint)}` : ""}\n`); }
  close(): void { /* Each cooked-mode prompt owns and closes its own readline interface. */ }
}
