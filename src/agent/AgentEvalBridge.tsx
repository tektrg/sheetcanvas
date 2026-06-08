import { useCallback, useEffect, useRef } from 'react';
import type { UIMessage } from 'ai';
import type { SelectionContext, SheetData } from '../../types';
import { getCellId } from '../../utils/formulas';
import { useStore } from '../../store';
import { useAgentSession } from './useAgentSession';
import { getSheetDataBounds } from './sheetBounds';

type AgentEvalStatus = 'ready' | 'submitted' | 'streaming' | 'error';
const MAX_LOG_ROWS = 50;
const MAX_LOG_COLUMNS = 20;

interface AgentEvalBridgeProps {
  enabled: boolean;
  getSelection: () => SelectionContext;
}

interface RunPromptOptions {
  resetConversation?: boolean;
  timeoutMs?: number;
}

interface AgentEvalApi {
  getCanvasState: () => ReturnType<typeof summarizeCanvasState>;
  getMessages: () => UIMessage[];
  getStatus: () => AgentEvalStatus;
  loadFixture: (fixture: AgentEvalFixture) => void;
  runPrompt: (prompt: string, options?: RunPromptOptions) => Promise<{
    canvasState: ReturnType<typeof summarizeCanvasState>;
    error?: string;
    messages: UIMessage[];
    status: AgentEvalStatus;
  }>;
}

interface AgentEvalFixture {
  sheets?: SheetData[];
}

declare global {
  interface Window {
    __sheetCanvasAgentEval?: AgentEvalApi;
  }
}

function cellValueForLog(sheetId: string, colIndex: number, rowIndex: number) {
  const sheet = useStore.getState().sheets[sheetId];
  const cell = sheet?.cells[getCellId(colIndex, rowIndex)];
  return cell?.value ?? cell?.raw ?? null;
}

function sampledCellsForLog(sheetId: string, rowCount: number, columnCount: number) {
  const sheet = useStore.getState().sheets[sheetId];
  const rows = Math.min(rowCount, MAX_LOG_ROWS);
  const columns = Math.min(columnCount, MAX_LOG_COLUMNS);
  const cells = [];

  for (let rowIndex = 0; rowIndex < rows; rowIndex += 1) {
    for (let colIndex = 0; colIndex < columns; colIndex += 1) {
      const cellId = getCellId(colIndex, rowIndex);
      const cell = sheet?.cells[cellId];
      if (!cell) continue;
      cells.push({
        cellId,
        value: cell.value ?? null,
        raw: cell.raw ?? null,
        error: cell.error ?? null,
      });
    }
  }

  return cells;
}

function summarizeCanvasState() {
  const state = useStore.getState();
  return {
    sheets: state.sheetIds.map((sheetId) => {
      const sheet = state.sheets[sheetId];
      const bounds = getSheetDataBounds(sheet);
      return {
        id: sheet.id,
        title: sheet.title,
        rowCount: bounds.height,
        columnCount: bounds.width,
        headers: Array.from({ length: bounds.width }, (_, colIndex) => ({
          columnId: getCellId(colIndex, 0).replace(/\d+$/, ''),
          header: cellValueForLog(sheet.id, colIndex, 0),
        })),
        cells: sampledCellsForLog(sheet.id, bounds.height, bounds.width),
        filters: sheet.filters ?? [],
        sort: sheet.sort ?? null,
        connector: sheet.connectorConfig
          ? {
              type: sheet.connectorConfig.type,
              name: sheet.connectorConfig.name,
              derivation: sheet.connectorConfig.derivation ?? null,
              lastError: sheet.connectorConfig.lastError ?? null,
              truncated: !!sheet.connectorConfig.truncated,
            }
          : null,
      };
    }),
    charts: state.chartIds.map((chartId) => {
      const chart = state.charts[chartId];
      return {
        id: chart.id,
        title: chart.title,
        sourceSheetId: chart.sourceSheetId,
        type: chart.config.type,
        labelColumn: chart.config.labelColumn,
        dataColumns: chart.config.dataColumns,
      };
    }),
    notes: state.noteIds.map((noteId) => {
      const note = state.notes[noteId];
      return { id: note.id, color: note.color ?? null };
    }),
    selectedIds: Array.from(state.selectedIds),
  };
}

