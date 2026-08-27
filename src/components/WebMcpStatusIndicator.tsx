import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { Globe, X } from 'lucide-react';
import type { WebMcpBridgeApi } from '../agent/webmcp/useWebMcpBridge';

interface WebMcpStatusIndicatorProps {
  bridge: WebMcpBridgeApi;
  /** Explicit dark-mode flag (App.tsx's `darkMode` state) — required because
   * the dialog portals to `document.body`, OUTSIDE the app's `.dark`
   * wrapper, so `dark:` classes need an explicit ancestor to key off. */
  darkMode: boolean;
}

// Four honest, mutually-exclusive states. `bridge.status` alone conflates
// "user turned it off" with "browser doesn't support it" (both surface as
// registry.size === 0), and doesn't have its own "off" value — this derives
// the state a person actually needs to see from `status` + `enabled` +
// `supported` together. See useWebMcpBridge.ts / webmcpRegistry.ts for the
// underlying fields.
type DisplayState = 'unsupported' | 'blocked' | 'off' | 'idle' | 'active';

const STATUS_COPY: Record<DisplayState, { dotClass: string; text: string }> = {
  unsupported: {
    dotClass: 'bg-neutral-400',
    text: "Not available in this browser — needs a browser agent with document.modelContext support (e.g. ChatGPT Desktop).",
  },
  blocked: {
    dotClass: 'bg-red-500',
    text: "Blocked by this site's browser permissions policy. Reload the page to retry.",
  },
  off: {
    dotClass: 'bg-neutral-400',
    text: "Off — ChatGPT's browser agent can't see or use this canvas.",
  },
  idle: {
    dotClass: 'bg-amber-500',
    text: 'Ready — registering tools…',
  },
  active: {
    dotClass: 'bg-emerald-500',
    text: "Active — ChatGPT's browser agent can use these tools on this canvas.",
  },
};

function resolveDisplayState(bridge: WebMcpBridgeApi): DisplayState {
  if (!bridge.supported) return 'unsupported';
  if (bridge.status === 'blocked') return 'blocked';
  if (!bridge.enabled) return 'off';
  if (bridge.status === 'active') return 'active';
  return 'idle';
}

/**
 * Compact status readout + kill switch for the WebMCP door (ChatGPT
 * Desktop's browser agent talking to `document.modelContext`), sitting next
 * to the existing "Connect Agent" (remote MCP) control in App.tsx's
 * bottom-right pill. Mirrors ConnectAgentDialog's dot+label status row and
 * centered-modal styling so it reads as the same family of control, not a
 * bolted-on extra.
 *
 * The live tool-count badge is the point: it's the clearest on-canvas proof
 * that tool registration is state-aware (more sheets/notes/connections ->
 * more eligible tools -> the badge grows), which is otherwise invisible.
 */
export const WebMcpStatusIndicator: React.FC<WebMcpStatusIndicatorProps> = ({ bridge, darkMode }) => {
  const [open, setOpen] = useState(false);
  const displayState = resolveDisplayState(bridge);
  const copy = STATUS_COPY[displayState];
  const count = bridge.registeredTools.length;

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title={`WebMCP for ChatGPT: ${copy.text}`}
        aria-label="WebMCP status"
        className="group relative p-2.5 rounded-full flex items-center justify-center text-neutral-500 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800 hover:text-neutral-900 dark:hover:text-neutral-100 transition-all cursor-pointer"
      >
        <Globe
          size={18}
          strokeWidth={1.5}
          className={displayState === 'active' ? 'text-teal-500' : displayState === 'blocked' ? 'text-red-500' : ''}
        />
        {displayState === 'active' && count > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[15px] h-[15px] px-[3px] rounded-full bg-teal-500 text-white text-[9px] font-semibold flex items-center justify-center leading-none">
            {count > 99 ? '99+' : count}
          </span>
        )}
      </button>

      {open &&
        createPortal(
          // Portaled past the pill's `backdrop-blur-xl` ancestor, which
          // otherwise establishes a containing block for `position: fixed`
          // descendants (per the backdrop-filter spec) and would pin this
          // dialog to the pill's own tiny box instead of the viewport — the
          // same escape hatch SettingsPopover.tsx uses, for the same reason.
          <div className={darkMode ? 'dark' : ''} style={{ display: 'contents' }}>
            <div className="fixed inset-0 z-[1100] flex items-center justify-center p-4">
              <div className="absolute inset-0 bg-black/20 dark:bg-black/50 backdrop-blur-sm" onClick={() => setOpen(false)} />
              <div className="bg-white dark:bg-neutral-850 rounded-xl shadow-2xl w-full max-w-md border border-neutral-200 dark:border-neutral-700 relative z-10 flex flex-col">
                <div className="flex items-center justify-between px-6 py-4 border-b border-neutral-200 dark:border-neutral-700">
                  <div className="flex items-center gap-2">
                    <Globe size={16} className="text-teal-500" />
                    <h3 className="font-semibold text-lg text-neutral-800 dark:text-neutral-100">WebMCP for ChatGPT</h3>
                  </div>
                  <button
                    onClick={() => setOpen(false)}
                    className="p-1.5 rounded-lg text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800 cursor-pointer"
                    aria-label="Close"
                  >
                    <X size={16} />
                  </button>
                </div>

                <div className="px-6 py-5 flex flex-col gap-4 text-sm text-neutral-600 dark:text-neutral-300">
                  <p>
                    When ChatGPT Desktop's browser agent is on this page, it can see and use the canvas tools
                    registered here directly — no separate connection step or token. This is a different door from
                    "Connect Claude or Codex" above, which is a remote MCP server.
                  </p>

                  <div className="flex items-center gap-2">
                    <span className={`inline-block w-2 h-2 rounded-full flex-shrink-0 ${copy.dotClass}`} />
                    <span className="text-xs">{copy.text}</span>
                  </div>

                  {bridge.supported && (
                    <label className="flex items-center gap-2 cursor-pointer text-xs">
                      <input
                        type="checkbox"
                        checked={bridge.enabled}
                        onChange={(e) => bridge.setEnabled(e.target.checked)}
                        className="accent-teal-600"
                      />
                      Expose tools to ChatGPT's browser agent
                    </label>
                  )}

                  {displayState === 'active' && (
                    <p className="text-xs text-neutral-400 dark:text-neutral-500">
                      {count} tool{count === 1 ? '' : 's'} currently registered. This grows automatically as you add
                      sheets, notes, or connections, and shrinks when they're removed — ChatGPT only ever sees tools
                      that can act on something that actually exists right now.
                    </p>
                  )}
                </div>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
};
