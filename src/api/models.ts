import { VibinError } from "../shared/errors";
import type { ProviderName } from "../shared/types";

export async function listModels(options: { apiKey: string; baseUrl: string; provider: ProviderName }): Promise<string[]> {
  let response: Response;
  try {
    response = await fetch(`${options.baseUrl.replace(/\/$/, "")}/models`, {
      headers: { Authorization: `Bearer ${options.apiKey}`, ...(options.provider === "openrouter" ? { "X-Title": "Vibin" } : {}) },
    });
  } catch (error) { throw new VibinError("Could not retrieve models from this provider.", error instanceof Error ? error.message : undefined); }
  if (!response.ok) throw new VibinError(`Could not retrieve models (${response.status}).`, (await response.text()).slice(0, 240));
  const body = await response.json() as { data?: Array<{ id?: string }> };
  const ids = [...new Set((body.data ?? []).flatMap((model) => typeof model.id === "string" ? [model.id] : []))];
  if (!ids.length) throw new VibinError("This provider did not return any usable models.");
  return ids.sort((a, b) => a.localeCompare(b));
}
