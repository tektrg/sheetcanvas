import { requestJson } from './backendApi';

export type GoogleAnalyticsPublicConnector = {
  id: string;
  type: 'google-analytics';
  name: string;
  config_json?: string | null;
  created_at_ms: number;
  updated_at_ms: number;
};

export type GoogleAnalyticsProperty = {
  propertyId: string;
  displayName: string;
  accountDisplayName?: string;
};

export type GoogleAnalyticsReport = {
  dateRanges?: Array<{ startDate: string; endDate: string }>;
  dimensions?: Array<{ name: string }>;
  metrics?: Array<{ name: string }>;
  dimensionFilter?: unknown;
  metricFilter?: unknown;
  orderBys?: unknown[];
  limit?: number;
};

export type GoogleAnalyticsQueryResponse = {
  columns: Array<{ name: string; type: string }>;
  rows: string[][];
  rowCount: number;
  truncated?: boolean;
};

export async function listGoogleAnalyticsConnectors(): Promise<GoogleAnalyticsPublicConnector[]> {
  const res = await requestJson<{ connectors: GoogleAnalyticsPublicConnector[] }>('/api/connectors');
  return (res.connectors || []).filter((c) => c.type === 'google-analytics');
}

export async function exchangeGoogleAnalyticsAuthCode(args: {
  code: string;
  codeVerifier: string;
  redirectUri: string;
}): Promise<{ connector: GoogleAnalyticsPublicConnector }> {
  return requestJson<{ connector: GoogleAnalyticsPublicConnector }>(
    '/api/connectors/google-analytics/auth/exchange',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(args)
    }
  );
}

export async function listGoogleAnalyticsProperties(args: {
  connectorId: string;
}): Promise<GoogleAnalyticsProperty[]> {
  const res = await requestJson<{ properties: GoogleAnalyticsProperty[] }>(
    '/api/connectors/google-analytics/properties',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(args)
    }
  );
  return res.properties || [];
}

export async function queryGoogleAnalytics(args: {
  connectorId: string;
  propertyId: string;
  report?: GoogleAnalyticsReport;
}): Promise<GoogleAnalyticsQueryResponse> {
  return requestJson<GoogleAnalyticsQueryResponse>('/api/query/google-analytics', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(args)
  });
}

export function googleAnalyticsResultToMatrix(result: GoogleAnalyticsQueryResponse): string[][] {
  const headers = result.columns.map((c) => c.name);
  const dateCols = new Set(
    result.columns.map((c, i) => (c.name === 'date' ? i : -1)).filter((i) => i >= 0)
  );
  const rows = result.rows.map((row) =>
    row.map((value, i) => {
      const str = (value ?? '').toString();
      if (dateCols.has(i) && /^\d{8}$/.test(str)) {
        return `${str.slice(0, 4)}-${str.slice(4, 6)}-${str.slice(6, 8)}`;
      }
      return str;
    })
  );
  return [headers, ...rows];
}
