const MCP_TOKEN_PATTERN = /^[a-f0-9]{48}$/;
const MCP_PUBLIC_SESSION_PATTERN = /^p_[a-f0-9]{64}$/;

export interface PluginMcpConfig {
  token: string;
  mcpUrl: string;
  bridgeWsUrl: string;
  enabled: true;
  ephemeral?: true;
}

export function readPluginMcpConfig(href: string): PluginMcpConfig | null {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }

  const isPluginLaunch = url.searchParams.get('chatgpt_plugin') === '1';
  const fragmentParams = new URLSearchParams(url.hash.slice(1));
  const token = fragmentParams.get('mcp_token') ?? '';
  const publicSession = fragmentParams.get('mcp_session') ?? '';
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
