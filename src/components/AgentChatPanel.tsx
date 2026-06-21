import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { UIMessage } from 'ai';
import { Sparkles, X, Plus, ArrowUp, StopCircle, ChevronDown, ChevronRight, FileSpreadsheet, AlertCircle, Plug } from 'lucide-react';
import type { SelectionContext } from '../../types';
import { useAgentSession } from '../agent/useAgentSession';
import { useConversationManager } from '../agent/useConversationManager';
import { useStore } from '../../store';
import { getToolErrorMessages } from './agentChatErrors';

function selectionKey(sel: SelectionContext): string {
  if (!sel.sheetId) return '';
  const r = sel.range
    ? `${sel.range.start.col},${sel.range.start.row}-${sel.range.end.col},${sel.range.end.row}`
    : '';
  return `${sel.sheetId}|${sel.cellId ?? ''}|${r}`;
}

function colLetter(col: number): string {
  let s = '';
  let n = col;
  while (n >= 0) {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  }
  return s;
}

function selectionLabel(sel: SelectionContext, sheetTitle: string | undefined): {
  primary: string;
  secondary: string | null;
} | null {
  if (!sel.sheetId || !sheetTitle) return null;
  if (sel.range) {
    const a = `${colLetter(sel.range.start.col)}${sel.range.start.row + 1}`;
    const b = `${colLetter(sel.range.end.col)}${sel.range.end.row + 1}`;
    return { primary: sheetTitle, secondary: a === b ? a : `${a}:${b}` };
  }
  if (sel.cellId) return { primary: sheetTitle, secondary: sel.cellId };
  return { primary: sheetTitle, secondary: null };
}

interface Props {
  open: boolean;
  onClose: () => void;
  getSelection: () => SelectionContext;
  darkMode?: boolean;
  /** Opens the MCP "Connect an agent" dialog. */
  onOpenConnectAgent?: () => void;
  /** MCP bridge status — tints the plug icon (teal connected, amber replaced). */
  mcpStatus?: 'disconnected' | 'connecting' | 'connected' | 'replaced';
}

const teal = (darkMode?: boolean) => (darkMode ? '#14b8a6' : '#0d9488');

