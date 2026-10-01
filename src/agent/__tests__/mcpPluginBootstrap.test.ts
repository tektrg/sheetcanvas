import { describe, expect, it } from 'vitest';
import {
  readPluginMcpConfig,
  stripPluginCredentialsFromUrl,
} from '../mcpPluginBootstrap';

const TOKEN = 'b'.repeat(48);

describe('ChatGPT plugin MCP bootstrap', () => {
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

  it('removes capability-bearing parameters while preserving unrelated URL state', () => {
    expect(
      stripPluginCredentialsFromUrl(
        `https://sheetcanvas.com/?chatgpt_plugin=1&theme=dark#mcp_token=${TOKEN}&view=canvas`,
      ),
    ).toBe('https://sheetcanvas.com/?chatgpt_plugin=1&theme=dark#view=canvas');
  });
});
