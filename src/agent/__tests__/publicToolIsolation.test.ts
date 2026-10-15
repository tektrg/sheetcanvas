import { afterEach, describe, expect, it, vi } from 'vitest';
import { PUBLIC_CONNECTOR_TOOL_NAMES } from '../../../agent/publicToolPolicy';
import { dispatchTool, type ToolDoor } from '../webmcp/toolDispatch';
import { getRegisteredToolNames, reconcileWebMcpTools, setRegistryEnabled } from '../webmcp/webmcpRegistry';
import { setPublicCanvasReady } from '../publicCanvasSession';
import { useStore } from '../../../store';

const publicHref = `https://sheetcanvas.com/?chatgpt_plugin=1#mcp_session=p_${'a'.repeat(64)}`;
afterEach(() => { vi.unstubAllGlobals(); setPublicCanvasReady(false); });

describe('anonymous tool isolation across browser doors', () => {
  it('rejects every connector tool before fetching any private data on every door', async () => {
    vi.stubGlobal('window', { location: { href: publicHref }, history: { state: null } });
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    for (const door of ['chatgpt', 'remote-mcp', 'copilot', 'eval'] as ToolDoor[]) {
      for (const name of PUBLIC_CONNECTOR_TOOL_NAMES) {
        const result = await dispatchTool(name, {}, {
          door, getSelection: () => ({ sheetId: null, cellId: null, range: null }),
        });
        expect(result.ok).toBe(false);
        expect(result.error).toMatch(/not available.*temporary/i);
      }
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it('removes connector registry entries immediately when a document becomes public', async () => {
    setPublicCanvasReady(true);
    vi.stubGlobal('document', { modelContext: { registerTool: vi.fn(async () => undefined) } });
    vi.stubGlobal('window', { location: { href: 'https://sheetcanvas.com/' }, history: { state: null } });
    setRegistryEnabled(true);
    await reconcileWebMcpTools('normal');
    expect(getRegisteredToolNames()).toContain('listConnections');
    vi.stubGlobal('window', { location: { href: publicHref }, history: { state: null } });
    await reconcileWebMcpTools('public');
    for (const name of PUBLIC_CONNECTOR_TOOL_NAMES) expect(getRegisteredToolNames()).not.toContain(name);
    expect(getRegisteredToolNames()).toContain('createSheet');
    vi.stubGlobal('document', undefined);
    await reconcileWebMcpTools('cleanup');
  });
  it('blocks canvas writes and tool registration until the public snapshot is restored', async () => {
    vi.stubGlobal('window', { location: { href: publicHref }, history: { state: null } });
    vi.stubGlobal('document', { modelContext: { registerTool: vi.fn(async () => undefined) } });
    setPublicCanvasReady(false);
    const before = useStore.getState().sheetIds;
    const result = await dispatchTool('createSheet', { title: 'Too early' }, {
      door: 'chatgpt', getSelection: () => ({ sheetId: null, cellId: null, range: null }),
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/connecting or restoring/i);
    expect(useStore.getState().sheetIds).toBe(before);
    await reconcileWebMcpTools('pending');
    expect(getRegisteredToolNames()).toEqual([]);
    setPublicCanvasReady(true);
    await reconcileWebMcpTools('restored');
    expect(getRegisteredToolNames()).toContain('createSheet');
    vi.stubGlobal('document', undefined);
    await reconcileWebMcpTools('cleanup');
  });
});
