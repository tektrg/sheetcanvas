import type { GoogleSheetsQuery } from '../../types';
import { DEFAULT_GOOGLE_SHEETS_RANGE, googleSheetsResultToMatrix, queryGoogleSheets } from '../googleSheetsBackend';
import type { ConnectorQueryProvider, NormalizedConnectorQuery } from './types';

type GoogleSheetsNormalizedQuery = Extract<NormalizedConnectorQuery, { type: 'google-sheets' }>;

export const googleSheetsQueryProvider: ConnectorQueryProvider<GoogleSheetsNormalizedQuery> = {
  type: 'google-sheets',
  version: 1,

  normalize(raw) {
    return {
      type: 'google-sheets',
      spreadsheetIdOrUrl: String(raw.spreadsheetIdOrUrl ?? '').trim(),
      range: String(raw.range ?? '').trim() || DEFAULT_GOOGLE_SHEETS_RANGE,
    };
  },

  validate(query) {
    return query.spreadsheetIdOrUrl.trim() ? null : 'Google Sheets URL or ID is required';
  },

  async execute(connectionId, query) {
    const result = await queryGoogleSheets({
      connectorId: connectionId,
      spreadsheetIdOrUrl: query.spreadsheetIdOrUrl.trim(),
      range: query.range.trim() || DEFAULT_GOOGLE_SHEETS_RANGE,
    });
    return { matrix: googleSheetsResultToMatrix(result), truncated: !!result.truncated };
  },

  summarize(query) {
    return `${query.spreadsheetIdOrUrl || 'No spreadsheet'} - ${query.range || DEFAULT_GOOGLE_SHEETS_RANGE}`;
  },

  defaultTitle() {
    return 'Google Sheets';
  },

  toPayload(query): GoogleSheetsQuery {
    return { spreadsheetIdOrUrl: query.spreadsheetIdOrUrl.trim(), range: query.range.trim() || DEFAULT_GOOGLE_SHEETS_RANGE };
  },

  describeShape() {
    return {
      type: 'google-sheets',
      summary: 'A Google Sheets query reads a cell range from a spreadsheet (read-only).',
      payloadSchema:
        `{ spreadsheetIdOrUrl: string, range?: string } — range is an A1 notation range; defaults to "${DEFAULT_GOOGLE_SHEETS_RANGE}" when omitted.`,
      requiredFields: ['spreadsheetIdOrUrl'],
      examples: [
        { spreadsheetIdOrUrl: 'https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz/edit', range: 'Sheet1!A1:F1000' },
        { spreadsheetIdOrUrl: '1AbCdEfGhIjKlMnOpQrStUvWxYz', range: DEFAULT_GOOGLE_SHEETS_RANGE },
      ],
      notes: 'Accepts either a full spreadsheet URL or a bare spreadsheet ID. The range is optional.',
    };
  },

  reconcileWithSchemaToken(query) {
    return { query, error: null };
  },
};
