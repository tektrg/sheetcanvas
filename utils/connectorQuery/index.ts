import { clickhouseQueryProvider } from './clickhouseProvider';
import { googleAnalyticsQueryProvider } from './googleAnalyticsProvider';
import { googleSheetsQueryProvider } from './googleSheetsProvider';
import { registerConnectorQueryProvider } from './registry';

// Register the built-in connector query providers. Future connectors register here.
registerConnectorQueryProvider(clickhouseQueryProvider);
registerConnectorQueryProvider(googleAnalyticsQueryProvider);
registerConnectorQueryProvider(googleSheetsQueryProvider);

export {
  getConnectorQueryProvider,
  requireConnectorQueryProvider,
  registerConnectorQueryProvider,
  listConnectorQueryProviderTypes,
} from './registry';
export { rewriteClickhouseSqlForDescribedTable } from './clickhouseProvider';
export type {
  ConnectorQueryProvider,
  ConnectorQueryExecution,
  ConnectorQueryShape,
  NormalizedConnectorQuery,
  ReconcileResult,
} from './types';
