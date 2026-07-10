import { HttpError } from "./errors";
import {
  exchangeGoogleOAuthCode,
  getGoogleOAuthUserInfo,
  refreshGoogleOAuthAccessToken,
  type GoogleOAuthTokenResponse
} from "./googleOAuth";

const REPORT_URL_BASE = "https://analyticsdata.googleapis.com/v1beta";
const ADMIN_URL_BASE = "https://analyticsadmin.googleapis.com/v1beta";
export const GOOGLE_ANALYTICS_READONLY_SCOPE = "https://www.googleapis.com/auth/analytics.readonly";

export type GoogleAnalyticsReport = {
  dateRanges?: Array<{ startDate: string; endDate: string }>;
  dimensions?: Array<{ name: string }>;
  metrics?: Array<{ name: string }>;
  dimensionFilter?: unknown;
  metricFilter?: unknown;
  orderBys?: unknown[];
  limit?: number;
};

export type GoogleAnalyticsRunReportResult = {
  columns: Array<{ name: string; type: string }>;
  rows: string[][];
  rowCount: number;
  truncated: boolean;
};

export type GoogleAnalyticsProperty = {
  propertyId: string;
  displayName: string;
  accountDisplayName?: string;
};

export type GoogleAnalyticsPropertiesResult = {
  properties: GoogleAnalyticsProperty[];
  nextPageToken?: string;
  truncated: boolean;
};

export function hasGoogleAnalyticsReadonlyScope(scope: string | undefined | null) {
  return new Set((scope ?? "").split(/\s+/).filter(Boolean)).has(GOOGLE_ANALYTICS_READONLY_SCOPE);
}

function normalizeGoogleAnalyticsRelativeDate(value: string) {
  const input = value.trim();
  const match = /^(\d+)\s*(day|days|week|weeks|month|months|quarter|quarters|year|years)Ago$/i.exec(input);
  if (!match) return input;

  const amount = Number.parseInt(match[1], 10);
  if (!Number.isFinite(amount) || amount <= 0) return input;

  const unit = match[2].toLowerCase();
  if (unit.startsWith("day")) return `${amount}daysAgo`;
  if (unit.startsWith("week")) return `${amount * 7}daysAgo`;
  if (unit.startsWith("month")) return `${amount * 30}daysAgo`;
  if (unit.startsWith("quarter")) return `${amount * 90}daysAgo`;
  if (unit.startsWith("year")) return `${amount * 365}daysAgo`;
  return input;
}

function normalizeGoogleAnalyticsReportDates(report: GoogleAnalyticsReport) {
  if (!report.dateRanges || report.dateRanges.length === 0) return;
  report.dateRanges = report.dateRanges.map((range) => ({
    ...range,
    startDate: normalizeGoogleAnalyticsRelativeDate(range.startDate),
    endDate: normalizeGoogleAnalyticsRelativeDate(range.endDate),
  }));
}

export async function exchangeGoogleAnalyticsCode(args: {
  code: string;
  codeVerifier: string;
  redirectUri: string;
  clientId: string;
  clientSecret?: string;
}): Promise<GoogleOAuthTokenResponse> {
  return exchangeGoogleOAuthCode(args);
}

export async function refreshGoogleAnalyticsAccessToken(args: {
  refreshToken: string;
  clientId: string;
  clientSecret?: string;
}): Promise<GoogleOAuthTokenResponse> {
  return refreshGoogleOAuthAccessToken(args);
}

export async function getGoogleAnalyticsUserInfo(accessToken: string) {
  return getGoogleOAuthUserInfo(accessToken);
}

function normalizeReport(report: GoogleAnalyticsReport | undefined, maxRows: number) {
  const normalized: GoogleAnalyticsReport = { ...(report || {}) };

  if (!normalized.dateRanges || normalized.dateRanges.length === 0) {
    normalized.dateRanges = [{ startDate: "30daysAgo", endDate: "today" }];
  }
  normalizeGoogleAnalyticsReportDates(normalized);

  if (!normalized.dimensions || normalized.dimensions.length === 0) {
    normalized.dimensions = [{ name: "date" }];
  }

  if (!normalized.metrics || normalized.metrics.length === 0) {
    normalized.metrics = [{ name: "activeUsers" }];
  }

  if (!normalized.limit || normalized.limit <= 0) {
    normalized.limit = maxRows;
  } else {
    normalized.limit = Math.min(normalized.limit, maxRows);
  }

  return normalized;
}

