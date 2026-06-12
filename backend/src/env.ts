export type Env = {
  DB: D1Database;
  CANVAS_BRIDGE: DurableObjectNamespace;
  ALLOWED_ORIGINS?: string;
  DEFAULT_TIMEOUT_MS?: string;
  MAX_ROWS?: string;
  ENCRYPTION_KEY_B64: string;
  API_BEARER_TOKEN?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  GOOGLE_GENERATIVE_AI_API_KEY?: string;
  AGENT_MODEL?: string;
  AGENT_DAILY_LIMIT?: string;
  AGENT_FLOW_DEBUG?: string;
  AGENT_QUOTA?: KVNamespace;
  ENVIRONMENT?: string;
};
