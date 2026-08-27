import { useCallback, useEffect, useRef, useState } from 'react';
import type { SelectionContext } from '../../../types';
import type { ToolName } from '../../../agent/tools';
import { useStore, type AppState } from '../../../store';
import { getModelContext } from './modelContext';
import { gatingKey } from './webmcpToolGating';
import {
  getRegisteredToolNames,
  getSelectionProvider,
  getWebMcpStatus,
  reconcileWebMcpTools,
  setRegistryEnabled,
  setSelectionProvider,
  type WebMcpStatus,
} from './webmcpRegistry';

// Mirrors the `sheetcanvas:mcp:v1` pattern in useMcpBridge.ts:62-81. Default
// enabled = true: registration is inert wherever `document.modelContext` is
// absent, so a default-on toggle carries no risk for existing users and
// nobody has to find a setting before ChatGPT's browser can see the tools.
const STORAGE_KEY = 'sheetcanvas:webmcp:v1';
// The store has no `subscribeWithSelector` middleware (four other files
// depend on the plain store shape) — debounce a manual gatingKey comparison
// instead of adding one.
const GATING_CHANGE_DEBOUNCE_MS = 250;

interface StoredWebMcpConfig {
  enabled: boolean;
}

function readStoredEnabled(): boolean {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return true;
    const parsed = JSON.parse(raw) as Partial<StoredWebMcpConfig>;
    return typeof parsed.enabled === 'boolean' ? parsed.enabled : true;
  } catch {
    return true;
  }
}

function writeStoredEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ enabled } satisfies StoredWebMcpConfig));
  } catch {
    // Private mode — the bridge still works for this session, just doesn't persist.
  }
}

export interface UseWebMcpBridgeOptions {
  getSelection: () => SelectionContext;
}

export interface WebMcpBridgeApi {
  supported: boolean;
  status: WebMcpStatus;
  enabled: boolean;
  setEnabled(v: boolean): void;
  registeredTools: ToolName[];
}

export function useWebMcpBridge({ getSelection }: UseWebMcpBridgeOptions): WebMcpBridgeApi {
  const supported = getModelContext() !== null;
  const selectionRef = useRef(getSelection);
  selectionRef.current = getSelection;

  const [enabled, setEnabledState] = useState<boolean>(readStoredEnabled);
  const [status, setStatus] = useState<WebMcpStatus>(getWebMcpStatus);
  const [registeredTools, setRegisteredTools] = useState<ToolName[]>(getRegisteredToolNames);

  // Selection provider is set on every render (ref pattern from
  // useMcpBridge.ts:90) so the registry's module-level slot always reads the
  // caller's latest `getSelection`, then cleared on unmount with an
  // identity guard (idiom at AgentEvalBridge.tsx:248-252) so a newer mount's
  // provider is never clobbered by an older mount's cleanup.
  useEffect(() => {
    const provider = () => selectionRef.current();
    setSelectionProvider(provider);
    return () => {
      // Identity guard: only clear if we still own the slot. Under
      // StrictMode's mount→cleanup→mount, this cleanup runs before the
      // remount's setSelectionProvider(provider2) call, so it correctly
      // clears our own `provider`; if a future double-mount ordering ever
      // changes, this still never clobbers a newer mount's provider.
      if (getSelectionProvider() === provider) setSelectionProvider(null);
    };
  }, []);

  const runReconcile = useCallback((reason: string) => {
    void reconcileWebMcpTools(reason).then((report) => {
      setStatus(report.status);
      setRegisteredTools(getRegisteredToolNames());
    });
  }, []);

  // Fires on mount (covering "reconcile on mount") and again on every
  // enable/disable toggle — one effect satisfies both triggers from the brief.
  useEffect(() => {
    setRegistryEnabled(enabled);
    writeStoredEnabled(enabled);
    runReconcile(enabled ? 'enabled' : 'disabled');
  }, [enabled, runReconcile]);

  // Reconcile when durable gating facts change (sheet/note/connection/result
  // counts), debounced so a burst of store writes collapses into one pass.
  useEffect(() => {
    let lastKey = gatingKey(useStore.getState());
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;

    const unsubscribe = useStore.subscribe((state: AppState) => {
      const nextKey = gatingKey(state);
      if (nextKey === lastKey) return;
      lastKey = nextKey;
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => runReconcile('gating-change'), GATING_CHANGE_DEBOUNCE_MS);
    });

    return () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      unsubscribe();
    };
  }, [runReconcile]);

  // BFCache restore leaves the Document not "fully active", which makes
  // registerTool reject — re-reconcile once the tab is actually usable
  // again, on both the generic visibility signal and the BFCache-specific one.
  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') runReconcile('visibilitychange');
    };
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) runReconcile('pageshow-bfcache');
    };

    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('pageshow', onPageShow);
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('pageshow', onPageShow);
    };
  }, [runReconcile]);

  const setEnabled = useCallback((next: boolean) => {
    setEnabledState(next);
  }, []);

  return { supported, status, enabled, setEnabled, registeredTools };
}
