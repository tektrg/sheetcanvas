import { describe, expect, it } from 'vitest';
import {
  SHEETCANVAS_APP_RESOURCE_URI,
  SHEETCANVAS_APP_TOOL,
  SHEETCANVAS_PUBLIC_APP_RESOURCE_URI,
  SHEETCANVAS_PUBLIC_APP_TOOL,
  buildSheetCanvasAppResource,
  buildPublicSheetCanvasAppResource,
} from '../mcp/pluginUi';

const TOKEN = 'a'.repeat(48);

describe('SheetCanvas ChatGPT app surface', () => {
  it('advertises a fullscreen global entrypoint linked to its MCP App resource', () => {
    expect(SHEETCANVAS_APP_TOOL).toMatchObject({
      name: 'openSheetCanvas',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
      },
      outputSchema: {
        type: 'object',
        properties: {
          ready: { type: 'boolean' },
        },
        required: ['ready'],
        additionalProperties: false,
      },
      _meta: {
        ui: { resourceUri: SHEETCANVAS_APP_RESOURCE_URI },
        'openai/ui': {
          entrypoints: [{ type: 'global' }],
        },
      },
    });
  });

  it('returns a sandbox-safe fullscreen wrapper for the token-bound canvas', () => {
    const resource = buildSheetCanvasAppResource(TOKEN);

    expect(resource).toMatchObject({
      uri: SHEETCANVAS_APP_RESOURCE_URI,
      mimeType: 'text/html;profile=mcp-app',
      _meta: {
        ui: {
          domain: 'https://sheetcanvas.com',
          csp: {
            frameDomains: ['https://sheetcanvas.com'],
          },
        },
        'openai/ui': {
          availableDisplayModes: ['fullscreen'],
        },
      },
    });
    expect(resource.text).toContain(
      `https://sheetcanvas.com/?chatgpt_plugin=1#mcp_token=${TOKEN}`,
    );
    expect(resource.text).not.toContain(`?mcp_token=${TOKEN}`);
    expect(resource.text).not.toContain(`&mcp_token=${TOKEN}`);
  });

  it('keeps the public resource cache-safe and receives its bridge session from widget-only metadata', () => {
    expect(SHEETCANVAS_PUBLIC_APP_TOOL).toMatchObject({
      outputSchema: {
        required: ['ready'],
        additionalProperties: false,
      },
      _meta: {
        ui: {
          resourceUri: SHEETCANVAS_PUBLIC_APP_RESOURCE_URI,
          visibility: ['model', 'app'],
        },
      },
    });

    const resource = buildPublicSheetCanvasAppResource();
    expect(resource.uri).toBe(SHEETCANVAS_PUBLIC_APP_RESOURCE_URI);
    expect(resource.text).toContain('window.openai.toolResponseMetadata');
    expect(resource.text).not.toContain('window.openai.toolOutput');
    expect(resource.text).toContain('mcp_session');
    expect(resource.text).not.toMatch(/p_[a-f0-9]{64}/);
    expect(resource.text).not.toContain('mcp_token');
  });
});