export async function runGoogleAnalyticsReport(args: {
  accessToken: string;
  propertyId: string;
  report: GoogleAnalyticsReport | undefined;
  maxRows: number;
}): Promise<GoogleAnalyticsRunReportResult> {
  const normalized = normalizeReport(args.report, args.maxRows);
  const limitValue = Math.max(1, Math.min(args.maxRows, normalized.limit ?? args.maxRows));
  const body = {
    ...normalized,
    limit: String(limitValue)
  };

  const res = await fetch(`${REPORT_URL_BASE}/properties/${args.propertyId}:runReport`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${args.accessToken}`
    },
    body: JSON.stringify(body)
  });

  const json = (await res.json().catch(() => null)) as any;
  if (!res.ok) {
    const msg =
      json?.error?.message ||
      json?.message ||
      `GA report failed (${res.status})`;
    throw new HttpError(502, "google_analytics_error", msg);
  }

  const dimensionHeaders = (json?.dimensionHeaders ?? []) as Array<{ name: string }>;
  const metricHeaders = (json?.metricHeaders ?? []) as Array<{ name: string; type?: string }>;
  const rows = (json?.rows ?? []) as Array<{
    dimensionValues?: Array<{ value?: string }>;
    metricValues?: Array<{ value?: string }>;
  }>;

  const columns = [
    ...dimensionHeaders.map((h) => ({ name: h.name, type: "dimension" })),
    ...metricHeaders.map((h) => ({ name: h.name, type: h.type || "metric" }))
  ];

  const dateDimIndices = new Set(
    dimensionHeaders
      .map((h, i) => (h.name === "date" ? i : -1))
      .filter((i) => i >= 0)
  );

  const mappedRows = rows.map((row) => {
    const dims = (row.dimensionValues ?? []).map((v, i) => {
      const raw = v?.value ?? "";
      if (dateDimIndices.has(i) && /^\d{8}$/.test(raw)) {
        return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
      }
      return raw;
    });
    const metrics = (row.metricValues ?? []).map((v) => v?.value ?? "");
    return [...dims, ...metrics];
  });

  const rowCount = typeof json?.rowCount === "number" ? json.rowCount : mappedRows.length;
  const truncated = mappedRows.length >= limitValue;

  return { columns, rows: mappedRows, rowCount, truncated };
}

export type GoogleAnalyticsMetadataDim = {
  apiName: string;
  displayName: string;
  description?: string;
};

export type GoogleAnalyticsMetadataResult = {
  dimensions: GoogleAnalyticsMetadataDim[];
  metrics: GoogleAnalyticsMetadataDim[];
};

export async function getGoogleAnalyticsMetadata(args: {
  accessToken: string;
  propertyId: string;
}): Promise<GoogleAnalyticsMetadataResult> {
  const normalizedId = args.propertyId.replace(/^properties\//i, '');
  const res = await fetch(REPORT_URL_BASE + '/properties/' + normalizedId + '/metadata', {
    method: 'GET',
    headers: { Authorization: 'Bearer ' + args.accessToken },
  });
  const json = (await res.json().catch(() => null)) as any;
  if (!res.ok) {
    const msg = json?.error?.message || json?.message || 'GA metadata fetch failed (' + res.status + ')';
    throw new HttpError(502, 'google_analytics_error', msg);
  }
  const dimensions = ((json?.dimensions ?? []) as any[]).map((d: any) => ({
    apiName: d.apiName ?? '',
    displayName: d.uiName ?? d.apiName ?? '',
    description: d.description ?? '',
  }));
  const metrics = ((json?.metrics ?? []) as any[]).map((m: any) => ({
    apiName: m.apiName ?? '',
    displayName: m.uiName ?? m.apiName ?? '',
    description: m.description ?? '',
  }));
  return { dimensions, metrics };
}

export async function listGoogleAnalyticsProperties(args: {
  accessToken: string;
  pageSize?: number;
  pageToken?: string;
}): Promise<GoogleAnalyticsPropertiesResult> {
  const query = new URLSearchParams();
  query.set("pageSize", String(Math.max(1, Math.min(args.pageSize ?? 50, 200))));
  if (args.pageToken) query.set("pageToken", args.pageToken);

  const res = await fetch(`${ADMIN_URL_BASE}/accountSummaries?${query.toString()}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${args.accessToken}`
    }
  });

  const json = (await res.json().catch(() => null)) as any;
  if (!res.ok) {
    const msg =
      json?.error?.message ||
      json?.message ||
      `GA properties fetch failed (${res.status})`;
    throw new HttpError(502, "google_analytics_error", msg);
  }

  const summaries = (json?.accountSummaries ?? []) as Array<{
    displayName?: string;
    propertySummaries?: Array<{ property?: string; displayName?: string }>;
  }>;

  const properties: GoogleAnalyticsProperty[] = [];
  summaries.forEach((summary) => {
    const accountDisplayName = summary.displayName;
    (summary.propertySummaries ?? []).forEach((property) => {
      const propertyName = property.property ?? "";
      const propertyId = propertyName.replace(/^properties\//i, "");
      if (!propertyId) return;
      properties.push({
        propertyId,
        displayName: property.displayName || propertyId,
        accountDisplayName
      });
    });
  });

  const nextPageToken = typeof json?.nextPageToken === "string" && json.nextPageToken ? json.nextPageToken : undefined;
  return { properties, nextPageToken, truncated: !!nextPageToken };
}
