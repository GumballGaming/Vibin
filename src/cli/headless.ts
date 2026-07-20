import { createInterface } from "node:readline";
import { stdin as input } from "node:process";
import type { AssistantMode } from "./ui";

export type AgentEvent =
  | { t: "text"; d: string }
  | { t: "tool"; name: string; summary: string }
  | { t: "info"; m: string }
  | { t: "error"; m: string; h?: string }
  | { t: "assistant_start"; mode: AssistantMode }
  | { t: "assistant_end" }
  | { t: "need_approval"; id: string; kind: "write" | "command" | "tool"; summary: string; command?: string }
  | { t: "ready" }
  | { t: "setup_required" }
  | { t: "done" };

const emit = (event: AgentEvent): void => {
  process.stdout.write(`${JSON.stringify(event)}\n`);
};

export type ApprovalDecision = "allow" | "always" | "reject";

export class HeadlessUI {
  private pending = new Map<string, (decision: string) => void>();
  private promptResolvers: Array<(text: string) => void> = [];
  private readonly reader: ReturnType<typeof createInterface>;
  private seq = 0;
  private ended = false;

  constructor() {
    this.reader = createInterface({ input });
    this.reader.on("line", (line) => this.onLine(line));
    input.on("end", () => {
      this.ended = true;
      this.promptResolvers.forEach((resolve) => resolve("/quit"));
      this.promptResolvers = [];
    });
  }

  private onLine(line: string): void {
    const parts = line.split("\t");
    if (parts[0] === "approve" && parts[1] && parts[2]) {
      const id = parts[1];
      const decision = parts[2];
      const resolve = this.pending.get(id);
      if (resolve) {
        this.pending.delete(id);
        resolve(decision);
      }
    } else if (parts[0] === "prompt") {
      const text = line.slice("prompt\t".length);
      const resolve = this.promptResolvers.shift();
      if (resolve) resolve(text);
    }
  }

  getInput(): Promise<string> {
    if (this.ended) return Promise.resolve("/quit");
    return new Promise((resolve) => this.promptResolvers.push(resolve));
  }

  banner(): void {
    emit({ t: "info", m: "Vibin (headless session started)" });
  }
  status(): void {}
  panel(title: string, body: string): void {
    emit({ t: "info", m: `${title}\n${body}` });
  }
  info(message: string): void {
    emit({ t: "info", m: message });
  }
  error(message: string, hint?: string): void {
    emit({ t: "error", m: message, h: hint });
  }
  startAssistant(mode: AssistantMode = "work"): void {
    emit({ t: "assistant_start", mode });
  }
  text(text: string): void {
    emit({ t: "text", d: text });
  }
  tool(name: string, summary: string): void {
    emit({ t: "tool", name, summary });
  }
  finishAssistant(): void {
    emit({ t: "assistant_end" });
  }
  close(): void {
    this.reader.close();
  }

  private requestApproval(kind: "write" | "command" | "tool", summary: string, command?: string): Promise<string> {
    const id = `a${this.seq++}`;
    emit({ t: "need_approval", id, kind, summary, command });
    return new Promise((resolve) => this.pending.set(id, resolve));
  }

  async confirm(summary: string): Promise<boolean> {
    const decision = await this.requestApproval("tool", summary);
    return decision === "allow" || decision === "always";
  }

  async confirmCommand(command: string): Promise<ApprovalDecision> {
    const decision = await this.requestApproval("command", `Run: ${command}`, command);
    return decision as ApprovalDecision;
  }

  ready(): void {
    emit({ t: "ready" });
  }
  setupRequired(): void {
    emit({ t: "setup_required" });
  }
  done(): void {
    emit({ t: "done" });
  }

  async choose(): Promise<string> {
    throw new Error("Interactive selection is not supported in headless mode. Configure providers via the CLI first.");
  }
  async chooseModel(): Promise<string> {
    throw new Error("Interactive model selection is not supported in headless mode.");
  }
  async secret(): Promise<string> {
    throw new Error("Interactive secret input is not supported in headless mode.");
  }
  async ask(): Promise<string> {
    throw new Error("Interactive input is not supported in headless mode.");
  }
  async multiline(): Promise<string> {
    throw new Error("Interactive input is not supported in headless mode.");
  }
}
