import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { VibinError } from "../shared/errors";
import type { ProviderName } from "../shared/types";

export type ProviderProfile = { provider: ProviderName; apiKey?: string; model: string; baseUrl: string };
export type VibinConfig = ProviderProfile & { profiles: Record<string, ProviderProfile>; activeProfile: string; alwaysAllowedCommands: string[] };
const defaults: Record<Exclude<ProviderName, "compatible">, Omit<ProviderProfile, "provider" | "apiKey">> = {
  openai: { baseUrl: "https://api.openai.com/v1", model: "gpt-4.1-mini" },
  openrouter: { baseUrl: "https://openrouter.ai/api/v1", model: "openai/gpt-4.1-mini" },
  anthropic: { baseUrl: "https://api.anthropic.com", model: "claude-sonnet-4-20250514" },
  codex: { baseUrl: "https://chatgpt.com/backend-api/codex/responses", model: "gpt-5.3-codex" },
};

async function loadDotEnv(cwd: string): Promise<Record<string, string>> {
  const path = join(cwd, ".env"); if (!existsSync(path)) return {};
  const text = await readFile(path, "utf8");
  return Object.fromEntries(text.split(/\r?\n/).flatMap((line) => {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    return match ? [[match[1]!, match[2]!.replace(/^['"]|['"]$/g, "")]] : [];
  }));
}
function defaultProfile(provider: ProviderName = "openai"): ProviderProfile {
  return provider === "compatible" ? { provider, baseUrl: "", model: "" } : { provider, ...defaults[provider] };
}
export function hasUsableApiKey(profile: ProviderProfile): boolean {
  if (!profile.apiKey?.trim()) return false;
  return profile.provider !== "openrouter" || /^sk-or-v1-[^\s]+$/.test(profile.apiKey.trim());
}
function asProfile(value: unknown): ProviderProfile | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Record<string, unknown>;
  if (!["openai", "openrouter", "anthropic", "compatible", "codex"].includes(String(raw.provider)) || typeof raw.model !== "string" || !raw.model.trim() || typeof raw.baseUrl !== "string" || !raw.baseUrl.trim()) return undefined;
  return { provider: raw.provider as ProviderName, model: raw.model, baseUrl: raw.baseUrl, ...(typeof raw.apiKey === "string" ? { apiKey: raw.apiKey } : {}) };
}

export async function loadConfig(cwd: string, dataDir = join(cwd, ".vibin")): Promise<VibinConfig> {
  const env = { ...(await loadDotEnv(cwd)), ...process.env };
  let stored: Record<string, unknown> = {};
  const storedPath = join(dataDir, "config.json");
  if (existsSync(storedPath)) { try { stored = JSON.parse(await readFile(storedPath, "utf8")) as Record<string, unknown>; } catch { throw new VibinError("Could not parse .vibin/config.json.", "Delete or repair the file, then run Vibin again."); } }
  const profiles = Object.fromEntries(Object.entries(stored.profiles && typeof stored.profiles === "object" ? stored.profiles as Record<string, unknown> : {}).flatMap(([name, value]) => { const profile = asProfile(value); return profile ? [[name, profile]] : []; })) as Record<string, ProviderProfile>;
  const alwaysAllowedCommands = Array.isArray(stored.alwaysAllowedCommands) ? [...new Set(stored.alwaysAllowedCommands.filter((command): command is string => typeof command === "string" && Boolean(command.trim())))] : [];
  const envProvider = env.VIBIN_PROVIDER as ProviderName | undefined;
  const envProfile = envProvider ? { ...defaultProfile(envProvider), ...(env.VIBIN_API_KEY ? { apiKey: env.VIBIN_API_KEY } : {}), ...(env.VIBIN_MODEL ? { model: env.VIBIN_MODEL } : {}), ...(env.VIBIN_BASE_URL ? { baseUrl: env.VIBIN_BASE_URL } : {}) } : undefined;
  if (envProfile) profiles.environment = envProfile;
  const activeProfile = envProfile ? "environment" : typeof stored.activeProfile === "string" && profiles[stored.activeProfile] ? stored.activeProfile : Object.keys(profiles)[0] ?? "openai";
  if (!profiles[activeProfile]) profiles[activeProfile] = defaultProfile();
  return { ...profiles[activeProfile]!, profiles, activeProfile, alwaysAllowedCommands };
}
export async function saveConfig(dataDir: string, config: VibinConfig): Promise<void> {
  const directory = dataDir; await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "config.json"), `${JSON.stringify({ activeProfile: config.activeProfile, profiles: config.profiles, alwaysAllowedCommands: config.alwaysAllowedCommands }, null, 2)}\n`, "utf8");
}
export function activateProfile(config: VibinConfig, name: string): VibinConfig {
  const profile = config.profiles[name]; if (!profile) throw new VibinError(`No provider profile named '${name}'.`, "Use /provider list or /provider add.");
  return { ...profile, profiles: config.profiles, activeProfile: name, alwaysAllowedCommands: config.alwaysAllowedCommands };
}
export function removeProfile(config: VibinConfig, name: string): VibinConfig {
  if (!config.profiles[name]) throw new VibinError(`No provider profile named '${name}'.`, "Use /provider list or /provider add.");
  const profiles = { ...config.profiles }; delete profiles[name];
  const nextName = name === config.activeProfile ? Object.keys(profiles)[0] : config.activeProfile;
  if (nextName && profiles[nextName]) return { ...profiles[nextName], profiles, activeProfile: nextName, alwaysAllowedCommands: config.alwaysAllowedCommands };
  return { ...defaultProfile(), profiles, activeProfile: "openai", alwaysAllowedCommands: config.alwaysAllowedCommands };
}
