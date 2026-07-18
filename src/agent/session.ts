import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ChatMessage } from "../shared/types";
import { VibinError } from "../shared/errors";

export type Session = {
  id: string;
  updatedAt: string;
  history: ChatMessage[];
  prompts: string[];
  plan: string | null;
};

const MAX_HISTORY = 20;
const scrub = (value: string | null): string | null => value?.replace(/\b(?:sk|rk)_(?:[A-Za-z0-9_-]{12,})\b|\bsk-[A-Za-z0-9_-]{12,}\b|\bBearer\s+[A-Za-z0-9._-]+\b/gi, "[redacted]") ?? null;
const safeId = (id: string): string => {
  const normalized = id.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  if (!normalized) throw new VibinError("Session name must contain letters or numbers.");
  return normalized.slice(0, 64);
};

export class SessionStore {
  constructor(private readonly cwd: string) {}
  private get folder(): string { return join(this.cwd, ".vibin", "sessions"); }
  private path(id: string): string { return join(this.folder, `${safeId(id)}.json`); }
  async save(session: Session): Promise<Session> {
    const clean: Session = {
      ...session,
      id: safeId(session.id),
      updatedAt: new Date().toISOString(),
      history: session.history.slice(-MAX_HISTORY).map((message) => ({ ...message, content: scrub(message.content), toolCalls: message.toolCalls?.map((call) => ({ ...call, arguments: scrub(call.arguments) ?? "" })) })),
      prompts: session.prompts.slice(-100).map((prompt) => scrub(prompt) ?? ""),
      plan: scrub(session.plan),
    };
    await mkdir(this.folder, { recursive: true });
    await writeFile(this.path(clean.id), JSON.stringify(clean, null, 2), "utf8");
    return clean;
  }
  async load(id: string): Promise<Session> {
    let parsed: unknown;
    try { parsed = JSON.parse(await readFile(this.path(id), "utf8")); }
    catch { throw new VibinError(`Could not load session '${id}'.`, "Use /session list to see saved sessions."); }
    if (!parsed || typeof parsed !== "object") throw new VibinError(`Session '${id}' is invalid.`);
    const data = parsed as Partial<Session>;
    if (typeof data.id !== "string" || !Array.isArray(data.history) || !Array.isArray(data.prompts)) throw new VibinError(`Session '${id}' is invalid.`);
    return { id: safeId(data.id), updatedAt: typeof data.updatedAt === "string" ? data.updatedAt : "unknown", history: data.history as ChatMessage[], prompts: data.prompts.filter((prompt): prompt is string => typeof prompt === "string"), plan: typeof data.plan === "string" ? data.plan : null };
  }
  async list(): Promise<Array<Pick<Session, "id" | "updatedAt" | "plan">>> {
    try {
      const names = await readdir(this.folder);
      return (await Promise.all(names.filter((name) => name.endsWith(".json")).map(async (name) => {
        try { const session = await this.load(name.slice(0, -5)); return { id: session.id, updatedAt: session.updatedAt, plan: session.plan }; }
        catch { return null; }
      }))).filter((session): session is Pick<Session, "id" | "updatedAt" | "plan"> => session !== null);
    } catch { return []; }
  }
  async rename(session: Session, id: string): Promise<Session> {
    const next = safeId(id);
    if (next !== session.id) {
      await mkdir(this.folder, { recursive: true });
      try { await rename(this.path(session.id), this.path(next)); } catch { /* The first named save has no old file yet. */ }
    }
    return { ...session, id: next };
  }
}
