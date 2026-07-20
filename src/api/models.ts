import { VibinError } from "../shared/errors";
import type { ProviderName } from "../shared/types";
import { CODEX_ENDPOINT, CodexAuth } from "./codex-auth";

export const CODEX_MODELS_ENDPOINT = `${new URL(CODEX_ENDPOINT).origin}/backend-api/models`;

export async function listModels(options: { apiKey: string; baseUrl: string; provider: ProviderName }): Promise<string[]> {
  let response: Response;
  try {
    const headers: Record<string, string> = options.provider === "anthropic"
      ? { "x-api-key": options.apiKey.trim(), "anthropic-version": "2023-06-01" }
      : { Accept: "application/json", Authorization: `Bearer ${options.apiKey.trim()}`, ...(options.provider === "openrouter" ? { "X-OpenRouter-Title": "Vibin" } : {}) };
    response = await fetch(`${options.baseUrl.replace(/\/$/, "")}${options.provider === "anthropic" ? "/v1/models" : "/models"}`, { headers,
    });
  } catch (error) { throw new VibinError("Could not retrieve models from this provider.", error instanceof Error ? error.message : undefined); }
  if (!response.ok) throw new VibinError(`Could not retrieve models (${response.status}).`, (await response.text()).slice(0, 240));
  const body = await response.json() as { data?: Array<{ id?: string }> };
  const ids = [...new Set((body.data ?? []).flatMap((model) => typeof model.id === "string" ? [model.id] : []))];
  if (!ids.length) throw new VibinError("This provider did not return any usable models.");
  return ids.sort((a, b) => a.localeCompare(b));
}

export async function listCodexModels(auth: Pick<CodexAuth, "accessToken">): Promise<string[]> {
  const credential = await auth.accessToken();
  let response: Response;
  try {
    response = await fetch(CODEX_MODELS_ENDPOINT, {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${credential.access}`,
        ...(credential.accountId ? { "ChatGPT-Account-Id": credential.accountId } : {}),
        originator: "vibin",
        "User-Agent": "vibin/0.1.0",
      },
    });
  } catch (error) {
    throw new VibinError("Could not retrieve models from ChatGPT.", error instanceof Error ? error.message : undefined);
  }
  if (!response.ok) throw new VibinError(`Could not retrieve ChatGPT models (${response.status}).`, (await response.text()).slice(0, 240));
  const body = await response.json() as { data?: Array<{ id?: string; slug?: string; name?: string }>; models?: Array<{ id?: string; slug?: string; name?: string }> };
  const entries = body.data ?? body.models ?? [];
  const ids = [...new Set(entries.flatMap((model) => {
    const id = model.id ?? model.slug ?? model.name;
    return typeof id === "string" ? [id] : [];
  }))];
  if (!ids.length) throw new VibinError("ChatGPT did not return any usable models.");
  return ids.sort((a, b) => a.localeCompare(b));
}
