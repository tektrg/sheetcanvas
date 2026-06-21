import { describe, expect, it } from 'vitest';
import type { ConnectionSchemaScope } from '../../../types';
import { clickhouseQueryProvider } from '../clickhouseProvider';
import { googleAnalyticsQueryProvider } from '../googleAnalyticsProvider';
import { googleSheetsQueryProvider } from '../googleSheetsProvider';
import { getConnectorQueryProvider } from '../registry';
import '../index'; // side-effect: register the built-in providers

// Resolve through the registry so each is typed against the shared (general) query type.
const allProviders = [
  getConnectorQueryProvider('clickhouse')!,
  getConnectorQueryProvider('google-analytics')!,
  getConnectorQueryProvider('google-sheets')!,
];

function scope(partial: Partial<ConnectionSchemaScope>): ConnectionSchemaScope {
  return { connectionId: 'conn-1', type: 'clickhouse', createdAt: 0, ...partial };
}

describe('connector query providers — describeShape', () => {
  it.each(allProviders)('$type exposes a usable shape contract', (provider) => {
    const shape = provider.describeShape();
    expect(shape.type).toBe(provider.type);
    expect(shape.summary.length).toBeGreaterThan(0);
    expect(shape.payloadSchema.length).toBeGreaterThan(0);
    expect(shape.requiredFields.length).toBeGreaterThan(0);
    expect(shape.examples.length).toBeGreaterThan(0);
  });

  it.each(allProviders)('$type examples normalize and validate cleanly', (provider) => {
    for (const example of provider.describeShape().examples) {
      const query = provider.normalize(example as Record<string, unknown>);
      expect(provider.validate(query)).toBeNull();
    }
  });
});

describe('connector query providers — normalize/toPayload round-trip', () => {
  it.each(allProviders)('$type re-normalizes its own persisted payload', (provider) => {
    const example = provider.describeShape().examples[0] as Record<string, unknown>;
    const first = provider.normalize(example);
    const persisted = provider.toPayload(first);
    const second = provider.normalize(persisted as Record<string, unknown>);
    expect(second).toEqual(first);
  });
});

describe('clickhouse reconcileWithSchemaToken', () => {
  it('rewrites the in-app alias "t" to the described table', () => {
    const query = clickhouseQueryProvider.normalize({ sql: 'SELECT * FROM t LIMIT 5' });
    const result = clickhouseQueryProvider.reconcileWithSchemaToken(query, scope({ table: 'hq_report.sales' }));
    expect(result.error).toBeNull();
    expect(result.query?.sql).toBe('SELECT * FROM hq_report.sales LIMIT 5');
  });

  it('leaves SQL untouched when no described table is present', () => {
    const query = clickhouseQueryProvider.normalize({ sql: 'SELECT 1' });
    const result = clickhouseQueryProvider.reconcileWithSchemaToken(query, scope({}));
    expect(result.error).toBeNull();
    expect(result.query?.sql).toBe('SELECT 1');
  });
});

describe('google-analytics reconcileWithSchemaToken', () => {
  const query = googleAnalyticsQueryProvider.normalize({ propertyId: '111', report: {} });

  it('rejects a property that does not match the described one', () => {
    const result = googleAnalyticsQueryProvider.reconcileWithSchemaToken(
      query,
      scope({ type: 'google-analytics', propertyId: '999' }),
    );
    expect(result.query).toBeNull();
    expect(result.error).toMatch(/property/i);
  });

  it('accepts a matching property', () => {
    const result = googleAnalyticsQueryProvider.reconcileWithSchemaToken(
      query,
      scope({ type: 'google-analytics', propertyId: '111' }),
    );
    expect(result.error).toBeNull();
    expect(result.query).not.toBeNull();
  });
});

describe('registry', () => {
  it('resolves every built-in provider by type', () => {
    expect(getConnectorQueryProvider('clickhouse')).toBe(clickhouseQueryProvider);
    expect(getConnectorQueryProvider('google-analytics')).toBe(googleAnalyticsQueryProvider);
    expect(getConnectorQueryProvider('google-sheets')).toBe(googleSheetsQueryProvider);
  });
});
