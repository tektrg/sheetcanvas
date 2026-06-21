import type { ConnectorType } from '../../types';
import type { ConnectorQueryProvider, NormalizedConnectorQuery } from './types';

const providers = new Map<ConnectorType, ConnectorQueryProvider<any>>();

export function registerConnectorQueryProvider(provider: ConnectorQueryProvider<any>): void {
  providers.set(provider.type, provider);
}

export function getConnectorQueryProvider(
  type: ConnectorType,
): ConnectorQueryProvider<NormalizedConnectorQuery> | null {
  return (providers.get(type) as ConnectorQueryProvider<NormalizedConnectorQuery> | undefined) ?? null;
}

export function requireConnectorQueryProvider(
  type: ConnectorType,
): ConnectorQueryProvider<NormalizedConnectorQuery> {
  const provider = getConnectorQueryProvider(type);
  if (!provider) throw new Error(`No connector query provider registered for type: ${type}`);
  return provider;
}

export function listConnectorQueryProviderTypes(): ConnectorType[] {
  return Array.from(providers.keys());
}
