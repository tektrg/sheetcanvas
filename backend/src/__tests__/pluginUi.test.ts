import { describe, expect, it } from 'vitest';
import { parse, type DefaultTreeAdapterMap } from 'parse5';
import {
  SHEETCANVAS_APP_RESOURCE_URI,
  SHEETCANVAS_APP_TOOL,
  SHEETCANVAS_PUBLIC_APP_RESOURCE_URI,
  SHEETCANVAS_PUBLIC_APP_TOOL,
  buildSheetCanvasAppResource,
  buildPublicSheetCanvasAppResource,
} from '../mcp/pluginUi';

const TOKEN = 'a'.repeat(48);
const PUBLIC_SESSION = `p_${'b'.repeat(64)}`;

function htmlElements(html: string) {
  const elements: DefaultTreeAdapterMap['element'][] = [];
  function visit(node: DefaultTreeAdapterMap['node']) {
    if ('tagName' in node) elements.push(node);
    if ('childNodes' in node) node.childNodes.forEach(visit);
  }
  visit(parse(html));
  return elements;
}

function runPublicWidget(metadata: unknown) {
  const elements = htmlElements(buildPublicSheetCanvasAppResource().text);
  const scripts = elements.filter((element) => element.tagName === 'script');
  // An HTML iframe is not void: a self-closing iframe swallows the script as text.
  expect(scripts).toHaveLength(1);
  expect(scripts[0].parentNode).not.toMatchObject({ tagName: 'iframe' });
  const navigations: string[] = [];
  const iframe = {
    get src() { return navigations.at(-1) ?? ''; },
    set src(value: string) { navigations.push(value); },
  };
  const listeners = new Map<string, (event: unknown) => void>();
  const hostMessages: unknown[] = [];
  const parent = { postMessage: (message: unknown) => hostMessages.push(message) };
  const window = {
    parent,
    openai: { toolResponseMetadata: metadata },
    addEventListener: (name: string, listener: (event: unknown) => void) => listeners.set(name, listener),
  };
  const script = scripts[0].childNodes.map((node) => 'value' in node ? node.value : '').join('');
  // Execute only our generated static bootstrap with explicit browser globals.
  const executeBootstrap = new Function('window', 'document', 'URL', 'URLSearchParams', script);
  executeBootstrap(
    window,
    { getElementById: () => iframe },
    URL,
    URLSearchParams,
  );
  return {
    iframe,
    navigations,
    hostMessages,
    message: (data: unknown, trustedParent = true) => listeners.get('message')?.({
      source: trustedParent ? parent : {}, data,
    }),
    update: (nextMetadata: unknown) => listeners.get('openai:set_globals')?.({
      detail: { globals: { toolResponseMetadata: nextMetadata } },
    }),
  };
}

