import { describe, expect, it } from 'vitest';
import {
  readPluginMcpConfig,
  stripPluginCredentialsFromUrl,
  isPublicPluginLaunch,
  sanitizePluginLaunchUrl,
  pluginHistoryState,
} from '../mcpPluginBootstrap';

const TOKEN = 'b'.repeat(48);
const PUBLIC_SESSION = `p_${'c'.repeat(64)}`;

describe('ChatGPT plugin MCP bootstrap', () => {
  it('preserves the public capability for iframe reload without accepting a private fallback', () => {
    const launch = `https://sheetcanvas.com/?chatgpt_plugin=1#mcp_session=${PUBLIC_SESSION}`;
    const cleaned = sanitizePluginLaunchUrl(launch);
    const state = pluginHistoryState(launch, { other: 1 });
    expect(cleaned).not.toContain(PUBLIC_SESSION);
    expect(readPluginMcpConfig(cleaned, state)?.token).toBe(PUBLIC_SESSION);
    expect(readPluginMcpConfig(cleaned)).toBeNull();
    expect(readPluginMcpConfig(cleaned.replace('sheetcanvas.com', 'other.example'), state)).toBeNull();
    expect(readPluginMcpConfig('https://sheetcanvas.com/', state)).toBeNull();
    expect(readPluginMcpConfig(`https://sheetcanvas.com/?chatgpt_plugin=1#mcp_session=bad&mcp_token=${TOKEN}`)).toBeNull();
    expect(isPublicPluginLaunch('https://sheetcanvas.com/?chatgpt_plugin=1')).toBe(true);
    expect(isPublicPluginLaunch('https://sheetcanvas.com/?chatgpt_plugin=1#mcp_session=bad')).toBe(true);
    expect(isPublicPluginLaunch(`https://sheetcanvas.com/?chatgpt_plugin=1#mcp_token=${TOKEN}`)).toBe(false);
  });
  it('recovers a private plugin capability only from the validated private history entry', () => {
    const launch = `https://sheetcanvas.com/?chatgpt_plugin=1#mcp_token=${TOKEN}`;
    const cleaned = sanitizePluginLaunchUrl(launch);
    const state = pluginHistoryState(launch, null);
    expect(cleaned).not.toContain(TOKEN);
    expect(readPluginMcpConfig(cleaned, state)?.token).toBe(TOKEN);
    expect(isPublicPluginLaunch(cleaned, state)).toBe(false);
    expect(isPublicPluginLaunch(cleaned)).toBe(true);
    expect(readPluginMcpConfig(cleaned.replace('sheetcanvas.com', 'other.example'), state)).toBeNull();
  });
  it('turns a valid plugin token into an enabled same-origin bridge config', () => {
    expect(
      readPluginMcpConfig(`https://sheetcanvas.com/?chatgpt_plugin=1#mcp_token=${TOKEN}`),
    ).toEqual({
      token: TOKEN,
      mcpUrl: `https://sheetcanvas.com/mcp/${TOKEN}`,
      bridgeWsUrl: `wss://sheetcanvas.com/api/mcp/bridge/${TOKEN}`,
      enabled: true,
    });
  });

  it('rejects malformed or non-plugin token parameters', () => {
    expect(readPluginMcpConfig(`https://sheetcanvas.com/#mcp_token=${TOKEN}`)).toBeNull();
    expect(readPluginMcpConfig('https://sheetcanvas.com/?chatgpt_plugin=1#mcp_token=bad')).toBeNull();
  });

  it('turns a public plugin session into an ephemeral same-origin bridge config', () => {
    expect(
      readPluginMcpConfig(
        `https://sheetcanvas.com/?chatgpt_plugin=1#mcp_session=${PUBLIC_SESSION}`,
      ),
    ).toEqual({
      token: PUBLIC_SESSION,
      mcpUrl: 'https://sheetcanvas.com/mcp',
      bridgeWsUrl: `wss://sheetcanvas.com/api/mcp/public-bridge/${PUBLIC_SESSION}`,
      enabled: true,
      ephemeral: true,
    });
  });

  it('removes capability-bearing parameters while preserving unrelated URL state', () => {
    expect(
      stripPluginCredentialsFromUrl(
        `https://sheetcanvas.com/?chatgpt_plugin=1&theme=dark#mcp_token=${TOKEN}&view=canvas`,
      ),
    ).toBe('https://sheetcanvas.com/?chatgpt_plugin=1&theme=dark#view=canvas');

    expect(
      stripPluginCredentialsFromUrl(
        `https://sheetcanvas.com/?chatgpt_plugin=1#mcp_session=${PUBLIC_SESSION}&view=canvas`,
      ),
    ).toBe('https://sheetcanvas.com/?chatgpt_plugin=1#view=canvas');
  });
});