function waitForTurnCompletion(args: {
  getMessages: () => UIMessage[];
  getStatus: () => AgentEvalStatus;
  startedMessageCount: number;
  timeoutMs: number;
}) {
  const startedAt = Date.now();
  let sawRunning = false;

  return new Promise<void>((resolve, reject) => {
    const poll = () => {
      const status = args.getStatus();
      const newMessages = args.getMessages().slice(args.startedMessageCount);
      sawRunning = sawRunning || status === 'submitted' || status === 'streaming';
      const hasAssistantResponse = newMessages.some((message) => message.role === 'assistant');

      if (
        hasAssistantResponse &&
        (status === 'ready' || status === 'error') &&
        sawRunning
      ) {
        resolve();
        return;
      }
      if (Date.now() - startedAt > args.timeoutMs) {
        reject(new Error(`Agent eval timed out after ${args.timeoutMs}ms`));
        return;
      }
      window.setTimeout(poll, 100);
    };
    poll();
  });
}

function loadFixture(fixture: AgentEvalFixture) {
  const sheets = fixture.sheets ?? [];
  useStore.setState({
    sheets: Object.fromEntries(sheets.map((sheet) => [sheet.id, sheet])),
    sheetIds: sheets.map((sheet) => sheet.id),
    charts: {},
    chartIds: [],
    notes: {},
    noteIds: [],
    selectedIds: new Set(),
    history: [],
    future: [],
  });
}

export function AgentEvalBridge({ enabled, getSelection }: AgentEvalBridgeProps) {
  const { messages, sendMessage, status, error, setMessages } = useAgentSession({
    getSelection,
    getAttachSelection: () => true,
  });
  const messagesRef = useRef(messages);
  const statusRef = useRef(status as AgentEvalStatus);
  const errorRef = useRef(error);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    statusRef.current = status as AgentEvalStatus;
  }, [status]);

  useEffect(() => {
    errorRef.current = error;
  }, [error]);

  const runPrompt = useCallback(
    async (prompt: string, options: RunPromptOptions = {}) => {
      const text = prompt.trim();
      if (!text) throw new Error('Prompt is required');
      if (statusRef.current === 'submitted' || statusRef.current === 'streaming') {
        throw new Error('Agent is already running');
      }

      if (options.resetConversation) {
        setMessages([]);
        messagesRef.current = [];
      }

      const startedMessageCount = messagesRef.current.length;
      let sendError = '';
      void Promise.resolve(sendMessage({ text })).catch((err: unknown) => {
        sendError = err instanceof Error ? err.message : String(err);
      });
      let completionError = '';
      try {
        await waitForTurnCompletion({
          getMessages: () => messagesRef.current,
          getStatus: () => statusRef.current,
          startedMessageCount,
          timeoutMs: options.timeoutMs ?? 120_000,
        });
      } catch (err) {
        completionError = err instanceof Error ? err.message : String(err);
      }

      const sessionError = errorRef.current
        ? errorRef.current instanceof Error
          ? errorRef.current.message
          : String(errorRef.current)
        : '';

      return {
        canvasState: summarizeCanvasState(),
        error: completionError || sendError || sessionError || undefined,
        messages: messagesRef.current,
        status: statusRef.current,
      };
    },
    [sendMessage, setMessages],
  );

  useEffect(() => {
    if (!enabled) return undefined;
    window.__sheetCanvasAgentEval = {
      getCanvasState: summarizeCanvasState,
      getMessages: () => messagesRef.current,
      getStatus: () => statusRef.current,
      loadFixture,
      runPrompt,
    };
    return () => {
      if (window.__sheetCanvasAgentEval?.runPrompt === runPrompt) {
        delete window.__sheetCanvasAgentEval;
      }
    };
  }, [enabled, runPrompt]);

  return null;
}
