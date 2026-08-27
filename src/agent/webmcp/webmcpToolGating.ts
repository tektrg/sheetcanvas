// Decides which of the 26 canvas tools to expose over WebMCP right now.
//
// IMPORTANT: this gate is an optimization, never a security boundary. An
// un-gated call still degrades to a clean `{ok:false, error}` from
// `executeClientTool` — nothing here is load-bearing for correctness or
// safety, it only avoids offering a tool that is guaranteed to fail.
//
// This is deliberately NOT the backend's `selectToolNames`
// (backend/src/agent/route.ts:122). That gate is conversation-shaped ("did
// listConnections appear in this turn's messages") — WebMCP has no turns.
// ChatGPT fetches the tool list once, then calls tools later; a tool that
// vanishes between getTools and executeTool is an unrecoverable error for
// that door. So gating here is keyed on durable store facts (does a sheet
// exist, does a note exist, ...), not on conversational history.
import type { AppState } from '../../../store';
import { TOOL_NAMES, type ToolName } from '../../../agent/tools';

export interface GatingState {
  hasSheet: boolean;
  hasNote: boolean;
  hasSchemaToken: boolean;
  hasPrivateResult: boolean;
  hasConnectorSheet: boolean;
}

// Callable with zero canvas state — the documented discovery step for their
// respective domains (or, for the sheet/create tools, have no precondition
// at all). `listNotes` in particular must NEVER be gated: it's how an agent
// learns there are zero notes, not just how it lists existing ones.
const NEVER_GATED: readonly ToolName[] = [
  'listSheets',
  'getSelection',
  'createSheet',
  'createNote',
  'listNotes',
  'listConnections',
  'listConnectionProperties',
  'describeConnection',
];

const SHEET_GATED: readonly ToolName[] = [
  'describeSheet',
  'getRange',
  'querySheet',
  'setCells',
  'applyFilter',
  'applySort',
  'applyFormat',
  'createChart',
  'createPivot',
  'createSparkline',
];

const NOTE_GATED: readonly ToolName[] = ['readNote', 'updateNote', 'deleteNote'];

// Their failure message literally says "run describeConnection first and
// pass its schemaToken" — gating turns a guaranteed wasted round trip into a
// tool that simply isn't offered yet.
const SCHEMA_TOKEN_GATED: readonly ToolName[] = ['queryConnection', 'createQuerySheet', 'createGaTrendBySource'];

const PRIVATE_RESULT_GATED: readonly ToolName[] = ['createQuerySheetFromResult'];

const CONNECTOR_SHEET_GATED: readonly ToolName[] = ['updateQuerySheet'];

// `hasConnectorSheet` requires scanning every sheet for `connectorConfig`,
// which is the one gating fact that isn't a plain count. Memoized on
// `sheetIds` array identity so a run of cell edits (which never replaces the
// `sheetIds` array reference) costs nothing beyond the initial `===` check.
let connectorSheetMemo: { sheetIds: AppState['sheetIds']; value: boolean } | null = null;

function hasConnectorSheetMemoized(state: AppState): boolean {
  if (connectorSheetMemo && connectorSheetMemo.sheetIds === state.sheetIds) {
    return connectorSheetMemo.value;
  }
  const value = state.sheetIds.some((id) => !!state.sheets[id]?.connectorConfig);
  connectorSheetMemo = { sheetIds: state.sheetIds, value };
  return value;
}

export function readGatingState(state: AppState): GatingState {
  return {
    hasSheet: state.sheetIds.length > 0,
    hasNote: state.noteIds.length > 0,
    // `connections.length` is deliberately NOT used anywhere in this module:
    // `connections` is lazily loaded (clientToolExecutor.ts calls
    // loadConnections only when it's empty), so 0 means "not fetched yet",
    // not "none configured". Gating on it would make a fresh tab structurally
    // unable to start a connector flow via listConnections (which is why
    // listConnections is in NEVER_GATED, not gated on this).
    hasSchemaToken: Object.keys(state.connectionSchemaTokens).length > 0,
    hasPrivateResult: state.privateQueryResultIds.length > 0,
    hasConnectorSheet: hasConnectorSheetMemoized(state),
  };
}

export function computeDesiredTools(gating: GatingState): Set<ToolName> {
  const desired = new Set<ToolName>(NEVER_GATED);
  if (gating.hasSheet) SHEET_GATED.forEach((name) => desired.add(name));
  if (gating.hasNote) NOTE_GATED.forEach((name) => desired.add(name));
  if (gating.hasSchemaToken) SCHEMA_TOKEN_GATED.forEach((name) => desired.add(name));
  if (gating.hasPrivateResult) PRIVATE_RESULT_GATED.forEach((name) => desired.add(name));
  if (gating.hasConnectorSheet) CONNECTOR_SHEET_GATED.forEach((name) => desired.add(name));
  return desired;
}

/**
 * Cheap, stable key for "has the gated tool set changed". Built purely from
 * counts (plus the memoized connector-sheet scan) so it does NOT change on
 * cell edits — only on sheet/note/connection/result count changes. This is
 * what stops keystrokes from causing WebMCP registration churn.
 */
export function gatingKey(state: AppState): string {
  const gating = readGatingState(state);
  return [
    state.sheetIds.length,
    state.noteIds.length,
    Object.keys(state.connectionSchemaTokens).length,
    state.privateQueryResultIds.length,
    gating.hasConnectorSheet ? 1 : 0,
  ].join('|');
}

// Referenced by tests to assert computeDesiredTools never drifts from the
// canonical tool list.
export const ALL_TOOL_NAMES: readonly ToolName[] = TOOL_NAMES;
