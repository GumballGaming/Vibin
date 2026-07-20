import { expect, test } from "bun:test";
import { CODEX_MODELS_ENDPOINT, listCodexModels, listModels } from "../src/api/models";

test("uses the current OpenRouter model-list request shape", async () => {
  const originalFetch = globalThis.fetch;
  let requestedUrl = "";
  let requestedHeaders: HeadersInit | undefined;
  globalThis.fetch = (async (input, init) => {
    requestedUrl = String(input);
    requestedHeaders = init?.headers;
    return new Response(JSON.stringify({ data: [{ id: "openai/gpt-5.2" }] }), { status: 200 });
  }) as typeof fetch;
  try {
    await expect(listModels({ apiKey: "  sk-or-test  ", baseUrl: "https://openrouter.ai/api/v1", provider: "openrouter" })).resolves.toEqual(["openai/gpt-5.2"]);
    expect(requestedUrl).toBe("https://openrouter.ai/api/v1/models");
    expect(new Headers(requestedHeaders).get("authorization")).toBe("Bearer sk-or-test");
    expect(new Headers(requestedHeaders).get("x-openrouter-title")).toBe("Vibin");
    expect(new Headers(requestedHeaders).get("x-title")).toBeNull();
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("lists models from the authenticated ChatGPT subscription endpoint", async () => {
  const originalFetch = globalThis.fetch;
  let requestedUrl = "";
  let requestedHeaders: HeadersInit | undefined;
  globalThis.fetch = (async (input, init) => {
    requestedUrl = String(input);
    requestedHeaders = init?.headers;
    return new Response(JSON.stringify({ data: [{ slug: "gpt-5.3-codex" }, { name: "gpt-5.2" }, { id: "gpt-5.3-codex" }] }), { status: 200 });
  }) as typeof fetch;
  try {
    const models = await listCodexModels({ accessToken: async () => ({ access: "access-token", refresh: "refresh-token", expires: Date.now() + 60_000, accountId: "acct_test" }) });
    expect(requestedUrl).toBe(CODEX_MODELS_ENDPOINT);
    expect(new Headers(requestedHeaders).get("authorization")).toBe("Bearer access-token");
    expect(new Headers(requestedHeaders).get("chatgpt-account-id")).toBe("acct_test");
    expect(models).toEqual(["gpt-5.2", "gpt-5.3-codex"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
