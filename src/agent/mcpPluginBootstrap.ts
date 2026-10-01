const MCP_TOKEN_PATTERN = /^[a-f0-9]{48}$/;

export interface PluginMcpConfig {
  token: string;
  mcpUrl: string;
  bridgeWsUrl: string;
  enabled: true;
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
  if (!isPluginLaunch || !MCP_TOKEN_PATTERN.test(token)) return null;

  const websocketOrigin = url.origin.replace(/^http/, 'ws');
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
  url.hash = fragmentParams.toString();
  return url.toString();
}
