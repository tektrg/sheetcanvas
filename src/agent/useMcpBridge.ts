import { useCallback, useEffect, useRef, useState } from 'react';
import type { SelectionContext } from '../../types';
import { TOOL_NAMES, type ToolName } from '../../agent/tools';
import { requestJson } from '../../utils/backendApi';
import { flushAgentFocus } from './agentFocusAccumulator';
import { isPublicPluginLaunch, pluginHistoryState, readPluginMcpConfig, sanitizePluginLaunchUrl } from './mcpPluginBootstrap';
import { capturePublicCanvasSnapshot, restorePublicCanvasSnapshot, setPublicCanvasReady, type PublicCanvasSnapshot } from './publicCanvasSession';
import { useStore } from '../../store';
import { dispatchTool } from './webmcp/toolDispatch';

/**
 * Connects this tab to the backend CanvasBridge Durable Object over WebSocket
 * so external MCP agents can call the canvas tools. The backend validates
 * tool inputs against the shared zod schemas before forwarding, so this side
 * only guards against unknown tool names.
 */

const STORAGE_KEY = 'sheetcanvas:mcp:v1';
// Stable per-browser identity sent to the backend so the server can return the
// same token even after localStorage is cleared. Generated once, never rotated.
const CLIENT_ID_KEY = 'sheetcanvas:mcp:clientId';
const RECONNECT_BASE_DELAY_MS = 1_000;
const RECONNECT_MAX_DELAY_MS = 30_000;
// Mirrors WS_CLOSE_REPLACED in backend/src/mcp/bridge.ts (not importable here —
// that module depends on cloudflare:workers). Another tab took the connection;
// reconnecting would start an eviction war between the tabs.
const WS_CLOSE_REPLACED = 4000;
// Heartbeat: the Durable Object auto-answers 'ping' with 'pong'. A missed pong
// means the socket died silently (laptop sleep, network change) — close it so
// the reconnect logic takes over instead of leaving a zombie "connected" state.
const HEARTBEAT_INTERVAL_MS = 20_000;
const HEARTBEAT_PONG_TIMEOUT_MS = 10_000;
// External MCP agents have no turn boundary — debounce the viewport flush so
// the camera moves once after a burst of tool calls, not after each one.
const MCP_FOCUS_FLUSH_DEBOUNCE_MS = 500;

export type McpConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'replaced';

interface StoredMcpConfig {
  token: string;
  mcpUrl: string;
  bridgeWsUrl: string;
  enabled: boolean;
  ephemeral?: boolean;
}

interface MintTokenResponse {
  token: string;
  mcpUrl: string;
  bridgeWsUrl: string;
}

function getOrCreateClientId(): string {
  try {
    const existing = localStorage.getItem(CLIENT_ID_KEY);
    if (existing) return existing;
    const id = crypto.randomUUID();
    localStorage.setItem(CLIENT_ID_KEY, id);
    return id;
  } catch {
    // Private mode — fall back to a session-only UUID.
    return crypto.randomUUID();
  }
}

function readStoredConfig(): StoredMcpConfig | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsedConfig = JSON.parse(raw);
    if (typeof parsedConfig?.token !== 'string' || typeof parsedConfig?.bridgeWsUrl !== 'string') return null;
    return parsedConfig as StoredMcpConfig;
  } catch {
    return null;
  }
}

function writeStoredConfig(config: StoredMcpConfig | null) {
  try {
    if (config?.ephemeral) return;
    if (config) localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // localStorage unavailable (private mode) — bridge still works for this session.
  }
}

export interface UseMcpBridgeOptions {
  getSelection: () => SelectionContext;
}

