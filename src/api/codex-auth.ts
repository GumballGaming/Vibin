/**
 * OAuth flow adapted from OpenCode's MIT-licensed Codex provider and the
 * Apache-2.0-licensed OpenAI Codex authentication implementation.
 * See NOTICE.md for attribution and scope.
 */
import { createServer, type Server } from "node:http";
import { randomBytes, createHash } from "node:crypto";
import { readCodexCredential, writeCodexCredential } from "../shared/credential-store";
import { VibinError } from "../shared/errors";

export const CODEX_ISSUER = "https://auth.openai.com";
export const CODEX_ENDPOINT = "https://chatgpt.com/backend-api/codex/responses";
export const CODEX_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const CALLBACK_HOST = "localhost";
const CALLBACK_PORTS = [1455, 1457] as const;
const CALLBACK_PATH = "/auth/callback";
const TOKEN_EXPIRY_SKEW_MS = 30_000;

export type CodexTokens = {
  access_token: string;
  refresh_token: string;
  id_token?: string;
  expires_in?: number;
};
export type CodexCredential = { access: string; refresh: string; expires: number; accountId?: string };
export type IdTokenClaims = { chatgpt_account_id?: string; organizations?: Array<{ id: string }>; email?: string; "https://api.openai.com/auth"?: { chatgpt_account_id?: string } };

function base64Url(value: Uint8Array): string {
  return Buffer.from(value).toString("base64url");
}
export function generatePkce(): { verifier: string; challenge: string } {
  const verifier = base64Url(randomBytes(32));
  const challenge = base64Url(createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}
export function generateState(): string { return base64Url(randomBytes(32)); }
export function parseJwtClaims(token: string): IdTokenClaims | undefined {
  const parts = token.split(".");
  if (parts.length !== 3) return undefined;
  try { return JSON.parse(Buffer.from(parts[1]!, "base64url").toString("utf8")) as IdTokenClaims; }
  catch { return undefined; }
}
export function extractAccountId(tokens: CodexTokens): string | undefined {
  for (const token of [tokens.id_token, tokens.access_token]) {
    if (!token) continue;
    const claims = parseJwtClaims(token);
    const accountId = claims?.chatgpt_account_id ?? claims?.["https://api.openai.com/auth"]?.chatgpt_account_id ?? claims?.organizations?.[0]?.id;
    if (accountId) return accountId;
  }
  return undefined;
}
export function buildAuthorizeUrl(redirectUri: string, pkce: { challenge: string }, state: string): string {
  const params = new URLSearchParams({
    response_type: "code", client_id: CODEX_CLIENT_ID, redirect_uri: redirectUri,
    scope: "openid profile email offline_access", code_challenge: pkce.challenge,
    code_challenge_method: "S256", id_token_add_organizations: "true",
    codex_cli_simplified_flow: "true", state, originator: "vibin",
  });
  return `${CODEX_ISSUER}/oauth/authorize?${params.toString()}`;
}

async function exchangeCode(code: string, redirectUri: string, verifier: string): Promise<CodexTokens> {
  const response = await fetch(`${CODEX_ISSUER}/oauth/token`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirectUri, client_id: CODEX_CLIENT_ID, code_verifier: verifier }).toString() });
  if (!response.ok) throw new VibinError(`Codex OAuth token exchange failed (${response.status}).`, "Try /provider add again.");
  return await response.json() as CodexTokens;
}
async function refresh(refreshToken: string): Promise<CodexTokens> {
  const response = await fetch(`${CODEX_ISSUER}/oauth/token`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken, client_id: CODEX_CLIENT_ID }).toString() });
  if (!response.ok) throw new VibinError(`Codex OAuth refresh failed (${response.status}).`, "Run /provider add to sign in again.");
  return await response.json() as CodexTokens;
}

function toCredential(tokens: CodexTokens, priorRefresh?: string): CodexCredential {
  return { access: tokens.access_token, refresh: tokens.refresh_token || priorRefresh || "", expires: Date.now() + (tokens.expires_in ?? 3600) * 1000, ...(extractAccountId(tokens) ? { accountId: extractAccountId(tokens) } : {}) };
}
async function saveCredential(credential: CodexCredential): Promise<void> { await writeCodexCredential(JSON.stringify(credential)); }

export class CodexAuth {
  private refreshPromise?: Promise<CodexCredential>;
  async login(onUrl: (url: string) => void): Promise<CodexCredential> {
    const pkce = generatePkce(); const state = generateState();
    let server: Server | undefined; let callbackPort: number | undefined;
    try {
      server = createServer();
      for (const port of CALLBACK_PORTS) {
        try {
          await new Promise<void>((resolve, reject) => {
            const onError = (error: Error) => { server!.off("error", onError); reject(error); };
            server!.once("error", onError);
            server!.listen(port, CALLBACK_HOST, () => { server!.off("error", onError); resolve(); });
          });
          callbackPort = port; break;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "EADDRINUSE" || port === CALLBACK_PORTS.at(-1)) throw error;
        }
      }
      if (!callbackPort) throw new VibinError("Could not start the OAuth callback server.", "Ports 1455 and 1457 are unavailable.");
      const redirectUri = `http://${CALLBACK_HOST}:${callbackPort}${CALLBACK_PATH}`;
      const callback = new Promise<CodexTokens>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new VibinError("Codex OAuth login timed out.")), 5 * 60 * 1000);
        server!.on("request", (request, response) => {
          const url = new URL(request.url ?? "/", redirectUri);
          if (url.pathname !== CALLBACK_PATH) { response.writeHead(404); response.end(); return; }
          const callbackState = url.searchParams.get("state"); const code = url.searchParams.get("code"); const error = url.searchParams.get("error_description") ?? url.searchParams.get("error");
          if (error) { clearTimeout(timeout); response.writeHead(400); response.end("Vibin OAuth failed. You can close this window."); reject(new VibinError(error)); return; }
          if (!code || callbackState !== state) { clearTimeout(timeout); response.writeHead(400); response.end("Vibin OAuth state validation failed. You can close this window."); reject(new VibinError("Invalid OAuth callback state.")); return; }
          clearTimeout(timeout); response.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" }); response.end("Vibin OAuth complete. You can close this window.");
          exchangeCode(code, redirectUri, pkce.verifier).then(resolve, reject);
        });
      });
      const url = buildAuthorizeUrl(redirectUri, pkce, state); onUrl(url);
      const tokens = await callback; const credential = toCredential(tokens); await saveCredential(credential); return credential;
    } finally { if (server) await new Promise<void>((resolve) => server!.close(() => resolve())); }
  }
  async accessToken(): Promise<CodexCredential> {
    const raw = await readCodexCredential();
    if (!raw) throw new VibinError("No Codex OAuth login found.", "Use /provider add and choose ChatGPT/Codex OAuth.");
    let credential: CodexCredential;
    try { credential = JSON.parse(raw) as CodexCredential; } catch { throw new VibinError("The saved Codex OAuth credential is invalid.", "Run /provider add to sign in again."); }
    if (credential.expires > Date.now() + TOKEN_EXPIRY_SKEW_MS) return credential;
    if (!this.refreshPromise) this.refreshPromise = refresh(credential.refresh).then((tokens) => { const next = toCredential(tokens, credential.refresh); return saveCredential(next).then(() => next); }).finally(() => { this.refreshPromise = undefined; });
    return this.refreshPromise;
  }
}
