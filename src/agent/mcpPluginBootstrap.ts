const MCP_TOKEN_PATTERN = /^[a-f0-9]{48}$/;
const MCP_PUBLIC_SESSION_PATTERN = /^p_[a-f0-9]{64}$/;

export interface PluginMcpConfig {
  token: string;
  mcpUrl: string;
  bridgeWsUrl: string;
  enabled: true;
  ephemeral?: true;
}

export function readPluginMcpConfig(href: string, historyState?: unknown): PluginMcpConfig | null {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }

  const isPluginLaunch = url.searchParams.get('chatgpt_plugin') === '1';
  const fragmentParams = new URLSearchParams(url.hash.slice(1));
  const privateCached = (historyState as { sheetcanvasPrivateSession?: { origin?: unknown; token?: unknown } } | null)?.sheetcanvasPrivateSession;
  const recoveredPrivate = url.searchParams.get('chatgpt_private') === '1' && privateCached?.origin === url.origin && typeof privateCached.token === 'string'
    ? privateCached.token : '';
  const token = fragmentParams.get('mcp_token') ?? recoveredPrivate;
  const cached = (historyState as { sheetcanvasPublicSession?: { origin?: unknown; token?: unknown } } | null)?.sheetcanvasPublicSession;
  const recoveredSession = url.searchParams.get('chatgpt_public') === '1' && cached?.origin === url.origin && typeof cached.token === 'string'
    ? cached.token : '';
  const publicSession = fragmentParams.get('mcp_session') ?? recoveredSession;
  if (!isPluginLaunch) return null;

  const websocketOrigin = url.origin.replace(/^http/, 'ws');
  if (MCP_PUBLIC_SESSION_PATTERN.test(publicSession)) {
    return {
      token: publicSession,
      mcpUrl: `${url.origin}/mcp`,
      bridgeWsUrl: `${websocketOrigin}/api/mcp/public-bridge/${publicSession}`,
      enabled: true,
      ephemeral: true,
    };
  }
  if (fragmentParams.has('mcp_session') || url.searchParams.get('chatgpt_public') === '1') return null;
  if (!MCP_TOKEN_PATTERN.test(token)) return null;
  return {
    token,
    mcpUrl: `${url.origin}/mcp/${token}`,
    bridgeWsUrl: `${websocketOrigin}/api/mcp/bridge/${token}`,
    enabled: true,
  };
}

export function stripPluginCredentialsFromUrl(href: string): string {
  const url = new URL(href);
  const fragmentParams = new URLSearchParams(url.hash.slice(1));
  fragmentParams.delete('mcp_token');
  fragmentParams.delete('mcp_session');
  url.hash = fragmentParams.toString();
  return url.toString();
}

// Capability recovery is scoped to the current history entry, not browser-wide
// persistent storage. A harmless URL marker prevents private fallback on reload.
export function sanitizePluginLaunchUrl(href: string, historyState?: unknown): string {
  const config = readPluginMcpConfig(href, historyState);
  if (config) {
    const url = new URL(stripPluginCredentialsFromUrl(href));
    url.searchParams.set(config.ephemeral ? 'chatgpt_public' : 'chatgpt_private', '1');
    return url.toString();
  }
  return stripPluginCredentialsFromUrl(href);
}

export function pluginHistoryState(href: string, historyState: unknown): unknown {
  const config = readPluginMcpConfig(href, historyState);
  if (!config) return historyState;
  return {
    ...(typeof historyState === 'object' && historyState !== null ? historyState : {}),
    [config.ephemeral ? 'sheetcanvasPublicSession' : 'sheetcanvasPrivateSession']: { origin: new URL(href).origin, token: config.token },
  };
}

export function isPublicPluginLaunch(href: string, historyState?: unknown): boolean {
  try {
    const url = new URL(href);
    if (url.searchParams.get('chatgpt_plugin') !== '1') return false;
    const fragment = new URLSearchParams(url.hash.slice(1));
    // Missing/malformed capabilities must remain isolated, never load the
    // browser's private workspace or stored private bridge configuration.
    return url.searchParams.get('chatgpt_public') === '1' || fragment.has('mcp_session') || !readPluginMcpConfig(href, historyState);
  } catch {
    return false;
  }
}

export function isPublicCanvasEnvironment(): boolean {
  return typeof window !== 'undefined' && isPublicPluginLaunch(window.location.href, window.history?.state);
}
