import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('cloudflare:workers', () => ({ DurableObject: class {
  constructor(public ctx: any) {}
} }));
import { CanvasBridge } from '../mcp/bridge';

function setup() {
  const values = new Map<string, unknown>();
  const sockets: any[] = [];
  const ctx = {
    getWebSockets: () => sockets,
    storage: {
      get: async (key: string) => values.get(key),
      put: async (key: string, value: unknown) => { values.set(key, value); },
      delete: async (key: string) => values.delete(key),
      setAlarm: vi.fn(),
    },
  };
  Object.assign(ctx.storage, { transaction: async (callback: any) => callback(ctx.storage) });
  const bridge = new CanvasBridge(ctx as any, {});
  return { bridge, values, sockets, ctx };
}
afterEach(() => vi.useRealTimers());

describe('public canvas readiness', () => {
  it('preserves the old canvas snapshot before handoff and refuses a second concurrent switch', async () => {
    vi.useFakeTimers();
    const { bridge, sockets, ctx } = setup();
    await bridge.initializePublicSession(Date.now() + 100_000);
    const socket = readySocket();
    sockets.push(socket);
    const target = { bridgeSession: `p_${'c'.repeat(64)}`, canvasHandle: `c_${'d'.repeat(64)}` };
    expect(await bridge.handoffPublicCanvas(target)).toBe(false);
    await bridge.webSocketMessage(socket as any, JSON.stringify({ type: 'canvas_ready', supportsWorkspaceHandoff: true }));

    const handoff = bridge.handoffPublicCanvas(target);
    const repeated = bridge.handoffPublicCanvas(target);
    await vi.advanceTimersByTimeAsync(0);
    expect(socket.send).toHaveBeenCalledTimes(1);
    const prep = JSON.parse(socket.send.mock.calls[0][0]);
    expect(prep).toEqual({ id: expect.any(String), type: 'prepare_workspace_handoff' });
    const snapshot = { ...emptySnapshot(), notes: [{ content: 'Preserve this manual edit.' }] };
    await bridge.webSocketMessage(socket as any, JSON.stringify({ id: prep.id, ok: true, snapshot }));
    expect(await handoff).toBe(true);
    expect(await repeated).toBe(false);
    expect(JSON.parse(socket.send.mock.calls[1][0])).toEqual({ type: 'workspace_handoff', ...target });
    expect(await (new CanvasBridge(ctx as any, {}) as any).readPublicSnapshot()).toEqual(snapshot);
    expect(socket.close).not.toHaveBeenCalled();
  });

  it('leaves the source renderer in place when its snapshot cannot be saved', async () => {
    vi.useFakeTimers();
    const { bridge, sockets } = setup();
    await bridge.initializePublicSession(Date.now() + 100_000);
    const socket = readySocket();
    sockets.push(socket);
    await bridge.webSocketMessage(socket as any, JSON.stringify({ type: 'canvas_ready', supportsWorkspaceHandoff: true }));
    const handoff = bridge.handoffPublicCanvas({
      bridgeSession: `p_${'c'.repeat(64)}`,
      canvasHandle: `c_${'d'.repeat(64)}`,
    });
    await vi.advanceTimersByTimeAsync(0);
    const { id } = JSON.parse(socket.send.mock.calls[0][0]);
    await bridge.webSocketMessage(socket as any, JSON.stringify({ id, ok: false }));
    expect(await handoff).toBe(false);
    expect(socket.send).toHaveBeenCalledTimes(1);
    expect(await bridge.getStatus()).toEqual({ browserConnected: true });
  });

  it('stores handle pointers across recreation and deletes them on expiry without renewal', async () => {
    vi.useFakeTimers();
    const { bridge, ctx, values } = setup();
    const session = `p_${'a'.repeat(64)}`;
    const expiresAtMs = Date.now() + 7_200_000;
    await bridge.registerPublicCanvasHandle(session, expiresAtMs);
    const recreated = new CanvasBridge(ctx as any, {});
    expect(await recreated.resolvePublicCanvasHandle(Date.now())).toEqual({ session, expiresAtMs });
    await expect(recreated.registerPublicCanvasHandle(session, expiresAtMs + 1)).rejects.toThrow('already registered');
    await vi.advanceTimersByTimeAsync(7_200_000);
    await recreated.alarm();
    expect(await recreated.resolvePublicCanvasHandle(Date.now())).toBeNull();
    expect(values.has('public-canvas-pointer')).toBe(false);
  });
  it('waits for restoration before dispatching a public call', async () => {
    vi.useFakeTimers();
    const { bridge, sockets } = setup();
    await bridge.initializePublicSession(Date.now() + 100_000);
    const socket = { send: vi.fn(), deserializeAttachment: () => ({ publicReady: false }), serializeAttachment: vi.fn() };
    sockets.push(socket);
    const call = bridge.callTool('listSheets', {});
    await vi.advanceTimersByTimeAsync(50);
    expect(socket.send).not.toHaveBeenCalled();
    await bridge.webSocketMessage(socket as any, JSON.stringify({ type: 'canvas_ready' }));
    await vi.advanceTimersByTimeAsync(50);
    const dispatched = JSON.parse(socket.send.mock.calls[0][0]);
    await bridge.webSocketMessage(socket as any, JSON.stringify({ id: dispatched.id, ok: true, result: [], snapshot: emptySnapshot() }));
    expect(await call).toMatchObject({ ok: true, result: [] });
  });

  it('returns a public-specific bounded startup error', async () => {
    vi.useFakeTimers();
    const { bridge } = setup();
    await bridge.initializePublicSession(Date.now() + 100_000);
    const call = bridge.callTool('listSheets', {});
    await vi.advanceTimersByTimeAsync(15_100);
    expect(await call).toMatchObject({ ok: false, error: expect.stringContaining('Open SheetCanvas') });
  });

  it('persists a successful tool snapshot before returning and recovers after object recreation', async () => {
    vi.useFakeTimers();
    const { bridge, sockets, ctx } = setup();
    await bridge.initializePublicSession(Date.now() + 100_000);
    const socket = readySocket();
    sockets.push(socket);
    const snapshot = { ...emptySnapshot(), sheets: [{ id: 'sheet-1', title: 'Review', cells: {}, position: { x: 0, y: 0 }, size: { rows: 10, cols: 5 } }] };
    const call = bridge.callTool('listSheets', {});
    await vi.advanceTimersByTimeAsync(0);
    const { id } = JSON.parse(socket.send.mock.calls[0][0]);
    await bridge.webSocketMessage(socket as any, JSON.stringify({ id, ok: true, result: ['sheet-1'], snapshot }));
    expect(await call).toMatchObject({ ok: true });
    const recreated = new CanvasBridge(ctx as any, {});
    expect(await (recreated as any).readPublicSnapshot()).toEqual(snapshot);
    expect(await recreated.getStatus()).toEqual({ browserConnected: true });
  });

  it('removes all snapshot chunks at expiry and refuses late snapshot writes', async () => {
    vi.useFakeTimers();
    const { bridge, sockets, values, ctx } = setup();
    await bridge.initializePublicSession(Date.now() + 100);
    const socket = readySocket();
    sockets.push(socket);
    const snapshot = { ...emptySnapshot(), notes: [{ content: 'x'.repeat(100_000) }] };
    await bridge.webSocketMessage(socket as any, JSON.stringify({ type: 'session_snapshot', snapshot }));
    expect(values.get('public-session-snapshot')).toBeGreaterThan(1);
    expect(ctx.storage.setAlarm).toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(101);
    await bridge.alarm();
    expect([...values.keys()].some((key) => key.startsWith('public-session-snapshot'))).toBe(false);
    await bridge.webSocketMessage(socket as any, JSON.stringify({ type: 'session_snapshot', snapshot }));
    expect([...values.keys()].some((key) => key.startsWith('public-session-snapshot'))).toBe(false);
    expect(await bridge.getStatus()).toEqual({ browserConnected: false });
  });

  it('rejects oversize Unicode snapshots without claiming the tool was not applied', async () => {
    vi.useFakeTimers();
    const { bridge, sockets } = setup();
    await bridge.initializePublicSession(Date.now() + 100_000);
    const socket = readySocket();
    sockets.push(socket);
    const call = bridge.callTool('createNote', {});
    await vi.advanceTimersByTimeAsync(0);
    const { id } = JSON.parse(socket.send.mock.calls[0][0]);
    await bridge.webSocketMessage(socket as any, JSON.stringify({ id, ok: true, result: {},
      snapshot: { ...emptySnapshot(), notes: [{ content: '😀'.repeat(300_000) }] } }));
    expect(await call).toMatchObject({ ok: false, error: expect.stringContaining('Do not retry this write') });
    expect(await (bridge as any).readPublicSnapshot()).toBeNull();
  });

  it('rejects private fields and keeps other sessions isolated', async () => {
    const first = setup();
    const second = setup();
    await first.bridge.initializePublicSession(Date.now() + 100_000);
    await second.bridge.initializePublicSession(Date.now() + 100_000);
    const socket = readySocket();
    first.sockets.push(socket);
    await first.bridge.webSocketMessage(socket as any, JSON.stringify({ type: 'session_snapshot',
      snapshot: { ...emptySnapshot(), connections: [{ secret: 'private' }] } }));
    expect(await (first.bridge as any).readPublicSnapshot()).toBeNull();
    await first.bridge.webSocketMessage(socket as any, JSON.stringify({ type: 'session_snapshot',
      snapshot: { ...emptySnapshot(), sheets: [{ connectorConfig: { token: 'private' } }] } }));
    expect(await (first.bridge as any).readPublicSnapshot()).toBeNull();
    await first.bridge.webSocketMessage(socket as any, JSON.stringify({ type: 'session_snapshot', snapshot: emptySnapshot() }));
    expect(await (first.bridge as any).readPublicSnapshot()).toEqual(emptySnapshot());
    expect(await (second.bridge as any).readPublicSnapshot()).toBeNull();
  });

  it('ignores another socket reply and replaced renderer snapshot', async () => {
    vi.useFakeTimers();
    const { bridge, sockets } = setup();
    await bridge.initializePublicSession(Date.now() + 100_000);
    const socket = readySocket();
    const other = readySocket();
    sockets.push(socket, other);
    const call = bridge.callTool('listSheets', {});
    await vi.advanceTimersByTimeAsync(0);
    const { id } = JSON.parse(socket.send.mock.calls[0][0]);
    await bridge.webSocketMessage(other as any, JSON.stringify({ id, ok: true, result: 'wrong', snapshot: emptySnapshot() }));
    await bridge.webSocketMessage(socket as any, JSON.stringify({ id, ok: true, result: 'right', snapshot: emptySnapshot() }));
    expect(await call).toMatchObject({ result: 'right' });
    other.serializeAttachment({ replaced: true });
    await bridge.webSocketMessage(other as any, JSON.stringify({ type: 'session_snapshot', snapshot: { ...emptySnapshot(), notes: [{ content: 'stale' }] } }));
    expect(await (bridge as any).readPublicSnapshot()).toEqual(emptySnapshot());
  });

  it('preserves immediate private dispatch without persistence or handshake', async () => {
    vi.useFakeTimers();
    const { bridge, sockets, values } = setup();
    const socket = readySocket();
    sockets.push(socket);
    const call = bridge.callTool('listSheets', {});
    await vi.advanceTimersByTimeAsync(0);
    const { id } = JSON.parse(socket.send.mock.calls[0][0]);
    await bridge.webSocketMessage(socket as any, JSON.stringify({ id, ok: true, result: [] }));
    expect(await call).toMatchObject({ ok: true });
    expect(values.size).toBe(0);
  });
});

function readySocket() {
  let attachment: any = { publicReady: true };
  return { send: vi.fn(), close: vi.fn(), deserializeAttachment: () => attachment,
    serializeAttachment: (value: unknown) => { attachment = value; } };
}

function emptySnapshot() {
  return { version: 1, sheets: [], charts: [], notes: [], transform: { scale: 1, offset: { x: 0, y: 0 } } };
}
