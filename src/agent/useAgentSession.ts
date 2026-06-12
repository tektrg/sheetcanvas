import { useEffect, useMemo, useRef } from 'react';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport, lastAssistantMessageIsCompleteWithToolCalls, type UIMessage } from 'ai';
import type { SelectionContext } from '../../types';
import { executeClientTool } from './clientToolExecutor';
import { flushAgentFocus } from './agentFocusAccumulator';
import { buildAgentContextLine } from './contextBuilder';

// Stored in localStorage so all conversations share a single quota bucket.
const ROOT_SESSION_KEY = 'sheetcanvas:agent:rootSessionId';

function getOrCreateSessionId(): string {
  try {
    const cached = localStorage.getItem(ROOT_SESSION_KEY);
    if (cached) return cached;
    const fresh = (crypto.randomUUID?.() ?? Math.random().toString(36).slice(2) + Date.now().toString(36));
    localStorage.setItem(ROOT_SESSION_KEY, fresh);
    return fresh;
  } catch {
    return 'anon-' + Math.random().toString(36).slice(2, 10);
  }
}

function getBackendBase(): string {
  const fromEnv = (import.meta as any).env?.VITE_BACKEND_URL as string | undefined;
  return (fromEnv && fromEnv.trim()) || 'http://localhost:8787';
}

function getBearer(): string | null {
  const t = (import.meta as any).env?.VITE_API_BEARER_TOKEN as string | undefined;
  return t && t.trim() ? t.trim() : null;
}

export interface UseAgentSessionOptions {
  getSelection: () => SelectionContext;
  getAttachSelection?: () => boolean;
}

export function useAgentSession({ getSelection, getAttachSelection }: UseAgentSessionOptions) {
  const sessionId = useMemo(getOrCreateSessionId, []);
  const selectionRef = useRef(getSelection);
  selectionRef.current = getSelection;
  const attachRef = useRef<() => boolean>(getAttachSelection ?? (() => true));
  attachRef.current = getAttachSelection ?? (() => true);

  const transport = useMemo(() => {
    const headers: Record<string, string> = {
      'x-session-id': sessionId,
      'Content-Type': 'application/json',
    };
    const bearer = getBearer();
    if (bearer) headers.Authorization = `Bearer ${bearer}`;

    return new DefaultChatTransport<UIMessage>({
      api: `${getBackendBase()}/api/agent`,
      headers,
      // Send fresh sheet+selection context every turn in a dedicated body field.
      // The backend concatenates it onto its own system prompt — we cannot use a
      // role:'system' UIMessage because convertToModelMessages strips non
      // user/assistant/tool roles.
      prepareSendMessagesRequest: ({ messages, body }) => ({
        body: {
          ...(body ?? {}),
          messages,
          context: buildAgentContextLine(selectionRef.current(), {
            attachSelection: attachRef.current(),
          }),
        },
      }),
    });
  }, [sessionId]);

  const chatRef = useRef<ReturnType<typeof useChat<UIMessage>> | null>(null);

  const chat = useChat<UIMessage>({
    transport,
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
    onFinish: () => {
      flushAgentFocus();
    },
    onToolCall: async ({ toolCall }) => {
      const c = chatRef.current;
      if (!c) return;
      const result = await executeClientTool(
        toolCall.toolName,
        (toolCall as any).input,
        { getSelection: () => selectionRef.current() },
      );
      c.addToolResult({
        tool: toolCall.toolName as any,
        toolCallId: toolCall.toolCallId,
        output: result,
      } as any);
    },
  });

  useEffect(() => {
    chatRef.current = chat;
  }, [chat]);

  return { ...chat, sessionId };
}
