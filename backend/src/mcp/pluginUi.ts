export const SHEETCANVAS_APP_RESOURCE_URI = 'ui://sheetcanvas/workspace-v1.html';
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
