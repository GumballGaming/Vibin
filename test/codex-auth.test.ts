import { expect, test } from "bun:test";
import { buildAuthorizeUrl, extractAccountId, generatePkce, generateState } from "../src/api/codex-auth";

test("generates valid PKCE and state values", async () => {
  const pkce = generatePkce();
  expect(pkce.verifier.length).toBeGreaterThan(40);
  expect(pkce.challenge).not.toBe(pkce.verifier);
  expect(generateState()).toMatch(/^[A-Za-z0-9_-]+$/);
  const url = new URL(buildAuthorizeUrl("http://localhost:1455/auth/callback", pkce, "state"));
  expect(url.origin).toBe("https://auth.openai.com");
  expect(url.searchParams.get("client_id")).toBe("app_EMoamEEZ73f0CkXaXp7hrann");
  expect(url.searchParams.get("code_challenge_method")).toBe("S256");
  expect(url.searchParams.get("state")).toBe("state");
  expect(url.searchParams.get("redirect_uri")).toBe("http://localhost:1455/auth/callback");
});

test("extracts the ChatGPT account identifier from the ID token claims", () => {
  const payload = Buffer.from(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "acct_test" } })).toString("base64url");
  expect(extractAccountId({ access_token: "x.y.z", refresh_token: "refresh", id_token: `x.${payload}.z` })).toBe("acct_test");
});