export function useMcpBridge({ getSelection }: UseMcpBridgeOptions) {
  const [pluginLaunchConfig] = useState(() =>
    typeof window === 'undefined' ? null : readPluginMcpConfig(window.location.href, window.history.state),
  );
  const [config, setConfig] = useState<StoredMcpConfig | null>(
    () => pluginLaunchConfig ?? (typeof window !== 'undefined' && isPublicPluginLaunch(window.location.href) ? null : readStoredConfig()),
  );
  const [connectionStatus, setConnectionStatus] = useState<McpConnectionStatus>('disconnected');
  const [recoveryError, setRecoveryError] = useState<string | null>(null);
  const selectionRef = useRef(getSelection);
  selectionRef.current = getSelection;

  useEffect(() => {
    if (!pluginLaunchConfig || typeof window === 'undefined') return;
    writeStoredConfig(pluginLaunchConfig);
    window.history.replaceState(
      pluginHistoryState(window.location.href, window.history.state),
      '',
      sanitizePluginLaunchUrl(window.location.href, window.history.state),
    );
  }, [pluginLaunchConfig]);

  const updateConfig = useCallback((next: StoredMcpConfig | null) => {
    setConfig(next);
    writeStoredConfig(next);
  }, []);

  const createToken = useCallback(async (force = false) => {
    if (typeof window !== 'undefined' && isPublicPluginLaunch(window.location.href, window.history.state)) {
      throw new Error('Temporary plugin canvases cannot connect to a private workspace.');
    }
    const clientId = getOrCreateClientId();
    const minted = await requestJson<MintTokenResponse>('/api/mcp/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId, ...(force ? { force: true } : {}) }),
    });
    updateConfig({ ...minted, enabled: true });
  }, [updateConfig]);

  const setEnabled = useCallback(
    (enabled: boolean) => {
      setConfig((current) => {
        if (!current) return current;
        const next = { ...current, enabled };
        writeStoredConfig(next);
        return next;
      });
    },
    [],
  );

  const active = !!config?.enabled && !!config.token;

  useEffect(() => {
    if (!active || !config) {
      setConnectionStatus('disconnected');
      return undefined;
    }

    let disposed = false;
    let socket: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let reconnectAttempt = 0;
    // Set by connect() for the current socket; called on unmount/disable
    // because cleanup detaches onclose before closing.
    let stopCurrentHeartbeat: () => void = () => {};
    let focusFlushTimer: ReturnType<typeof setTimeout> | null = null;
    let snapshotTimer: ReturnType<typeof setTimeout> | null = null;
    let publicReady = false;
    const unsubscribeSnapshot = config.ephemeral ? useStore.subscribe((state, previous) => {
      if (!publicReady || (state.sheets === previous.sheets && state.charts === previous.charts && state.notes === previous.notes && state.transform === previous.transform)) return;
      if (snapshotTimer) clearTimeout(snapshotTimer);
      snapshotTimer = setTimeout(() => {
        if (socket?.readyState !== WebSocket.OPEN || !publicReady) return;
        try {
          socket.send(JSON.stringify({ type: 'session_snapshot', snapshot: capturePublicCanvasSnapshot() }));
          setRecoveryError(null);
        } catch (error) {
          setRecoveryError('Latest changes cannot be saved for recovery because this temporary canvas is too large. Export important sheets before closing or reloading, or remove data to resume saving.');
          console.error('Temporary canvas recovery snapshot failed:', error);
        }
      }, 150);
    }) : () => {};

    const scheduleFocusFlush = () => {
      if (focusFlushTimer) clearTimeout(focusFlushTimer);
      focusFlushTimer = setTimeout(flushAgentFocus, MCP_FOCUS_FLUSH_DEBOUNCE_MS);
    };

    const connect = () => {
      if (disposed) return;
      setConnectionStatus('connecting');
      publicReady = false;
      if (config.ephemeral) setPublicCanvasReady(false);
      // Capture locally so handlers never act on a newer socket after reconnect.
      const ws = new WebSocket(config.bridgeWsUrl);
      socket = ws;
      let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
      let pongDeadline: ReturnType<typeof setTimeout> | null = null;

      const stopHeartbeat = () => {
        if (heartbeatTimer) clearInterval(heartbeatTimer);
        if (pongDeadline) clearTimeout(pongDeadline);
        heartbeatTimer = null;
        pongDeadline = null;
      };
      stopCurrentHeartbeat = stopHeartbeat;

      ws.onopen = () => {
        reconnectAttempt = 0;
        if (!config.ephemeral) setConnectionStatus('connected');
        heartbeatTimer = setInterval(() => {
          if (ws.readyState !== WebSocket.OPEN) return;
          ws.send('ping');
          pongDeadline ??= setTimeout(() => ws.close(), HEARTBEAT_PONG_TIMEOUT_MS);
        }, HEARTBEAT_INTERVAL_MS);
      };

      ws.onmessage = async (event) => {
        const data = String(event.data);
        if (data === 'pong') {
          if (pongDeadline) clearTimeout(pongDeadline);
          pongDeadline = null;
          return;
        }
        let call: { type?: string; snapshot?: unknown; id?: string; name?: string; input?: unknown };
        try {
          call = JSON.parse(data);
        } catch {
          return;
        }
        if (config.ephemeral && call.type === 'session_error') {
          setRecoveryError('The latest canvas changes could not be saved for recovery. Keep this view open and export important sheets before closing or reloading.');
          return;
        }
        if (config.ephemeral && call.type === 'session_restore') {
          try {
            restorePublicCanvasSnapshot(call.snapshot);
            publicReady = true;
            setPublicCanvasReady(true);
            ws.send(JSON.stringify({ type: 'canvas_ready' }));
            setConnectionStatus('connected');
          } catch (error) {
            console.error('Temporary canvas recovery failed:', error);
            ws.close(4001, 'Canvas recovery failed');
          }
          return;
        }
        if (config.ephemeral && !publicReady) return;
        if (typeof call.id !== 'string' || typeof call.name !== 'string') return;

        let reply: { id: string; ok: boolean; result?: unknown; error?: string; snapshot?: PublicCanvasSnapshot };
        if (!TOOL_NAMES.includes(call.name as ToolName)) {
          reply = { id: call.id, ok: false, error: `Unknown tool: ${call.name}` };
        } else {
          try {
            const beforeTool = config.ephemeral ? capturePublicCanvasSnapshot() : null;
            const result = await dispatchTool(call.name, call.input, {
              getSelection: () => selectionRef.current(),
              door: 'remote-mcp',
            });
            let snapshot: PublicCanvasSnapshot | undefined;
            if (config.ephemeral && result.ok) {
              try {
                snapshot = capturePublicCanvasSnapshot();
              } catch (error) {
                // Do not report a failed recovery-limited write while leaving
                // its mutation visible; keep the last recoverable canvas.
                restorePublicCanvasSnapshot(beforeTool);
                throw error;
              }
            }
            // executeClientTool reports failures via { ok: false, error } —
            // propagate them so MCP clients see isError, not a fake success.
            reply = result.ok
              ? { id: call.id, ok: true, result, ...(snapshot ? { snapshot } : {}) }
              : { id: call.id, ok: false, error: String((result as { error?: unknown }).error ?? 'Tool failed') };
            // Arm the debounced viewport flush. The accumulator is a no-op for
            // read-only tools, so the camera only moves when writes accumulated.
            scheduleFocusFlush();
          } catch (err) {
            reply = { id: call.id, ok: false, error: err instanceof Error ? err.message : String(err) };
          }
        }
        ws.send(JSON.stringify(reply));
      };

      ws.onclose = (event) => {
        publicReady = false;
        if (config.ephemeral) setPublicCanvasReady(false);
        stopHeartbeat();
        if (disposed) return;
        if (event.code === WS_CLOSE_REPLACED) {
          setConnectionStatus('replaced');
          return;
        }
        setConnectionStatus('disconnected');
        const delayMs = Math.min(RECONNECT_BASE_DELAY_MS * 2 ** reconnectAttempt, RECONNECT_MAX_DELAY_MS);
        reconnectAttempt += 1;
        reconnectTimer = setTimeout(connect, delayMs);
      };

      ws.onerror = () => {
        ws.close();
      };
    };

    connect();

    return () => {
      disposed = true;
      publicReady = false;
      if (config.ephemeral) setPublicCanvasReady(false);
      unsubscribeSnapshot();
      if (snapshotTimer) clearTimeout(snapshotTimer);
      stopCurrentHeartbeat();
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (focusFlushTimer) clearTimeout(focusFlushTimer);
      if (socket) {
        socket.onclose = null;
        socket.onerror = null;
        socket.close(1000, 'Bridge disabled');
      }
      setConnectionStatus('disconnected');
    };
  }, [active, config?.bridgeWsUrl, config?.token]);

  return {
    enabled: active,
    setEnabled,
    connectionStatus,
    recoveryError,
    token: config?.token ?? null,
    mcpUrl: config?.mcpUrl ?? null,
    createToken,
  };
}

export type McpBridgeApi = ReturnType<typeof useMcpBridge>;
