import { requestJson } from './backendApi';

export type ClickHousePublicConnector = {
  id: string;
  type: 'clickhouse';
  name: string;
  url: string;
  username: string;
  created_at_ms: number;
  updated_at_ms: number;
};

export type ClickHouseConnectorDraft = {
  name?: string;
  url: string;
  username: string;
  password: string;
};

export type ClickHouseQueryResponse = {
  columns: Array<{ name: string; type: string }>;
  rows: unknown[][];
  rowCount: number;
  truncated?: boolean;
};

export async function listClickhouseConnectors(): Promise<ClickHousePublicConnector[]> {
  const res = await requestJson<{ connectors: ClickHousePublicConnector[] }>('/api/connectors');
  return (res.connectors || []).filter((c) => c.type === 'clickhouse');
}

export async function testClickhouseConnector(draft: ClickHouseConnectorDraft): Promise<void> {
  await requestJson<{ ok: boolean }>('/api/connectors/clickhouse/test', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: draft.url, username: draft.username, password: draft.password })
  });
}

export async function createClickhouseConnector(draft: ClickHouseConnectorDraft): Promise<ClickHousePublicConnector> {
  const res = await requestJson<{ connector: ClickHousePublicConnector }>('/api/connectors/clickhouse', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(draft)
  });
  return res.connector;
}

export async function queryClickhouse(args: { connectorId: string; sql: string; limit?: number }): Promise<ClickHouseQueryResponse> {
  return requestJson<ClickHouseQueryResponse>('/api/query/clickhouse', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(args)
  });
}

export function clickhouseResultToMatrix(result: ClickHouseQueryResponse): string[][] {
  const headers = result.columns.map((c) => c.name);
  const rows = result.rows.map((row) =>
    row.map((v) => {
      if (v === null || v === undefined) return '';
      if (typeof v === 'string') return v;
      if (typeof v === 'number' || typeof v === 'boolean') return String(v);
      try {
        return JSON.stringify(v);
      } catch {
        return String(v);
      }
    })
  );
  return [headers, ...rows];
}
