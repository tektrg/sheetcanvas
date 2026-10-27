import { describe, expect, it, vi } from 'vitest';

const flag = vi.hoisted(() => ({ enabled: false }));
vi.mock('../diagramsFlag', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../diagramsFlag')>()),
  diagramsEnabled: () => flag.enabled,
}));

import { diagramsEnabled as realDiagramsEnabled } from '../diagramsFlag';
import { executeClientTool } from '../clientToolExecutor';
import { computeDesiredTools, readGatingState } from '../webmcp/webmcpToolGating';

const { diagramsEnabled: actualFlag } = await vi.importActual<typeof import('../diagramsFlag')>('../diagramsFlag');
const resolver = { getSelection: () => ({ sheetId: null, cellId: null, range: null }) };
const gating = (diagramIds: string[]) =>
  computeDesiredTools(readGatingState({ sheetIds: [], noteIds: [], diagramIds, privateQueryResultIds: [], connectionSchemaTokens: {}, sheets: {} } as any));

describe('browser diagrams flag', () => {
  it('is on in dev, or in production only with VITE_DIAGRAMS_ENABLED=true', () => {
    expect(actualFlag({ DEV: true })).toBe(true);
    expect(actualFlag({ DEV: false })).toBe(false);
    expect(actualFlag({ DEV: false, VITE_DIAGRAMS_ENABLED: 'true' })).toBe(true);
    expect(realDiagramsEnabled).toBeTypeOf('function');
  });

  it('enables diagrams via ?diagrams=1 or localStorage', () => {
    const originalWindow = (globalThis as any).window;

    try {
      const storage = new Map<string, string>();
      (globalThis as any).window = {
        location: new URL('https://sheetcanvas.com/?diagrams=1'),
        localStorage: {
          getItem: (k: string) => storage.get(k) ?? null,
          setItem: (k: string, v: string) => storage.set(k, v),
          removeItem: (k: string) => storage.delete(k),
        },
      };
      expect(actualFlag({ DEV: false })).toBe(true);

      (globalThis as any).window.location = new URL('https://sheetcanvas.com/');
      expect(actualFlag({ DEV: false })).toBe(false);

      (globalThis as any).window.localStorage.setItem('diagrams_enabled', 'true');
      expect(actualFlag({ DEV: false })).toBe(true);
    } finally {
      (globalThis as any).window = originalWindow;
    }
  });

  it('when off: WebMCP hides every diagram tool and the executor refuses them', async () => {
    flag.enabled = false;
    const desired = gating(['d1']);
    for (const tool of ['createDiagram', 'listDiagrams', 'readDiagram', 'updateDiagramElement', 'addToDiagram'] as const) {
      expect(desired.has(tool)).toBe(false);
    }
    expect(await executeClientTool('createDiagram', { kind: 'orgchart', spec: { nodes: [{ id: 'a', label: 'A' }] } }, resolver))
      .toEqual({ ok: false, error: 'diagrams disabled' });
  });

  it('when on: createDiagram is offered', () => {
    flag.enabled = true;
    expect(gating([]).has('createDiagram')).toBe(true);
  });
});
