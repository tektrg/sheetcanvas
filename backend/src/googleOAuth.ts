import { HttpError } from "./errors";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";

export type GoogleOAuthTokenResponse = {
  access_token: string;
  expires_in?: number;
  refresh_token?: string;
  token_type?: string;
  scope?: string;
};

export type GoogleOAuthUserInfo = {
  email?: string;
  name?: string;
};

type OAuthErrorResponse = {
  error?: string;
  error_description?: string;
};

const CLIENT_OAUTH_ERRORS = new Set([
  "invalid_request",
  "invalid_client",
  "invalid_scope",
  "unauthorized_client",
  "unsupported_grant_type"
]);

function buildTokenParams(params: Record<string, string>) {
  const body = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value) body.set(key, value);
  });
  return body.toString();
}

function getTokenErrorStatus(upstreamStatus: number, oauthError: string | undefined) {
  if (oauthError === "invalid_grant") return 401;
  if (oauthError && CLIENT_OAUTH_ERRORS.has(oauthError)) return 400;
  if (upstreamStatus >= 400 && upstreamStatus < 500) return 400;
  return 502;
}

function getTokenErrorCode(oauthError: string | undefined) {
  return oauthError === "invalid_grant" ? "oauth_invalid_grant" : "oauth_error";
}

async function fetchToken(params: Record<string, string>) {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: buildTokenParams(params)
  });

  const json = (await res.json().catch(() => null)) as (GoogleOAuthTokenResponse & OAuthErrorResponse) | null;
  if (!res.ok || !json?.access_token) {
    const msg =
      json?.error_description ||
      json?.error ||
      `Token exchange failed (${res.status})`;
    throw new HttpError(getTokenErrorStatus(res.status, json?.error), getTokenErrorCode(json?.error), msg);
  }
  return json;
}

export async function exchangeGoogleOAuthCode(args: {
  code: string;
  codeVerifier: string;
  redirectUri: string;
  clientId: string;
  clientSecret?: string;
}): Promise<GoogleOAuthTokenResponse> {
  return fetchToken({
    code: args.code,
    code_verifier: args.codeVerifier,
    redirect_uri: args.redirectUri,
    client_id: args.clientId,
    client_secret: args.clientSecret || "",
    grant_type: "authorization_code"
  });
}

export async function refreshGoogleOAuthAccessToken(args: {
  refreshToken: string;
  clientId: string;
  clientSecret?: string;
}): Promise<GoogleOAuthTokenResponse> {
  return fetchToken({
    refresh_token: args.refreshToken,
    client_id: args.clientId,
    client_secret: args.clientSecret || "",
    grant_type: "refresh_token"
  });
}

export async function getGoogleOAuthUserInfo(accessToken: string): Promise<GoogleOAuthUserInfo | null> {
  const res = await fetch(USERINFO_URL, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if (!res.ok) return null;
  const json = (await res.json().catch(() => null)) as GoogleOAuthUserInfo | null;
  return json ? { email: json.email, name: json.name } : null;
}
