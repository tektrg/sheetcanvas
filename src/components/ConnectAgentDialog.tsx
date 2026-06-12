import React, { useState } from 'react';
import { X, Copy, Check, RefreshCw, Plug } from 'lucide-react';
import type { McpBridgeApi } from '../agent/useMcpBridge';

interface ConnectAgentDialogProps {
  bridge: McpBridgeApi;
  onClose: () => void;
}

const STATUS_LABEL: Record<string, { text: string; dotClass: string }> = {
  connected: { text: 'Connected — agents can reach this canvas', dotClass: 'bg-emerald-500' },
  connecting: { text: 'Connecting…', dotClass: 'bg-amber-500' },
  disconnected: { text: 'Not connected', dotClass: 'bg-neutral-400' },
  replaced: { text: 'Another tab took over — toggle off and on here to reclaim', dotClass: 'bg-amber-500' },
};

function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard unavailable — user can select the text manually.
    }
  };
  return (
    <div>
      <div className="text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-1">{label}</div>
      <div className="flex items-center gap-2">
        <code className="flex-1 text-xs px-2.5 py-2 rounded-lg bg-neutral-100 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300 overflow-x-auto whitespace-nowrap">
          {value}
        </code>
        <button
          onClick={copy}
          className="p-2 rounded-lg text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800 cursor-pointer"
          aria-label={`Copy ${label}`}
        >
          {copied ? <Check size={14} className="text-emerald-500" /> : <Copy size={14} />}
        </button>
      </div>
    </div>
  );
}

export const ConnectAgentDialog: React.FC<ConnectAgentDialogProps> = ({ bridge, onClose }) => {
  const [minting, setMinting] = useState(false);
  const [mintError, setMintError] = useState<string | null>(null);

  const generateToken = async (force = false) => {
    setMinting(true);
    setMintError(null);
    try {
      await bridge.createToken(force);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setMintError(
        /failed to fetch|networkerror|load failed/i.test(message)
          ? "Couldn't reach the SheetCanvas backend — make sure it's running, then try again."
          : message,
      );
    } finally {
      setMinting(false);
    }
  };

  const status = STATUS_LABEL[bridge.connectionStatus];

  return (
    <div className="fixed inset-0 z-[1100] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/20 dark:bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="bg-white dark:bg-neutral-850 rounded-xl shadow-2xl w-full max-w-md border border-neutral-200 dark:border-neutral-700 relative z-10 flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-neutral-200 dark:border-neutral-700">
          <div className="flex items-center gap-2">
            <Plug size={16} className="text-teal-500" />
            <h3 className="font-semibold text-lg text-neutral-800 dark:text-neutral-100">Connect an agent</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800 cursor-pointer"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        <div className="px-6 py-5 flex flex-col gap-4 text-sm text-neutral-600 dark:text-neutral-300">
          <p>
            Expose this canvas to external AI agents (Claude Code, etc.) over MCP. Tools run in this tab — keep
            it open while agents are working.
          </p>

          {!bridge.token ? (
            <button
              onClick={generateToken}
              disabled={minting}
              className="self-start px-4 py-2 rounded-lg bg-teal-600 hover:bg-teal-700 text-white text-sm font-medium disabled:opacity-50 cursor-pointer"
            >
              {minting ? 'Generating…' : 'Generate MCP server URL'}
            </button>
          ) : (
            <>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className={`inline-block w-2 h-2 rounded-full ${status.dotClass}`} />
                  <span className="text-xs">{status.text}</span>
                </div>
                <label className="flex items-center gap-2 cursor-pointer text-xs">
                  <input
                    type="checkbox"
                    checked={bridge.enabled}
                    onChange={(e) => bridge.setEnabled(e.target.checked)}
                    className="accent-teal-600"
                  />
                  Expose to agents
                </label>
              </div>

              <CopyField label="MCP server URL" value={bridge.mcpUrl ?? ''} />
              <CopyField
                label="Add to Claude Code"
                value={`claude mcp add sheetcanvas --transport http ${bridge.mcpUrl ?? ''}`}
              />

              <button
                onClick={() => generateToken(true)}
                disabled={minting}
                className="self-start flex items-center gap-1.5 text-xs text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300 disabled:opacity-50 cursor-pointer"
              >
                <RefreshCw size={12} className={minting ? 'animate-spin' : ''} />
                Regenerate URL (revokes the current one)
              </button>

              <p className="text-xs text-neutral-400 dark:text-neutral-500">
                Anyone with this URL can read and modify this canvas while the toggle is on. Treat it like a
                password.
              </p>
            </>
          )}

          {mintError && <p className="text-xs text-red-500">{mintError}</p>}
        </div>
      </div>
    </div>
  );
};
