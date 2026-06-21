import type {
  ConnectionSchemaScope,
  ConnectorQueryPayload,
  ConnectorType,
  GoogleAnalyticsReport,
} from '../../types';

// Flat, self-describing query used as the currency between modules (UI, tools, refresh).
// The `type` field is the discriminant; the remaining fields are the connector-owned payload.
export type NormalizedConnectorQuery =
  | { type: 'clickhouse'; sql: string }
  | { type: 'google-analytics'; propertyId: string; report: GoogleAnalyticsReport }
  | { type: 'google-sheets'; spreadsheetIdOrUrl: string; range: string };

export type ConnectorQueryExecution = {
  matrix: string[][];
  truncated: boolean;
};

// Self-describing payload contract a provider hands to the agent so it can build a valid
// query without guessing the connector-specific shape. Surfaced through describeConnection.
export interface ConnectorQueryShape {
  type: ConnectorType;
  /** One-line description of what a query means for this connector. */
  summary: string;
  /** Human/agent-readable description of every field in the queryPayload. */
  payloadSchema: string;
  /** Payload keys that must be present and non-empty. */
  requiredFields: string[];
  /** Worked example payloads (the exact `queryPayload` shape) the agent can copy and adapt. */
  examples: ConnectorQueryPayload[];
  /** Extra constraints or gotchas (e.g. ClickHouse table aliasing, GA date formats). */
  notes?: string;
}

// Outcome of reconciling a normalized query against the schemaToken it was built from.
// Lets each provider own its create-time checks/rewrites instead of branching in the tool layer.
// Flat shape (not a discriminated union) so callers test `error` truthiness without relying on
// strict-mode narrowing, which this project does not enable.
export interface ReconcileResult<Q> {
  /** The reconciled query, or null when reconciliation rejected it. */
  query: Q | null;
  /** Human-readable rejection reason, or null when reconciliation succeeded. */
  error: string | null;
}

// A connector query provider owns every connector-specific decision about a query:
// how to build it from loose input, validate it, run it, summarize it, and persist it.
// Adding a new connector means registering one provider — no branching elsewhere.
export interface ConnectorQueryProvider<Q extends NormalizedConnectorQuery = NormalizedConnectorQuery> {
  type: ConnectorType;
  /** Schema version written into the persisted query envelope. */
  version: number;
  /** Build a canonical query from a loose payload (stored payload, tool input, or form fields). */
  normalize(raw: Record<string, unknown>): Q;
  /** Returns an error message when the query is invalid, otherwise null. */
  validate(query: Q): string | null;
  /** Run the query against the backend and return a matrix plus source-truncation flag. */
  execute(connectionId: string, query: Q): Promise<ConnectorQueryExecution>;
  /** One-line human-readable summary for the sheet header. */
  summarize(query: Q): string;
  /** Default sheet title when the caller supplies none. */
  defaultTitle(query: Q): string;
  /** Reduce a query to the connector-owned payload persisted inside the envelope. */
  toPayload(query: Q): ConnectorQueryPayload;
  /** Self-describing payload contract so the agent learns the shape instead of guessing it. */
  describeShape(): ConnectorQueryShape;
  /**
   * Reconcile a freshly-normalized query against the schemaToken it was built from:
   * apply connector-specific rewrites (e.g. ClickHouse table alias) and reject mismatches
   * (e.g. a GA property that does not match the described one).
   */
  reconcileWithSchemaToken(query: Q, scope: ConnectionSchemaScope): ReconcileResult<Q>;
}
