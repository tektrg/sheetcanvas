export const SHEETCANVAS_APP_RESOURCE_URI = 'ui://sheetcanvas/workspace-v1.html';
export const SHEETCANVAS_PUBLIC_APP_RESOURCE_URI = 'ui://sheetcanvas/workspace-public-v1.html';
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

export function buildSheetCanvasAppResource(token: string) {
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
    <iframe src="${canvasUrl}" title="SheetCanvas workspace" allow="clipboard-read; clipboard-write" />
  </body>
</html>`;

  return {
    uri: SHEETCANVAS_APP_RESOURCE_URI,
    mimeType: 'text/html;profile=mcp-app',
    text,
    _meta: {
      ui: {
        prefersBorder: false,
        domain: 'https://sheetcanvas.com',
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

export function buildPublicSheetCanvasAppResource() {
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
    <iframe id="sheetcanvas" title="SheetCanvas workspace" allow="clipboard-read; clipboard-write" />
    <script>
      (function () {
        var sessionPattern = /^p_[a-f0-9]{64}$/;
        var iframe = document.getElementById('sheetcanvas');
        var currentSession = '';

        function render(metadata) {
          var bridgeSession = metadata && metadata.bridgeSession;
          if (typeof bridgeSession !== 'string' || !sessionPattern.test(bridgeSession)) return;
          if (bridgeSession === currentSession) return;
          currentSession = bridgeSession;
          var url = new URL('https://sheetcanvas.com/');
          url.searchParams.set('chatgpt_plugin', '1');
          url.hash = new URLSearchParams({ mcp_session: bridgeSession }).toString();
          iframe.src = url.toString();
        }

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
        domain: 'https://sheetcanvas.com',
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
