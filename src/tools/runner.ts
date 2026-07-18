import { readdir, readFile, writeFile } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { VibinError } from "../shared/errors";

export type Confirm = (summary: string) => Promise<boolean>;
export type CommandApproval = "allow" | "always" | "reject";
export type ConfirmCommand = (command: string) => Promise<CommandApproval>;
const truncate = (text: string, max = 12_000) => text.length > max ? `${text.slice(0, max)}\n…[truncated]` : text;

export class ToolRunner {
  constructor(private readonly cwd: string, private readonly confirm: Confirm, private readonly confirmCommand: ConfirmCommand = async () => "reject", private readonly alwaysAllowedCommands = new Set<string>(), private readonly onAlwaysAllowed: (command: string) => Promise<void> = async () => {}) {}
  private path(input: unknown): string {
    if (typeof input !== "string" || !input) throw new VibinError("Tool requires a path.");
    const candidate = resolve(this.cwd, input); const rel = relative(this.cwd, candidate);
    if (isAbsolute(rel) || rel.startsWith(`..${sep}`) || rel === "..") throw new VibinError("Path must remain inside the project directory.");
    return candidate;
  }
  async run(name: string, raw: string): Promise<string> {
    let args: Record<string, unknown>;
    try { args = JSON.parse(raw) as Record<string, unknown>; } catch { throw new VibinError(`Invalid arguments for ${name}.`); }
    switch (name) {
      case "list_files": return (await readdir(this.path(args.path ?? "."), { withFileTypes: true })).slice(0, 200).map((entry) => `${entry.isDirectory() ? "d" : "f"} ${entry.name}`).join("\n");
      case "read_file": return truncate(await readFile(this.path(args.path), "utf8"));
      case "search_files": return this.search(String(args.query ?? ""));
      case "write_file": {
        const target = this.path(args.path); const content = String(args.content ?? "");
        if (!(await this.confirm(`Write ${relative(this.cwd, target)} (${content.length} characters)?`))) return "User declined the file write.";
        await writeFile(target, content, "utf8"); return `Wrote ${relative(this.cwd, target)}.`;
      }
      case "run_command": {
        const command = String(args.command ?? ""); if (!command) throw new VibinError("Command cannot be empty.");
        if (!this.alwaysAllowedCommands.has(command)) {
          const approval = await this.confirmCommand(command);
          if (approval === "reject") return "User declined the command.";
          if (approval === "always") { this.alwaysAllowedCommands.add(command); await this.onAlwaysAllowed(command); }
        }
        const proc = Bun.spawn({ cmd: process.platform === "win32" ? ["powershell", "-NoProfile", "-Command", command] : ["sh", "-lc", command], cwd: this.cwd, stdout: "pipe", stderr: "pipe" });
        const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
        return truncate(`exit ${code}\n${out}${err ? `\nSTDERR:\n${err}` : ""}`);
      }
      default: throw new VibinError(`Unknown tool: ${name}`);
    }
  }
  async runReadOnly(name: string, raw: string): Promise<string> {
    if (!["list_files", "read_file", "search_files"].includes(name)) throw new VibinError(`Subagents cannot use '${name}'.`);
    return this.run(name, raw);
  }
  async workspaceFiles(): Promise<string[]> {
    const files: string[] = [];
    const walk = async (folder: string): Promise<void> => {
      for (const entry of await readdir(folder, { withFileTypes: true })) {
        if (["node_modules", ".git", ".vibin"].includes(entry.name)) continue;
        const full = resolve(folder, entry.name);
        if (entry.isDirectory()) {
          if (files.length < 500) files.push(`${relative(this.cwd, full).split(sep).join("/")}/`);
          await walk(full);
        }
        else if (files.length < 500) files.push(relative(this.cwd, full).split(sep).join("/"));
      }
    };
    await walk(this.cwd);
    return files.sort();
  }
  private async search(query: string): Promise<string> {
    if (!query) throw new VibinError("Search query cannot be empty.");
    const hits: string[] = [];
    const walk = async (folder: string): Promise<void> => {
      for (const entry of await readdir(folder, { withFileTypes: true })) {
        if (["node_modules", ".git", ".vibin"].includes(entry.name)) continue;
        const full = resolve(folder, entry.name);
        if (entry.isDirectory()) await walk(full);
        else if (hits.length < 100) { try { const text = await readFile(full, "utf8"); text.split(/\r?\n/).forEach((line, i) => { if (line.includes(query) && hits.length < 100) hits.push(`${relative(this.cwd, full)}:${i + 1}: ${line.trim().slice(0, 300)}`); }); } catch {} }
      }
    };
    await walk(this.cwd); return hits.length ? hits.join("\n") : "No matches.";
  }
}