describe('SheetCanvas ChatGPT app surface', () => {
  it('versions the corrected public bootstrap separately from the private resource', () => {
    // Resource URIs are host cache keys: the standard bridge must not reuse v2.
    expect(SHEETCANVAS_PUBLIC_APP_RESOURCE_URI).toBe('ui://sheetcanvas/workspace-public-v3.html');
    expect(SHEETCANVAS_PUBLIC_APP_TOOL._meta.ui.resourceUri).toBe(SHEETCANVAS_PUBLIC_APP_RESOURCE_URI);
    expect(buildPublicSheetCanvasAppResource().uri).toBe(SHEETCANVAS_PUBLIC_APP_RESOURCE_URI);
    expect(SHEETCANVAS_APP_RESOURCE_URI).toBe('ui://sheetcanvas/workspace-v1.html');
  });

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

  it('parses the private iframe as a closed element with no fallback document markup', () => {
    const iframe = htmlElements(buildSheetCanvasAppResource(TOKEN).text)
      .find((element) => element.tagName === 'iframe');
    expect(iframe?.childNodes).toEqual([]);
  });

  it.each([
    { bridgeSession: PUBLIC_SESSION },
    { _meta: { bridgeSession: PUBLIC_SESSION } },
    { status: 'success', call_tool_result: { _meta: { bridgeSession: PUBLIC_SESSION } } },
    { status: 'success', mcp_tool_result: { _meta: { bridgeSession: PUBLIC_SESSION } } },
    { call_tool_result: { mcp_tool_result: { _meta: { bridgeSession: PUBLIC_SESSION } } } },
  ])('executes the parsed bootstrap using hidden metadata shape %#', (metadata) => {
    const { iframe } = runPublicWidget(metadata);
    expect(iframe.src).toBe(`https://sheetcanvas.com/?chatgpt_plugin=1#mcp_session=${PUBLIC_SESSION}`);
  });

  it('receives delayed host metadata and ignores invalid or model-visible credentials', () => {
    const widget = runPublicWidget(undefined);
    widget.update({ structuredContent: { bridgeSession: PUBLIC_SESSION } });
    widget.update({ _meta: { bridgeSession: 'https://untrusted.example/' } });
    widget.update({ arbitrary: { _meta: { bridgeSession: PUBLIC_SESSION } } });
    expect(widget.iframe.src).toBe('');
    widget.update({ mcp_tool_result: { _meta: { bridgeSession: PUBLIC_SESSION } } });
    expect(widget.iframe.src).toBe(`https://sheetcanvas.com/?chatgpt_plugin=1#mcp_session=${PUBLIC_SESSION}`);
  });

  it('initializes the standard host bridge before acknowledging readiness', () => {
    const widget = runPublicWidget(undefined);
    expect(widget.hostMessages).toEqual([{
      jsonrpc: '2.0', id: 'sheetcanvas-initialize', method: 'ui/initialize',
      params: {
        appInfo: { name: 'sheetcanvas-widget', version: '1.0.1' },
        appCapabilities: {}, protocolVersion: '2026-01-26',
      },
    }]);
    widget.message({ jsonrpc: '2.0', id: 'other', result: {} });
    widget.message({ jsonrpc: '2.0', id: 'sheetcanvas-initialize', result: {} }, false);
    expect(widget.hostMessages).toHaveLength(1);
    widget.message({ jsonrpc: '2.0', id: 'sheetcanvas-initialize', result: {} });
    widget.message({ jsonrpc: '2.0', id: 'sheetcanvas-initialize', result: {} });
    expect(widget.hostMessages).toHaveLength(2);
    expect(widget.hostMessages[1]).toEqual({
      jsonrpc: '2.0', method: 'ui/notifications/initialized', params: {},
    });
  });

  it('switches an existing canvas only for valid parent tool-result hidden metadata', () => {
    const widget = runPublicWidget({ bridgeSession: PUBLIC_SESSION });
    const nextSession = `p_${'c'.repeat(64)}`;
    const result = { jsonrpc: '2.0', method: 'ui/notifications/tool-result', params: { _meta: { bridgeSession: nextSession } } };
    widget.message(result, false);
    widget.message({ ...result, jsonrpc: '1.0' });
    widget.message({ ...result, method: 'ui/notifications/tool-input' });
    widget.message({ ...result, id: 'unexpected-request' });
    widget.message({ ...result, params: { structuredContent: { bridgeSession: nextSession } } });
    widget.message({ ...result, params: { _meta: { bridgeSession: 'invalid' } } });
    widget.message({ ...result, params: {} });
    expect(widget.navigations).toHaveLength(1);
    widget.message(result);
    expect(widget.iframe.src).toBe(`https://sheetcanvas.com/?chatgpt_plugin=1#mcp_session=${nextSession}`);
    widget.message(result);
    expect(widget.navigations).toHaveLength(2);
  });

  it('boots without compatibility globals using a standard tool result', () => {
    const widget = runPublicWidget(undefined);
    widget.message({ jsonrpc: '2.0', method: 'ui/notifications/tool-result', params: {
      _meta: { bridgeSession: PUBLIC_SESSION },
    } });
    expect(widget.iframe.src).toBe(`https://sheetcanvas.com/?chatgpt_plugin=1#mcp_session=${PUBLIC_SESSION}`);
  });

  it('does not acknowledge a failed bridge initialization', () => {
    const widget = runPublicWidget(undefined);
    widget.message({ jsonrpc: '2.0', id: 'sheetcanvas-initialize', error: { code: -32601 } });
    expect(widget.hostMessages).toHaveLength(1);
    expect(widget.iframe.src).toBe('');
  });
});
