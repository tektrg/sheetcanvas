export const SHEETCANVAS_APP_RESOURCE_URI = 'ui://sheetcanvas/workspace-v1.html';
// The host caches HTML by URI; bump this when the public bootstrap changes.
export const SHEETCANVAS_PUBLIC_APP_RESOURCE_URI = 'ui://sheetcanvas/workspace-public-v4.html';
export const SHEETCANVAS_APP_TOOL_NAME = 'openSheetCanvas';

export const SHEETCANVAS_APP_TOOL = {
  name: SHEETCANVAS_APP_TOOL_NAME,
  title: 'Open SheetCanvas',
  description: 'Open the interactive SheetCanvas workspace to inspect, edit, and arrange analysis artifacts.',
  inputSchema: {
    type: 'object',
    properties: {},
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
  annotations: {
    title: 'Open SheetCanvas',
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: false,
  },
  _meta: {
    ui: {
      resourceUri: SHEETCANVAS_APP_RESOURCE_URI,
      visibility: ['app' as const],
    },
    'openai/ui': {
      entrypoints: [{ type: 'global' as const }],
    },
  },
} as const;

export const SHEETCANVAS_PUBLIC_APP_TOOL = {
  ...SHEETCANVAS_APP_TOOL,
  description: 'Open the interactive SheetCanvas workspace before calling canvas tools. Reuse the active canvasHandle when reopening; omit it only to create a new canvas. Pass the returned canvasHandle to every canvas tool. ready=false means the workspace is opening. Keep it visible while working.',
  inputSchema: {
    type: 'object',
    properties: { canvasHandle: { type: 'string', pattern: '^c_[a-f0-9]{64}$' } },
    additionalProperties: false,
  },
  outputSchema: {
    type: 'object',
    properties: {
      ready: { type: 'boolean' },
      canvasHandle: { type: 'string', pattern: '^c_[a-f0-9]{64}$' },
      expiresInSeconds: { type: 'number' },
    },
    required: ['ready', 'canvasHandle', 'expiresInSeconds'],
    additionalProperties: false,
  },
  _meta: {
    ...SHEETCANVAS_APP_TOOL._meta,
    ui: {
      ...SHEETCANVAS_APP_TOOL._meta.ui,
      resourceUri: SHEETCANVAS_PUBLIC_APP_RESOURCE_URI,
      visibility: ['model' as const, 'app' as const],
    },
  },
} as const;

function buildCanvasUrl(token: string): string {
  const url = new URL('https://sheetcanvas.com/');
  url.searchParams.set('chatgpt_plugin', '1');
  url.hash = new URLSearchParams({ mcp_token: token }).toString();
  return url.toString();
}

const SHEETCANVAS_UI_DOMAIN = 'https://sheetcanvas.com';

/**
 * Claude serves an MCP App from its own sandbox origin and requires `ui.domain`
 * to be the first 32 hex chars of SHA-256(server URL) + `.claudemcpcontent.com`.
 * ChatGPT expects the plain site origin, so the caller picks per connection.
 */
export async function claudeUiDomain(serverUrl: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(serverUrl));
  const hex = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 32)}.claudemcpcontent.com`;
}

export function buildSheetCanvasAppResource(token: string, uiDomain: string = SHEETCANVAS_UI_DOMAIN) {
  const canvasUrl = buildCanvasUrl(token);
  const text = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>SheetCanvas</title>
    <style>
      html, body, iframe { width: 100%; height: 100%; margin: 0; border: 0; overflow: hidden; background: #f7f7f5; }
    </style>
  </head>
  <body>
    <iframe src="${canvasUrl}" title="SheetCanvas workspace" allow="clipboard-read; clipboard-write"></iframe>
  </body>
</html>`;

  return {
    uri: SHEETCANVAS_APP_RESOURCE_URI,
    mimeType: 'text/html;profile=mcp-app',
    text,
    _meta: {
      ui: {
        prefersBorder: false,
        domain: uiDomain,
        csp: {
          frameDomains: ['https://sheetcanvas.com'],
        },
      },
      'openai/ui': {
        availableDisplayModes: ['fullscreen'],
      },
      'openai/widgetDescription': 'An interactive canvas for spreadsheets, charts, notes, and connected data analysis.',
      'openai/widgetPrefersBorder': false,
      'openai/widgetDomain': 'https://sheetcanvas.com',
      'openai/widgetCSP': {
        frame_domains: ['https://sheetcanvas.com'],
      },
    },
  } as const;
}

