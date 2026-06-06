import { requestJson } from './backendApi';

export const DEFAULT_GOOGLE_SHEETS_RANGE = 'Sheet1!A1:Z1000';

export type GoogleSheetsPublicConnector = {
  id: string;
  type: 'google-sheets';
  name: string;
  config_json?: string | null;
  created_at_ms: number;
  updated_at_ms: number;
};

export type GoogleSheetsQueryResponse = {
  columns: Array<{ name: string; type: string }>;
  rows: string[][];
  rowCount: number;
  truncated?: boolean;
};

export async function listGoogleSheetsConnectors(): Promise<GoogleSheetsPublicConnector[]> {
  const res = await requestJson<{ connectors: GoogleSheetsPublicConnector[] }>('/api/connectors');
  return (res.connectors || []).filter((c) => c.type === 'google-sheets');
}

export async function exchangeGoogleSheetsAuthCode(args: {
  code: string;
  codeVerifier: string;
  redirectUri: string;
}): Promise<{ connector: GoogleSheetsPublicConnector }> {
  return requestJson<{ connector: GoogleSheetsPublicConnector }>(
    '/api/connectors/google-sheets/auth/exchange',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(args),
    }
  );
}

export async function queryGoogleSheets(args: {
  connectorId: string;
  spreadsheetIdOrUrl: string;
  range?: string;
}): Promise<GoogleSheetsQueryResponse> {
  return requestJson<GoogleSheetsQueryResponse>('/api/query/google-sheets', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
}

export function googleSheetsResultToMatrix(result: GoogleSheetsQueryResponse): string[][] {
  const headers = result.columns.map((c) => c.name);
  return [headers, ...result.rows];
}
