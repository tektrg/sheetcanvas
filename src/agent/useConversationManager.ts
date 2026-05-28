import { useEffect, useRef, useState } from 'react';
import type { UIMessage } from 'ai';
import {
  getAllConversations,
  putConversation,
  makeConversationId,
  nameFromFirstMessage,
  type Conversation,
} from './conversationDb';

interface ActiveConv {
  id: string;
  name: string;
  createdAt: number;
}

export function useConversationManager(
  messages: UIMessage[],
  setMessages: (msgs: UIMessage[]) => void,
  status: string,
) {
  const [convName, setConvName] = useState('New chat');
  const activeRef = useRef<ActiveConv | null>(null);
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const prevStatusRef = useRef(status);
  const namedRef = useRef(false);

  // Load latest conversation from IDB on mount
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const all = await getAllConversations();
        if (!alive) return;
        if (all.length > 0) {
          const latest = all[all.length - 1];
          activeRef.current = { id: latest.id, name: latest.name, createdAt: latest.createdAt };
          setConvName(latest.name);
          namedRef.current = latest.name !== 'New chat';
          if (latest.messages.length > 0) setMessages(latest.messages);
        } else {
          const conv: Conversation = {
            id: makeConversationId(),
            name: 'New chat',
            messages: [],
            createdAt: Date.now(),
            updatedAt: Date.now(),
          };
          await putConversation(conv);
          if (!alive) return;
          activeRef.current = { id: conv.id, name: conv.name, createdAt: conv.createdAt };
        }
      } catch {
        // IDB unavailable — operate without persistence
      }
    })();
    return () => { alive = false; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-name from first user message
  useEffect(() => {
    if (namedRef.current || !activeRef.current) return;
    const firstUser = messages.find((m) => m.role === 'user');
    if (!firstUser) return;
    const text = ((firstUser.parts ?? []).find((p: any) => p.type === 'text') as any)?.text ?? '';
    if (!text) return;
    namedRef.current = true;
    const name = nameFromFirstMessage(text);
    setConvName(name);
    activeRef.current = { ...activeRef.current, name };
  }, [messages]);

  // Save to IDB when a turn completes (status: non-ready → ready)
  useEffect(() => {
    const prev = prevStatusRef.current;
    prevStatusRef.current = status;
    if (prev !== 'ready' && status === 'ready' && activeRef.current && messagesRef.current.length > 0) {
      const { id, name, createdAt } = activeRef.current;
      putConversation({ id, name, messages: messagesRef.current, createdAt, updatedAt: Date.now() });
    }
  }, [status]);

  const startNew = async () => {
    // Persist current conversation before clearing
    if (activeRef.current && messagesRef.current.length > 0) {
      const { id, name, createdAt } = activeRef.current;
      await putConversation({ id, name, messages: messagesRef.current, createdAt, updatedAt: Date.now() });
    }
    const conv: Conversation = {
      id: makeConversationId(),
      name: 'New chat',
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await putConversation(conv);
    activeRef.current = { id: conv.id, name: conv.name, createdAt: conv.createdAt };
    setConvName('New chat');
    namedRef.current = false;
    setMessages([]);
  };

  return { convName, startNew };
}
