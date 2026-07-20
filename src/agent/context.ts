import { existsSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { VibinError } from "../shared/errors";

const MENTION_FILE_LIMIT = 12_000;
const MENTION_TOTAL_LIMIT = 32_000;
const MENTION_DIRECTORY_ENTRY_LIMIT = 200;

async function directoryTree(directory: string, cwd: string): Promise<string> {
  const entries: string[] = [];
  const walk = async (folder: string): Promise<void> => {
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      if (["node_modules", ".git", ".vibin"].includes(entry.name) || entries.length >= MENTION_DIRECTORY_ENTRY_LIMIT) continue;
      const full = join(folder, entry.name); const rel = relative(cwd, full).split(sep).join("/");
      entries.push(`${entry.isDirectory() ? "d" : "f"} ${rel}${entry.isDirectory() ? "/" : ""}`);
      if (entry.isDirectory()) await walk(full);
    }
  };
  await walk(directory);
  return entries.length ? entries.join("\n") : "(empty directory)";
}

export async function collectProjectInstructions(cwd: string): Promise<string> {
  const pieces: string[] = []; let current = resolve(cwd);
  for (let depth = 0; depth < 5; depth += 1) {
    const file = join(current, "AGENTS.md");
    if (existsSync(file)) pieces.unshift(`Instructions from ${basename(current)}/AGENTS.md:\n${(await readFile(file, "utf8")).slice(0, 8_000)}`);
    const parent = dirname(current); if (parent === current) break; current = parent;
  }
  return pieces.join("\n\n");
}

export async function expandFileMentions(prompt: string, cwd: string): Promise<string> {
  const mentioned = [...prompt.matchAll(/(?:^|\s)@([^\s@]+)/g)].map((match) => match[1]!).filter((path, index, paths) => paths.indexOf(path) === index);
  if (!mentioned.length) return prompt;
  const files: string[] = []; let remaining = MENTION_TOTAL_LIMIT;
  for (const mention of mentioned) {
    const candidate = resolve(cwd, mention); const rel = relative(cwd, candidate);
    if (isAbsolute(rel) || rel === ".." || rel.startsWith(`..${sep}`)) throw new VibinError(`Mentioned file '${mention}' must remain inside the project directory.`);
    let info: Awaited<ReturnType<typeof stat>>;
    try { info = await stat(candidate); }
    catch { throw new VibinError(`Could not read mentioned path '${mention}'.`, "Use a relative path to an existing file or folder."); }
    if (info.isDirectory()) {
      const tree = await directoryTree(candidate, cwd);
      const clipped = tree.length > remaining ? `${tree.slice(0, remaining)}\nâ€¦[truncated]` : tree;
      remaining -= clipped.length;
      files.push(`Explicit directory context: ${rel}/\n${clipped}`);
      continue;
    }
    let text: string;
    try { text = await readFile(candidate, "utf8"); }
    catch { throw new VibinError(`Could not read mentioned file '${mention}'.`, "Use a relative path to an existing UTF-8 file."); }
    const limit = Math.min(MENTION_FILE_LIMIT, remaining);
    if (!limit) break;
    const clipped = text.length > limit ? `${text.slice(0, limit)}\n…[truncated]` : text;
    remaining -= clipped.length;
    files.push(`Explicit file context: ${rel}\n${clipped}`);
  }
  return `${prompt}\n\n${files.join("\n\n")}`;
}