export function buildPublicSheetCanvasAppResource(uiDomain: string = SHEETCANVAS_UI_DOMAIN) {
  const text = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>SheetCanvas</title>
    <style>
      html, body, iframe { width: 100%; height: 100%; margin: 0; border: 0; overflow: hidden; background: #f7f7f5; }
    </style>
  </head>
  <body>
    <iframe id="sheetcanvas" title="SheetCanvas workspace" allow="clipboard-read; clipboard-write"></iframe>
    <script>
      (function () {
        var sessionPattern = /^p_[a-f0-9]{64}$/;
        var handlePattern = /^c_[a-f0-9]{64}$/;
        var iframe = document.getElementById('sheetcanvas');
        var currentSession = '';
        var initializationPending = true;
        var bridgeInitialized = false;
        var currentHandle = '';
        var publishedHandle = '';
        var contextRequestId = 0;

        function readBridgeSession(metadata) {
          if (!metadata || typeof metadata !== 'object') return '';
          // Accept only widget metadata and the documented tool-result envelopes.
          // Never search structuredContent/toolOutput or arbitrary nested objects.
          var callResult = metadata.call_tool_result;
          var mcpResult = metadata.mcp_tool_result;
          var nestedMcpResult = callResult && callResult.mcp_tool_result;
          var candidates = [metadata, metadata._meta, callResult && callResult._meta,
            mcpResult && mcpResult._meta, nestedMcpResult && nestedMcpResult._meta];
          for (var index = 0; index < candidates.length; index += 1) {
            var session = candidates[index] && candidates[index].bridgeSession;
            if (typeof session === 'string' && sessionPattern.test(session)) return candidates[index];
          }
          return '';
        }

        function modelContext() {
          return {
            canvasHandle: currentHandle,
            instruction: 'This is the active SheetCanvas canvas. Pass this canvasHandle to every canvas tool, including openSheetCanvas when reopening. Do not create a new canvas while this handle is active. It grants access only to this temporary anonymous canvas, for at most two hours.'
          };
        }

        function publishModelContext() {
          if (!bridgeInitialized || !currentHandle || publishedHandle === currentHandle) return;
          publishedHandle = currentHandle;
          window.parent.postMessage({
            jsonrpc: '2.0', id: 'sheetcanvas-context-' + (++contextRequestId),
            method: 'ui/update-model-context',
            params: { content: [{ type: 'text', text: JSON.stringify(modelContext()) }] }
          }, '*');
        }

        function render(metadata) {
          var hidden = readBridgeSession(metadata);
          if (!hidden) return;
          var bridgeSession = hidden.bridgeSession;
          var handle = hidden.canvasHandle;
          if (handle !== undefined && (typeof handle !== 'string' || !handlePattern.test(handle))) return;
          if (typeof handle === 'string' && handlePattern.test(handle) && handle !== currentHandle) {
            currentHandle = handle;
            // Persist the intentionally model-visible handle for later floating-chat turns.
            // Never copy hidden metadata or the bridge session into widget state.
            var openai = window.openai;
            if (openai && typeof openai.setWidgetState === 'function') {
              var previous = openai.widgetState;
              var state = { modelContent: modelContext() };
              if (previous && typeof previous === 'object') {
                if (previous.privateContent !== undefined) state.privateContent = previous.privateContent;
                if (previous.imageIds !== undefined) state.imageIds = previous.imageIds;
              }
              try { openai.setWidgetState(state); } catch (_) { /* Standard bridge remains available. */ }
            }
            publishModelContext();
          }
          if (bridgeSession === currentSession) return;
          currentSession = bridgeSession;
          var url = new URL('https://sheetcanvas.com/');
          url.searchParams.set('chatgpt_plugin', '1');
          url.hash = new URLSearchParams({ mcp_session: bridgeSession }).toString();
          iframe.src = url.toString();
        }

        // The host may deliver later tool results through MCP Apps rather than
        // the ChatGPT compatibility globals. Only the embedding parent is trusted.
        window.addEventListener('message', function (event) {
          if (event.source !== window.parent) return;
          var message = event.data;
          if (!message || message.jsonrpc !== '2.0') return;
          if (message.id === 'sheetcanvas-initialize' && initializationPending) {
            initializationPending = false;
            if (!message.error && message.result && typeof message.result === 'object') {
              bridgeInitialized = true;
              window.parent.postMessage({
                jsonrpc: '2.0', method: 'ui/notifications/initialized', params: {}
              }, '*');
              publishModelContext();
            }
            return;
          }
          if (message.id === undefined && message.method === 'ui/notifications/tool-result') {
            render(message.params && message.params._meta);
          }
        }, { passive: true });
        window.parent.postMessage({
          jsonrpc: '2.0', id: 'sheetcanvas-initialize', method: 'ui/initialize',
          params: {
            appInfo: { name: 'sheetcanvas-widget', version: '1.0.1' },
            appCapabilities: {}, protocolVersion: '2026-01-26'
          }
        }, '*');

        window.addEventListener('openai:set_globals', function (event) {
          var globals = event && event.detail && event.detail.globals;
          render(globals && globals.toolResponseMetadata);
        }, { passive: true });
        render(window.openai && window.openai.toolResponseMetadata);
      }());
    </script>
  </body>
</html>`;

  return {
    uri: SHEETCANVAS_PUBLIC_APP_RESOURCE_URI,
    mimeType: 'text/html;profile=mcp-app',
    text,
    _meta: {
      ui: {
        prefersBorder: false,
        domain: uiDomain,
        csp: {
          frameDomains: ['https://sheetcanvas.com'],
        },
      },
      'openai/ui': {
        availableDisplayModes: ['fullscreen'],
      },
      'openai/widgetDescription': 'An interactive canvas for spreadsheets, charts, notes, and connected data analysis.',
      'openai/widgetPrefersBorder': false,
      'openai/widgetDomain': 'https://sheetcanvas.com',
      'openai/widgetCSP': {
        frame_domains: ['https://sheetcanvas.com'],
      },
    },
  } as const;
}
