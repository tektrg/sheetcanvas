import type { GaQuery, GoogleAnalyticsReport } from '../../types';
import { googleAnalyticsResultToMatrix, queryGoogleAnalytics } from '../googleAnalyticsBackend';
import type { ConnectorQueryProvider, NormalizedConnectorQuery } from './types';

type GaNormalizedQuery = Extract<NormalizedConnectorQuery, { type: 'google-analytics' }>;

export const googleAnalyticsQueryProvider: ConnectorQueryProvider<GaNormalizedQuery> = {
  type: 'google-analytics',
  version: 1,

  normalize(raw) {
    return {
      type: 'google-analytics',
      propertyId: String(raw.propertyId ?? '').trim(),
      report: ((raw.report as GoogleAnalyticsReport | undefined) ?? {}) as GoogleAnalyticsReport,
    };
  },

  validate(query) {
    return query.propertyId.trim() ? null : 'GA4 property ID is required';
  },

  async execute(connectionId, query) {
    const result = await queryGoogleAnalytics({
      connectorId: connectionId,
      propertyId: query.propertyId.trim(),
      report: query.report,
    });
    return { matrix: googleAnalyticsResultToMatrix(result), truncated: !!result.truncated };
  },

  summarize(query) {
    const dimensions = query.report.dimensions?.map((item) => item.name).filter(Boolean).join(', ') || 'no dimensions';
    const metrics = query.report.metrics?.map((item) => item.name).filter(Boolean).join(', ') || 'no metrics';
    const dateRange = query.report.dateRanges?.[0];
    const dateLabel = dateRange ? `${dateRange.startDate} to ${dateRange.endDate}` : 'default dates';
    return `${query.propertyId || 'No property'} - ${dimensions} - ${metrics} - ${dateLabel}`;
  },

  defaultTitle(query) {
    return `Analytics: ${query.propertyId}`;
  },

  toPayload(query): GaQuery {
    return { propertyId: query.propertyId.trim(), report: query.report };
  },

  describeShape() {
    return {
      type: 'google-analytics',
      summary: 'A Google Analytics query is a GA4 runReport spec: a propertyId plus a nested report object.',
      payloadSchema: [
        '{ propertyId: string, report: {',
        '  dateRanges?: [{ startDate: string, endDate: string }],   // GA dates: "YYYY-MM-DD", "30daysAgo", "today", "yesterday".',
        '  // The backend normalizes legacy variants like "10weeksAgo" to "70daysAgo".',
        '  dimensions?: [{ name: string }],   // GA4 dimension apiNames, e.g. { name: "date" }, { name: "sessionSource" }',
        '  metrics?: [{ name: string }],      // GA4 metric apiNames, e.g. { name: "activeUsers" }, { name: "sessions" }',
        '  dimensionFilter?: object,          // GA4 FilterExpression (optional)',
        '  metricFilter?: object,             // GA4 FilterExpression (optional)',
        '  orderBys?: [object],               // e.g. [{ dimension: { dimensionName: "date" } }] or [{ metric: { metricName: "sessions" }, desc: true }]',
        '  limit?: number',
        '} }',
      ].join('\n'),
      requiredFields: ['propertyId', 'report'],
      examples: [
        {
          propertyId: '123456789',
          report: {
            dateRanges: [{ startDate: '30daysAgo', endDate: 'today' }],
            dimensions: [{ name: 'date' }, { name: 'sessionSource' }],
            metrics: [{ name: 'sessions' }, { name: 'activeUsers' }],
            orderBys: [{ dimension: { dimensionName: 'date' } }],
            limit: 1000,
          },
        },
      ],
      notes:
        'dimensions/metrics are arrays of { name } objects (not bare strings). Dates live under dateRanges[0].startDate/endDate, never at the top level. Use describeConnection to fetch valid dimension/metric apiNames for the property.',
    };
  },

  reconcileWithSchemaToken(query, scope) {
    if (scope.propertyId !== query.propertyId) {
      return { query: null, error: 'schemaToken does not match the requested Google Analytics property' };
    }
    return { query, error: null };
  },
};
