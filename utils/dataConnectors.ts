
import { ConnectorConfig, ConnectorResult } from '../types';
import { googleAnalyticsResultToMatrix, queryGoogleAnalytics, type GoogleAnalyticsReport } from './googleAnalyticsBackend';
import { googleSheetsResultToMatrix, queryGoogleSheets } from './googleSheetsBackend';

/**
 * Simulator function to mimic Google Sheets API response
 */
const mockGoogleSheetsFetch = async (sheetId: string): Promise<string[][]> => {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve([
        ['Date', 'Campaign', 'Impressions', 'Clicks', 'Cost', 'Conversions'],
        ['2024-01-01', 'Winter Sale', '15000', '1200', '500.00', '45'],
        ['2024-01-02', 'Winter Sale', '18000', '1450', '600.00', '52'],
        ['2024-01-03', 'Winter Sale', '16500', '1320', '550.00', '48'],
        ['2024-01-04', 'New Year Promo', '22000', '1800', '800.00', '85'],
        ['2024-01-05', 'New Year Promo', '25000', '2100', '950.00', '92'],
        ['2024-01-06', 'Brand Awareness', '12000', '400', '150.00', '12'],
        ['2024-01-07', 'Brand Awareness', '11500', '380', '140.00', '10'],
        ['2024-01-08', 'Retargeting', '8000', '600', '300.00', '25'],
      ]);
    }, 1500); // Simulate network latency
  });
};

/**
 * Simulator function to mimic Google Analytics Data API response
 */
const mockGoogleAnalyticsFetch = async (propertyId: string): Promise<string[][]> => {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve([
        ['Date', 'Active Users', 'Sessions', 'Bounce Rate'],
        ['2024-03-01', '1204', '1500', '45.2%'],
        ['2024-03-02', '1350', '1620', '42.1%'],
        ['2024-03-03', '1100', '1300', '48.5%'],
        ['2024-03-04', '1450', '1750', '41.0%'],
        ['2024-03-05', '1600', '1900', '39.5%'],
        ['2024-03-06', '1550', '1850', '40.2%'],
        ['2024-03-07', '1800', '2200', '38.0%'],
        ['2024-03-08', '1750', '2100', '39.0%'],
      ]);
    }, 1500);
  });
};

/**
 * Main entry point to fetch data from a connector configuration.
 * In a real app, this would handle OAuth tokens and real API endpoints.
 */
export const fetchDataFromConnector = async (config: ConnectorConfig): Promise<ConnectorResult> => {
  // Check if we are in simulation mode (usually determined by env var or UI toggle)
  // For this demo, we assume simulation if no API Key is present in params (or always true for safety)
  const params = config.params ?? {};
  const simulateParam = params.simulate;
  const isSimulation = simulateParam !== false;

  try {
    if (config.type === 'google-sheets') {
      const query = config.query && 'spreadsheetIdOrUrl' in config.query ? config.query : null;
      const spreadsheetIdOrUrl = String(query?.spreadsheetIdOrUrl || params.spreadsheetIdOrUrl || params.sheetId || '');
      const range = String(query?.range || params.range || '').trim() || undefined;

      if (!isSimulation) {
        const connectorId = String(config.connectionId || params.connectorId || '');
        if (!connectorId) throw new Error('Missing Google Sheets connector');
        const result = await queryGoogleSheets({ connectorId, spreadsheetIdOrUrl, range });
        return {
          title: 'Google Sheets',
          data: googleSheetsResultToMatrix(result),
          truncated: !!result.truncated
        };
      }

      const data = await mockGoogleSheetsFetch(spreadsheetIdOrUrl);
      return {
        title: `G-Sheet Import (${spreadsheetIdOrUrl.substring(0,6)}...)`,
        data
      };

    } else if (config.type === 'google-analytics') {
      const query = config.query && 'propertyId' in config.query ? config.query : null;
      const propertyId = String(query?.propertyId || params.propertyId || '');

      if (!isSimulation) {
        const connectorId = String(config.connectionId || params.connectorId || '');
        if (!connectorId) throw new Error('Missing Google Analytics connector');
        const report = (query?.report || params.report) as GoogleAnalyticsReport | undefined;
        const result = await queryGoogleAnalytics({ connectorId, propertyId, report });
        return {
          title: `Analytics: Prop ${propertyId}`,
          data: googleAnalyticsResultToMatrix(result),
          truncated: !!result.truncated
        };
      }

      const data = await mockGoogleAnalyticsFetch(propertyId);
      return {
        title: `Analytics: Prop ${propertyId}`,
        data
      };

    } else if (config.type === 'csv-url') {
      const url = String(params.url || '');
      // This can actually work for public CORS-enabled CSVs
      try {
        const response = await fetch(url);
        const text = await response.text();
        const rows = text.split('\n').map(r => r.split(','));
        return {
            title: 'CSV Import',
            data: rows
        };
      } catch (e) {
         // Fallback mock if fetch fails due to CORS
         return {
             title: 'CSV Import (Mock)',
             data: [
                 ['Product', 'Q1', 'Q2', 'Q3'],
                 ['Widget A', '100', '120', '150'],
                 ['Widget B', '80', '90', '110'],
             ]
         };
      }
    }

    return { title: 'Unknown', data: [] };
  } catch (err) {
    console.error("Connector Error", err);
    throw err;
  }
};
