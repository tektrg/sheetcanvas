import { HttpError } from "./errors";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import {
  exchangeGoogleOAuthCode,
  getGoogleOAuthUserInfo,
  refreshGoogleOAuthAccessToken,
  type GoogleOAuthTokenResponse
} from "./googleOAuth";

const SHEETS_VALUES_URL_BASE = "https://sheets.googleapis.com/v4/spreadsheets";
export const DEFAULT_GOOGLE_SHEETS_RANGE = "Sheet1!A1:Z1000";
export const GOOGLE_SHEETS_READONLY_SCOPE = "https://www.googleapis.com/auth/spreadsheets.readonly";

export type GoogleSheetsQueryResult = {
  columns: Array<{ name: string; type: string }>;
  rows: string[][];
  rowCount: number;
  truncated: boolean;
};

export function normalizeGoogleSheetsInput(input: string) {
  const value = input.trim();
  if (!value) throw new HttpError(400, "bad_request", "Google Sheets spreadsheet URL or ID is required");

  const urlMatch = value.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (urlMatch?.[1]) return urlMatch[1];

  if (/^[a-zA-Z0-9-_]+$/.test(value)) return value;
  throw new HttpError(400, "bad_request", "Enter a valid Google Sheets URL or spreadsheet ID");
}

export async function exchangeGoogleSheetsCode(args: {
  code: string;
  codeVerifier: string;
  redirectUri: string;
  clientId: string;
  clientSecret?: string;
}): Promise<GoogleOAuthTokenResponse> {
  return exchangeGoogleOAuthCode(args);
}

export async function refreshGoogleSheetsAccessToken(args: {
  refreshToken: string;
  clientId: string;
  clientSecret?: string;
}): Promise<GoogleOAuthTokenResponse> {
  return refreshGoogleOAuthAccessToken(args);
}

export async function getGoogleSheetsUserInfo(accessToken: string) {
  return getGoogleOAuthUserInfo(accessToken);
}

function stringifyCell(value: unknown) {
  if (value === null || value === undefined) return "";
  return String(value);
}

function normalizeRange(range: string | undefined) {
  const trimmed = range?.trim();
  return trimmed || DEFAULT_GOOGLE_SHEETS_RANGE;
}

function getSheetsError(status: number): { status: ContentfulStatusCode; code: string } {
  if (status === 400) return { status: 400, code: "google_sheets_bad_request" };
  if (status === 401) return { status: 401, code: "google_sheets_auth_error" };
  if (status === 403) return { status: 403, code: "google_sheets_permission_denied" };
  if (status === 404) return { status: 404, code: "google_sheets_not_found" };
  return { status: 502, code: "google_sheets_error" };
}

export async function getGoogleSheetsValues(args: {
  accessToken: string;
  spreadsheetIdOrUrl: string;
  range?: string;
  maxRows: number;
}): Promise<GoogleSheetsQueryResult> {
  const spreadsheetId = normalizeGoogleSheetsInput(args.spreadsheetIdOrUrl);
  const range = normalizeRange(args.range);
  const url =
    `${SHEETS_VALUES_URL_BASE}/${encodeURIComponent(spreadsheetId)}` +
    `/values/${encodeURIComponent(range)}` +
    "?majorDimension=ROWS&valueRenderOption=UNFORMATTED_VALUE";

  const res = await fetch(url, {
    method: "GET",
    headers: { Authorization: `Bearer ${args.accessToken}` }
  });
  const json = (await res.json().catch(() => null)) as any;
  if (!res.ok) {
    const msg =
      json?.error?.message ||
      json?.message ||
      `Google Sheets values fetch failed (${res.status})`;
    const mapped = getSheetsError(res.status);
    throw new HttpError(mapped.status, mapped.code, msg);
  }

  const values = ((json?.values ?? []) as unknown[][]).map((row) => row.map(stringifyCell));
  if (values.length === 0) {
    return { columns: [], rows: [], rowCount: 0, truncated: false };
  }

  const maxRows = Math.max(1, args.maxRows);
  const truncatedValues = values.slice(0, maxRows + 1);
  const maxColumns = truncatedValues.reduce((max, row) => Math.max(max, row.length), 0);
  const headers = truncatedValues[0] ?? [];
  const columns = Array.from({ length: maxColumns }, (_, index) => {
    const name = headers[index]?.trim() || `Column ${index + 1}`;
    return { name, type: "string" };
  });
  const rows = truncatedValues.slice(1).map((row) =>
    Array.from({ length: maxColumns }, (_, index) => row[index] ?? "")
  );

  return {
    columns,
    rows,
    rowCount: Math.max(0, values.length - 1),
    truncated: values.length > maxRows + 1
  };
}
