import type { ClickhouseQuery } from '../../types';
import { clickhouseResultToMatrix, queryClickhouse } from '../clickhouseBackend';
import type { ConnectorQueryProvider, NormalizedConnectorQuery } from './types';

type ClickhouseNormalizedQuery = Extract<NormalizedConnectorQuery, { type: 'clickhouse' }>;

/**
 * Rewrite the in-app sheet alias "t" to the real database-qualified table from describeConnection.
 * Exported so the agent tool layer and tests can reuse the exact same rewrite.
 */
export function rewriteClickhouseSqlForDescribedTable(sql: string, table?: string): string {
  if (!table) return sql;
  return sql.replace(/\b(from|join)\s+t\b/gi, (_match, keyword: string) => `${keyword} ${table}`);
}

export const clickhouseQueryProvider: ConnectorQueryProvider<ClickhouseNormalizedQuery> = {
  type: 'clickhouse',
  version: 1,

  normalize(raw) {
    return { type: 'clickhouse', sql: String(raw.sql ?? '').trim() };
  },

  validate(query) {
    return query.sql.trim() ? null : 'SQL is required';
  },

  async execute(connectionId, query) {
    const result = await queryClickhouse({ connectorId: connectionId, sql: query.sql.trim() });
    return { matrix: clickhouseResultToMatrix(result), truncated: !!result.truncated };
  },

  summarize(query) {
    return query.sql.split('\n').map((line) => line.trim()).find(Boolean) ?? '';
  },

  defaultTitle() {
    return 'ClickHouse Query';
  },

  toPayload(query): ClickhouseQuery {
    return { sql: query.sql.trim() };
  },

  describeShape() {
    return {
      type: 'clickhouse',
      summary: 'A ClickHouse query is a single SQL SELECT statement run against the connection.',
      payloadSchema: '{ sql: string } — one ClickHouse SQL statement. SELECT only; no trailing semicolon needed.',
      requiredFields: ['sql'],
      examples: [
        { sql: 'SELECT month, loyalty_tier, sum(total_profit) AS profit FROM hq_report.sales GROUP BY month, loyalty_tier ORDER BY month LIMIT 1000' },
      ],
      notes:
        'Use the real database-qualified table name from describeConnection (e.g. "hq_report.sales"), not the in-app sheet alias "t" — the alias is rewritten automatically but explicit names are clearer.',
    };
  },

  reconcileWithSchemaToken(query, scope) {
    // The described schema gives the real database-qualified table; rewrite the in-app alias "t".
    return { query: { type: 'clickhouse', sql: rewriteClickhouseSqlForDescribedTable(query.sql, scope.table) }, error: null };
  },
};