const ToolCallCard: React.FC<{ part: any; darkMode?: boolean }> = ({ part, darkMode }) => {
  const [open, setOpen] = useState(false);
  const name: string = part.toolName ?? part.type?.replace(/^tool-/, '') ?? 'tool';
  const state: string = part.state ?? '';
  const input = part.input;
  const output = part.output;
  const failed = output && typeof output === 'object' && output.ok === false;
  const running = state === 'input-streaming' || state === 'input-available' || state === 'partial';

  return (
    <div
      style={{
        border: `1px solid ${darkMode ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)'}`,
        borderRadius: 8,
        padding: '6px 8px',
        margin: '4px 0',
        background: failed
          ? 'rgba(220,38,38,0.08)'
          : darkMode
            ? 'rgba(20,184,166,0.06)'
            : 'rgba(13,148,136,0.04)',
        fontSize: 12,
      }}
    >
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          all: 'unset',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          width: '100%',
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          color: darkMode ? '#e2e8f0' : '#0f172a',
        }}
      >
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <span style={{ fontWeight: 600 }}>{name}</span>
        <span
          style={{
            color: failed ? '#f87171' : running ? teal(darkMode) : '#4ade80',
            marginLeft: 'auto',
          }}
        >
          {failed ? 'failed' : running ? '…' : 'ok'}
        </span>
      </button>
      {open && (
        <div
          style={{
            marginTop: 6,
            fontFamily: 'ui-monospace, monospace',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            color: darkMode ? '#94a3b8' : '#475569',
          }}
        >
          {input !== undefined && (
            <div style={{ marginBottom: 4 }}>
              <div style={{ fontWeight: 600, fontSize: 11, opacity: 0.6 }}>input</div>
              {JSON.stringify(input, null, 2)}
            </div>
          )}
          {output !== undefined && (
            <div style={{ color: failed ? '#fca5a5' : darkMode ? '#cbd5e1' : '#0f172a' }}>
              <div style={{ fontWeight: 600, fontSize: 11, opacity: 0.6 }}>output</div>
              {JSON.stringify(output, null, 2)}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

const MessageView: React.FC<{ msg: UIMessage; darkMode?: boolean }> = ({ msg, darkMode }) => {
  const isUser = msg.role === 'user';
  const toolErrorMessages = isUser ? [] : getToolErrorMessages(msg);
  return (
    <div
      style={{
        margin: '8px 0',
        display: 'flex',
        flexDirection: 'column',
        alignItems: isUser ? 'flex-end' : 'flex-start',
      }}
    >
      <div
        style={{
          fontSize: 10,
          color: darkMode ? '#64748b' : '#94a3b8',
          marginBottom: 3,
          fontWeight: 500,
          letterSpacing: '0.03em',
        }}
      >
        {isUser ? 'You' : 'Copilot'}
      </div>
      <div
        style={{
          maxWidth: '88%',
          padding: '7px 11px',
          borderRadius: isUser ? '12px 12px 2px 12px' : '12px 12px 12px 2px',
          background: isUser
            ? darkMode
              ? 'rgba(20,184,166,0.15)'
              : 'rgba(13,148,136,0.09)'
            : darkMode
              ? 'rgba(255,255,255,0.07)'
              : 'rgba(0,0,0,0.04)',
          border: isUser
            ? `1px solid ${darkMode ? 'rgba(20,184,166,0.25)' : 'rgba(13,148,136,0.18)'}`
            : `1px solid ${darkMode ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)'}`,
          color: darkMode ? '#e2e8f0' : '#0f172a',
        }}
      >
        {toolErrorMessages.length > 0 && (
          <div
            role="alert"
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 7,
              marginBottom: 8,
              padding: '8px 9px',
              borderRadius: 8,
              background: 'rgba(220,38,38,0.08)',
              border: '1px solid rgba(220,38,38,0.25)',
              color: darkMode ? '#fca5a5' : '#991b1b',
              fontSize: 12,
              lineHeight: 1.45,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}
          >
            <AlertCircle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
            <div>
              <div style={{ fontWeight: 700, marginBottom: 2 }}>Action failed</div>
              {toolErrorMessages.join('\n')}
            </div>
          </div>
        )}
        {(msg.parts ?? []).map((part: any, i: number) => {
          if (part.type === 'text') {
            return (
              <div key={i} style={{ whiteSpace: 'pre-wrap', lineHeight: 1.55, fontSize: 13 }}>
                {part.text}
              </div>
            );
          }
          if (typeof part.type === 'string' && part.type.startsWith('tool-')) {
            return <ToolCallCard key={i} part={part} darkMode={darkMode} />;
          }
          return null;
        })}
      </div>
    </div>
  );
};

// Production gate: the hosted API is not public yet, so end-users see the
// durable-agent path instead of the live Copilot composer.
// Local dev (localhost / 127.0.0.1 / *.local) keeps the full Copilot UI so
// developers can keep iterating. A future explicit override (set
// `VITE_AI_BETA_PUBLIC=1` at build time) flips this off everywhere.
function isPrivateBetaGated(): boolean {
  try {
    if ((import.meta as any).env?.VITE_AI_BETA_PUBLIC === '1') return false;
    const host = (typeof location !== 'undefined' ? location.hostname : '') || '';
    if (!host) return false;
    if (host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0') return false;
    if (host.endsWith('.local')) return false;
    return true;
  } catch {
    return false;
  }
}

export const AgentChatPanel: React.FC<Props> = ({ open, onClose, getSelection, darkMode, onOpenConnectAgent, mcpStatus }) => {
  const [input, setInput] = useState('');
  const [dismissedKey, setDismissedKey] = useState<string | null>(null);
  const [isFocused, setIsFocused] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const betaGated = useMemo(isPrivateBetaGated, []);

  const selection = getSelection();
  const currentKey = selectionKey(selection);
  const sheetTitle = useStore((s) => (selection.sheetId ? s.sheets[selection.sheetId]?.title : undefined));
  const label = selectionLabel(selection, sheetTitle);
  const chipVisible = !!label && currentKey !== '' && currentKey !== dismissedKey;
  const attachSelection = chipVisible;

  const attachRef = useRef(attachSelection);
  attachRef.current = attachSelection;

  const { messages, sendMessage, status, stop, error, regenerate, setMessages } = useAgentSession({
    getSelection,
    getAttachSelection: () => attachRef.current,
  });

  const { convName, startNew } = useConversationManager(messages, setMessages as (msgs: UIMessage[]) => void, status);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

  // Auto-grow textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 180) + 'px';
  }, [input]);

  if (!open) return null;

  if (betaGated) {
    const panelBg = darkMode ? '#171717' : '#f5f5f5';
    const subtleBorder = darkMode ? 'rgba(64,64,64,0.5)' : 'rgba(229,229,229,0.8)';
    const textMuted = darkMode ? '#a3a3a3' : '#737373';
    const textPrimary = darkMode ? '#f5f5f5' : '#171717';
    const tealColor = teal(darkMode);
    return (
      <div
        style={{
          position: 'fixed',
          top: 0,
          right: 0,
          bottom: 0,
          width: 'min(400px, 100vw)',
          background: panelBg,
          backdropFilter: 'blur(24px)',
          WebkitBackdropFilter: 'blur(24px)',
          borderLeft: `1px solid ${subtleBorder}`,
          boxShadow: '-4px 0 24px rgba(0,0,0,0.08)',
          display: 'flex',
          flexDirection: 'column',
          zIndex: 1000,
          fontFamily: 'ui-sans-serif, system-ui, sans-serif',
          color: textPrimary,
        }}
      >
        <header
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '14px 16px 10px',
          }}
        >
          <Sparkles size={15} color={tealColor} />
          <span style={{ fontWeight: 600, fontSize: 13, letterSpacing: '-0.01em' }}>Copilot</span>
          <span
            style={{
              fontSize: 10,
              fontWeight: 600,
              letterSpacing: '0.04em',
              textTransform: 'uppercase',
              padding: '2px 6px',
              borderRadius: 999,
              border: `1px solid ${tealColor}`,
              color: tealColor,
            }}
          >
            Coming soon
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 2, marginLeft: 'auto' }}>
            <button
              onClick={startNew}
              style={{
                all: 'unset',
                cursor: 'pointer',
                padding: 6,
                color: textMuted,
                display: 'flex',
                alignItems: 'center',
                borderRadius: 6,
              }}
              aria-label="New conversation"
              title="New conversation"
            >
              <Plus size={16} />
            </button>
            <button
              onClick={onClose}
              style={{
                all: 'unset',
                cursor: 'pointer',
                padding: 6,
                color: textMuted,
                display: 'flex',
                alignItems: 'center',
                borderRadius: 6,
              }}
              aria-label="Close panel"
            >
              <X size={16} />
            </button>
          </div>
        </header>
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '8px 20px 20px',
            display: 'flex',
            flexDirection: 'column',
            gap: 14,
          }}
        >
          <div style={{ fontSize: 15, fontWeight: 600, color: textPrimary, lineHeight: 1.4 }}>
            Copilot is coming soon.
          </div>
          <div style={{ fontSize: 13, color: textMuted, lineHeight: 1.6 }}>
            The hosted chat API is not available in production yet. You can use the same
            canvas tools today from Claude or Codex by connecting this SheetCanvas tab as
            an agent workspace.
          </div>
          <div style={{ fontSize: 13, color: textPrimary, lineHeight: 1.6 }}>
            Turn massive data into durable, shareable artifacts: tables, charts, pivots,
            notes, and dashboards that stay on the canvas after the chat disappears.
          </div>
          <button
            type="button"
            onClick={onOpenConnectAgent}
            disabled={!onOpenConnectAgent}
            style={{
              all: 'unset',
              display: 'inline-flex',
              alignSelf: 'flex-start',
              alignItems: 'center',
              gap: 8,
              padding: '8px 14px',
              borderRadius: 10,
              background: tealColor,
              color: '#ffffff',
              fontSize: 13,
              fontWeight: 600,
              cursor: onOpenConnectAgent ? 'pointer' : 'not-allowed',
              opacity: onOpenConnectAgent ? 1 : 0.6,
            }}
          >
            <Plug size={15} />
            Connect Claude or Codex now
          </button>
          <div style={{ fontSize: 11, color: textMuted, marginTop: 'auto', lineHeight: 1.5 }}>
            Copilot will become one built-in client. Claude and Codex remain the power path
            for agent-native SheetCanvas work.
          </div>
        </div>
      </div>
    );
  }

  const running = status === 'streaming' || status === 'submitted';

  const submit = () => {
    const text = input.trim();
    if (!text || running) return;
    setInput('');
    sendMessage({ text });
  };

  // Match app's Tailwind neutral palette exactly
  // dark: neutral-900=#171717 bg, neutral-800=#262626 card, neutral-700=#404040 border
  // light: neutral-100=#f5f5f5 bg, white card, neutral-200=#e5e5e5 border
  const panelBg = darkMode ? '#171717' : '#f5f5f5';
  const cardBg = darkMode ? '#262626' : '#ffffff';
  const cardBorder = isFocused
    ? (darkMode ? 'rgba(20,184,166,0.5)' : 'rgba(13,148,136,0.4)')
    : (darkMode ? 'rgba(64,64,64,0.8)' : 'rgba(229,229,229,0.9)');
  const subtleBorder = darkMode ? 'rgba(64,64,64,0.5)' : 'rgba(229,229,229,0.8)';
  const textMuted = darkMode ? '#a3a3a3' : '#737373';
  const textPrimary = darkMode ? '#f5f5f5' : '#171717';
  const chipBg = darkMode ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)';
  const chipBorder = darkMode ? 'rgba(64,64,64,0.9)' : 'rgba(0,0,0,0.08)';
  const tealColor = teal(darkMode);
  const sendActive = input.trim().length > 0;

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        right: 0,
        bottom: 0,
        width: 400,
        background: panelBg,
        backdropFilter: 'blur(24px)',
        WebkitBackdropFilter: 'blur(24px)',
        borderLeft: `1px solid ${subtleBorder}`,
        boxShadow: '-4px 0 24px rgba(0,0,0,0.08)',
        display: 'flex',
        flexDirection: 'column',
        zIndex: 1000,
        fontFamily: 'ui-sans-serif, system-ui, sans-serif',
        color: textPrimary,
      }}
    >
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '14px 16px 10px',
        }}
      >
        <Sparkles size={15} color={tealColor} />
        <span
          style={{
            fontWeight: 600,
            fontSize: 13,
            letterSpacing: '-0.01em',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            maxWidth: 200,
          }}
          title={convName !== 'New chat' ? convName : undefined}
        >
          {convName !== 'New chat' ? convName : 'Copilot'}
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 2, marginLeft: 'auto' }}>
          {onOpenConnectAgent && (
            <button
              onClick={onOpenConnectAgent}
              style={{
                all: 'unset',
                cursor: 'pointer',
                padding: 6,
                color:
                  mcpStatus === 'connected' ? tealColor : mcpStatus === 'replaced' ? '#f59e0b' : textMuted,
                display: 'flex',
                alignItems: 'center',
                borderRadius: 6,
              }}
              aria-label="Connect an agent"
              title={
                mcpStatus === 'replaced'
                  ? 'Agent connection taken over by another tab — click to reclaim'
                  : 'Connect an agent (MCP)'
              }
            >
              <Plug size={16} />
            </button>
          )}
          <button
            onClick={startNew}
            disabled={running}
            style={{
              all: 'unset',
              cursor: running ? 'not-allowed' : 'pointer',
              padding: 6,
              color: running ? (darkMode ? '#475569' : '#cbd5e1') : textMuted,
              display: 'flex',
              alignItems: 'center',
              borderRadius: 6,
            }}
            aria-label="New conversation"
            title="New conversation"
          >
            <Plus size={16} />
          </button>
          <button
            onClick={onClose}
            style={{
              all: 'unset',
              cursor: 'pointer',
              padding: 6,
              color: textMuted,
              display: 'flex',
              alignItems: 'center',
              borderRadius: 6,
            }}
            aria-label="Close panel"
          >
            <X size={16} />
          </button>
        </div>
      </header>

      <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: '4px 16px 8px' }}>
        {messages.length === 0 && (
          <div
            style={{
              color: textMuted,
              fontSize: 13,
              marginTop: 24,
              lineHeight: 1.6,
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
            }}
          >
            <div style={{ fontWeight: 600, color: textPrimary, fontSize: 14 }}>
              How can I help with your sheet?
            </div>
            <div style={{ fontSize: 12 }}>Try one of these:</div>
            {[
              'chart sales by month as a bar',
              'filter to rows where revenue > 1000',
              'format column B as currency',
            ].map((s) => (
              <button
                key={s}
                onClick={() => setInput(s)}
                style={{
                  all: 'unset',
                  cursor: 'pointer',
                  padding: '8px 10px',
                  borderRadius: 8,
                  border: `1px solid ${chipBorder}`,
                  background: chipBg,
                  fontSize: 12,
                  color: textPrimary,
                }}
              >
                {s}
              </button>
            ))}
          </div>
        )}
        {messages.map((m) => (
          <MessageView key={m.id} msg={m} darkMode={darkMode} />
        ))}
        {running && (
          <div style={{ fontSize: 12, color: textMuted, padding: '4px 0' }}>Thinking…</div>
        )}
        {error && (
          <div
            role="alert"
            style={{
              marginTop: 8,
              padding: '8px 10px',
              borderRadius: 8,
              background: 'rgba(220,38,38,0.08)',
              border: '1px solid rgba(220,38,38,0.25)',
              color: darkMode ? '#fca5a5' : '#991b1b',
              fontSize: 12,
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
            }}
          >
            <div style={{ fontWeight: 600 }}>
              {/quota_exceeded|429/i.test(error.message) ? 'Daily limit reached' : 'Copilot error'}
            </div>
            <div style={{ whiteSpace: 'pre-wrap' }}>{error.message}</div>
            <button
              onClick={() => regenerate()}
              style={{
                all: 'unset',
                cursor: 'pointer',
                alignSelf: 'flex-start',
                fontWeight: 600,
                color: tealColor,
                fontSize: 12,
              }}
            >
              Retry
            </button>
          </div>
        )}
      </div>

      {/* Composer card */}
      <div style={{ padding: '8px 12px 14px' }}>
        <div
          style={{
            background: cardBg,
            border: `1px solid ${cardBorder}`,
            borderRadius: 14,
            boxShadow: isFocused
              ? `0 0 0 3px ${darkMode ? 'rgba(20,184,166,0.12)' : 'rgba(13,148,136,0.08)'}`
              : '0 1px 2px rgba(0,0,0,0.04)',
            transition: 'border-color 120ms, box-shadow 120ms',
            display: 'flex',
            flexDirection: 'column',
            padding: 10,
            gap: 8,
          }}
        >
          {chipVisible && label && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <button
                onClick={() => setDismissedKey(currentKey)}
                title="Remove from context"
                style={{
                  all: 'unset',
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '4px 8px 4px 8px',
                  borderRadius: 999,
                  border: `1px solid ${chipBorder}`,
                  background: chipBg,
                  fontSize: 11,
                  color: textPrimary,
                  maxWidth: '100%',
                }}
              >
                <FileSpreadsheet size={12} color={tealColor} />
                <span
                  style={{
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    maxWidth: 200,
                    fontWeight: 500,
                  }}
                >
                  {label.primary}
                  {label.secondary ? (
                    <span style={{ color: textMuted, fontWeight: 400 }}> · {label.secondary}</span>
                  ) : null}
                </span>
                <X size={11} color={textMuted} style={{ marginLeft: 2 }} />
              </button>
            </div>
          )}

          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setIsFocused(false)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            placeholder="Ask anything about your sheet…"
            rows={1}
            style={{
              width: '100%',
              boxSizing: 'border-box',
              resize: 'none',
              padding: '4px 4px',
              background: 'transparent',
              color: textPrimary,
              border: 'none',
              font: 'inherit',
              fontSize: 14,
              lineHeight: 1.5,
              outline: 'none',
              minHeight: 28,
              maxHeight: 180,
              overflowY: 'auto',
            }}
          />

          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ flex: 1 }} />
            {running ? (
              <button
                onClick={() => stop()}
                style={{
                  all: 'unset',
                  cursor: 'pointer',
                  width: 30,
                  height: 30,
                  borderRadius: 999,
                  background: darkMode ? 'rgba(248,113,113,0.15)' : 'rgba(220,38,38,0.08)',
                  color: '#ef4444',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
                aria-label="Stop"
                title="Stop"
              >
                <StopCircle size={16} />
              </button>
            ) : (
              <button
                onClick={submit}
                disabled={!sendActive}
                style={{
                  all: 'unset',
                  cursor: sendActive ? 'pointer' : 'not-allowed',
                  width: 30,
                  height: 30,
                  borderRadius: 999,
                  background: sendActive
                    ? tealColor
                    : darkMode ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)',
                  color: sendActive ? '#ffffff' : (darkMode ? '#475569' : '#cbd5e1'),
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transition: 'background-color 120ms',
                }}
                aria-label="Send"
                title="Send"
              >
                <ArrowUp size={16} strokeWidth={2.5} />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default AgentChatPanel;
