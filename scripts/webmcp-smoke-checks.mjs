// Browser-side check functions and assertion runners for
// scripts/webmcp-smoke.mjs. Split out to keep each file under this repo's
// ~700 LOC refactor trigger (see .claude skill coding-engineering-basics).
//
// The `browser*` functions below are never called directly from Node — each
// is serialized independently via `fn.toString()` (pageFunctionCall) and
// evaluated standalone inside the page, so they cannot share helpers by
// reference; small ones like `callTool` are duplicated inline where needed.

import { evaluate, NATIVE_SINGLE_CALL_CAP_MS, pageFunctionCall, scaleTimeoutMs } from './webmcp-smoke-cdp.mjs';

const WEBMCP_OUTPUT_BUDGET = 1400; // must match src/agent/webmcp/shapingHelpers.ts
const NAME_MAX_LEN = 30; // OpenAI's cap — stricter than the WebMCP spec's 128
const DESCRIPTION_MAX_CHARS = 500;
const NESTED_DESCRIPTION_MAX_CHARS = 150;
const GATING_DEBOUNCE_MARGIN_MS = 650; // 250ms debounce (webmcpToolGating.ts) + margin
// 2026-08-28 revision: this used to be a SMALLER cap (8000ms, deliberately
// below the stall floor known at the time) so browserWaitForToolsStable
// could abandon a stalled getTools() call and retry cheaply. That was wrong:
// a follow-up diagnostic (the real 5-call gating-snapshot sequence, timed
// call-by-call against the live app) showed individual native-call latency
// commonly sitting in the multi-second-to-20s+ range WITHIN an otherwise-
// successful sequence — not a rare tail past a "fast" floor. An 8000ms cap
// sat BELOW typical latency, so it fired routinely, abandoning calls that
// were actually going to succeed — and, worse, a real run then hung past
// its own accounted-for budget (38000ms) with no resolution, consistent
// with abandoned-but-still-in-flight native calls piling up behind new
// retry attempts rather than the retries actually helping. Now uses the
// SAME NATIVE_SINGLE_CALL_CAP_MS (webmcp-smoke-cdp.mjs) every other
// multi-native-call function in this codebase uses — set ABOVE the highest
// single-call latency actually measured (20243ms), so a genuinely slow-but-
// working call is essentially never abandoned mid-flight; only a call that
// would never settle at all gets cut off, which is the only case abandoning
// it is actually safe.
const GET_TOOLS_PER_CALL_CAP_MS = NATIVE_SINGLE_CALL_CAP_MS;

// NOTE: this deliberately does NOT dynamically import
// '/src/agent/webmcp/webmcpToolGating.ts' (or '/store.ts') from the
// BEHAVIOR page. Empirically, a fresh dynamic `import()` of app source from
// an unrelated Runtime.evaluate call gets a SEPARATE Vite module instance (a
// second `create()` call, a second zustand store) from the one the running
// app mounted with — its `sheetIds`/`noteIds` read back empty even while the
// app itself has already registered SHEET_GATED/NOTE_GATED tools. Verified
// by direct comparison during harness development (state.sheetIds === []
// from this import while getTools() already returned 21 tools including
// describeSheet/getRange/etc.). Cross-store-instance drift, not a bug in the
// app — and per runStaticSchemaAssertions' comment below, a dynamic import
// on a page also corrupts THAT page's own live reconcile loop afterwards.
// `computeDesiredTools` (webmcpToolGating.ts) is a pure function of a
// {hasSheet, hasNote, hasSchemaToken, hasPrivateResult, hasConnectorSheet}
// struct, though — no store access required to CALL it, only to construct
// its input. So the actual expected-tool-name mapping is computed once, via
// `browserComputeGatingTable` below, on the disposable SCHEMA page (which
// already pays the "dynamic import corrupts this page" cost for the
// tools.ts/webmcpDescriptors.ts checks), and the resulting plain-data table
// is handed to the behavior page's assertions as an argument. This replaces
// what used to be a hand-copied, hand-maintained NEVER_GATED_NAMES /
// SHEET_GATED_NAMES / NOTE_GATED_NAMES trio here (which had silently drifted
// to cover only 2 of the module's 5 gating axes — hasSchemaToken /
// hasPrivateResult / hasConnectorSheet were never represented, so a future
// bug that failed to register e.g. queryConnection when hasSchemaToken flips
// true would have gone undetected) with the single source of truth the app
// itself uses, while still never importing gating source into the live page
// whose registration behaviour is under test.
const GATING_AXES = ['hasSheet', 'hasNote', 'hasSchemaToken', 'hasPrivateResult', 'hasConnectorSheet'];

// This harness never drives a connector into the canvas (no ClickHouse
// fixture available), so hasSchemaToken/hasPrivateResult/hasConnectorSheet
// are always false for every gating snapshot taken during a run. The table
// still covers all 5 axes (see browserComputeGatingTable) — only hasSheet
// and hasNote are ever looked up with a non-false value here, which is a
// coverage gap in what this harness can EXERCISE, not in what it can
// correctly ASSERT. Flagged in the handoff report, not silently accepted.
function gatingTableKey(hasSheet, hasNote) {
  return JSON.stringify({ hasSheet, hasNote, hasSchemaToken: false, hasPrivateResult: false, hasConnectorSheet: false });
}

// Discovered empirically alongside the "extra Runtime.evaluate breaks
// document.modelContext" finding in webmcp-smoke.mjs (settlePageAfterNavigate):
// issuing two `evaluate()` round trips back-to-back — even both safe,
// self-contained IIFEs — occasionally causes a scheduled `setTimeout`
// callback inside the page (specifically the 250ms debounce in
// useWebMcpBridge.ts's gating-change subscribe) to be silently skipped or
// badly delayed. Reproduced directly: a note-deletion transition that
// completes in <1s in an isolated script flaked ~1-in-2 in this harness
// until a 1000ms gap was inserted between the preceding gatingSnapshot()
// call and the deleteAllNotes() call that triggers it; with the gap, 4/4
// stress runs resolved on the first attempt. `spacedEvaluate` below enforces
// a minimum gap before every evaluate() round trip in runAssertions/
// runStaticSchemaAssertions so no call site has to remember this by hand.
const MIN_EVALUATE_GAP_MS = 600;

function createSpacedEvaluate(page) {
  let lastCallFinishedAt = 0;
  return async (expression, timeoutMs, label) => {
    const waitMs = lastCallFinishedAt + MIN_EVALUATE_GAP_MS - Date.now();
    if (waitMs > 0) await new Promise((resolvePromise) => setTimeout(resolvePromise, waitMs));
    try {
      return await evaluate(page, expression, timeoutMs, label);
    } finally {
      lastCallFinishedAt = Date.now();
    }
  };
}

// ── Browser-side check functions (serialized via pageFunctionCall) ─────────

// Native document.modelContext.getTools() has routinely been observed to
// take several seconds up to ~20s even on an otherwise-successful call (see
// GET_TOOLS_PER_CALL_CAP_MS above). A plain, unbounded `await getTools()`
// here would let a genuinely-hung (never settling) call block the loop from
// ever re-checking its own `timeoutMs` deadline — surfacing as an opaque
// CDP-level Runtime.evaluate timeout instead of a bounded, informative
// result. Racing each call against `perCallCapMs` (set ABOVE typical/worst-
// case latency, not below it — an earlier, smaller cap fired routinely and
// made things worse, see that constant's revision note) exists ONLY to catch
// a call that would truly never settle; a normal slow-but-working call
// always finishes within its own race and is used directly, no abandonment.
// This still bounds the whole function at timeoutMs + perCallCapMs in the
// worst case. `getToolsBounded` is nested INSIDE this function, not a
// sibling helper, because pageFunctionCall serializes this function
// standalone via .toString() (see this file's top-of-file comment).
async function browserWaitForToolsStable(timeoutMs, perCallCapMs) {
  async function getToolsBounded() {
    if (!document.modelContext) return null;
    let timer;
    const capped = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`getTools() exceeded the ${perCallCapMs}ms per-iteration cap`)), perCallCapMs);
    });
    try {
      return await Promise.race([document.modelContext.getTools(), capped]);
    } catch {
      return null; // stalled or errored this iteration — retried on the next pass
    } finally {
      clearTimeout(timer);
    }
  }

  const start = Date.now();
  let lastLen = -1;
  let stableSince = null;
  while (Date.now() - start < timeoutMs) {
    const tools = await getToolsBounded();
    if (tools === null) {
      await new Promise((r) => setTimeout(r, 100));
      continue;
    }
    if (tools.length === lastLen && tools.length > 0) {
      if (stableSince === null) stableSince = Date.now();
      if (Date.now() - stableSince > 300) return { names: tools.map((t) => t.name).sort(), count: tools.length, timedOut: false };
    } else {
      stableSince = null;
    }
    lastLen = tools.length;
    await new Promise((r) => setTimeout(r, 150));
  }
  const tools = await getToolsBounded();
  return { names: tools ? tools.map((t) => t.name).sort() : [], count: tools ? tools.length : 0, timedOut: true };
}

// `gatingTable` is plain JSON data precomputed on the isolated schema page
// via browserComputeGatingTable (see the Node-side comment above) — this
// function itself never imports app source, so it's safe to run on the live
// behavior page.
//
// 2026-08-28 follow-up investigation: this function makes FIVE sequential
// native calls (getTools, executeTool, getTools, executeTool, getTools) —
// the original fix pass sized this call's budget as if it were a single
// native call plus margin (25000ms), which was wrong; a real reported
// failure ("gating snapshot ... timed out after 25000ms") reproduced this
// exactly. A dedicated diagnostic (5 fresh trials against the real app,
// timing each of the 5 calls individually) measured two clean, successful
// completions at 31552ms and 28485ms total — both would have blown a
// 25000ms budget — with individual native-call latencies ranging ~200ms to
// 20243ms within a single sequence (i.e. more than one call in a sequence
// is commonly slow, not just one occasional straggler). `boundedCall` races
// each individual native call against `perCallCapMs` (set above the highest
// single-call latency actually observed, 20243ms, so a genuinely slow-but-
// working call is never needlessly cut off) and names which specific call
// breached it — so a TRUE stall (not just this routine multi-second
// latency) still fails fast with a precise, actionable error instead of the
// generic, undiagnosable "Runtime.evaluate timed out" the original report
// showed. The Node-side call site budgets the whole sequence additively
// (5 x perCallCapMs + margin) rather than guessing a flat number.
async function browserGetGatingSnapshot(gatingTable, stringifyInput, perCallCapMs) {
  async function boundedCall(label, fn) {
    let timer;
    const capped = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} exceeded its ${perCallCapMs}ms cap`)), perCallCapMs);
    });
    try {
      return await Promise.race([fn(), capped]);
    } finally {
      clearTimeout(timer);
    }
  }
  async function callTool(name, input) {
    const handles = await boundedCall(`getTools (for ${name})`, () => document.modelContext.getTools());
    const handle = handles.find((h) => h.name === name);
    if (!handle) throw new Error('Tool not registered: ' + name);
    const raw = await boundedCall(`executeTool(${name})`, () =>
      document.modelContext.executeTool(handle, stringifyInput ? JSON.stringify(input) : input),
    );
    return JSON.parse(raw);
  }
  const sheets = await callTool('listSheets', {});
  const notes = await callTool('listNotes', {});
  const hasSheet = Array.isArray(sheets.sheets) && sheets.sheets.length > 0;
  const hasNote = Array.isArray(notes.notes) && notes.notes.length > 0;
  // This harness never drives a connector into the canvas, so the other 3
  // gating axes are always false for any snapshot taken here — the table
  // itself covers all 5 (see browserComputeGatingTable), only this lookup
  // never varies hasSchemaToken/hasPrivateResult/hasConnectorSheet.
  const key = JSON.stringify({ hasSheet, hasNote, hasSchemaToken: false, hasPrivateResult: false, hasConnectorSheet: false });
  const expected = gatingTable[key] || [];
  const handles = await boundedCall('getTools (final)', () => document.modelContext.getTools());
  const actual = handles.map((h) => h.name).sort();
  return {
    hasSheet,
    hasNote,
    noteIds: (notes.notes || []).map((n) => n.noteId),
    expected,
    actual,
  };
}

// Same multi-call structure as browserGetGatingSnapshot (2 native calls up
// front, then 2 more PER note deleted) — see that function's comment for the
// evidence behind `perCallCapMs` and why each call is individually raced
// rather than trusting one flat budget for the whole sequence.
async function browserDeleteAllNotes(stringifyInput, perCallCapMs) {
  async function boundedCall(label, fn) {
    let timer;
    const capped = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} exceeded its ${perCallCapMs}ms cap`)), perCallCapMs);
    });
    try {
      return await Promise.race([fn(), capped]);
    } finally {
      clearTimeout(timer);
    }
  }
  const handles = await boundedCall('getTools (for listNotes)', () => document.modelContext.getTools());
  const listHandle = handles.find((h) => h.name === 'listNotes');
  const notesRaw = await boundedCall('executeTool(listNotes)', () =>
    document.modelContext.executeTool(listHandle, stringifyInput ? JSON.stringify({}) : {}),
  );
  const ids = (JSON.parse(notesRaw).notes || []).map((n) => n.noteId);
  const deleted = [];
  for (const id of ids) {
    const freshHandles = await boundedCall(`getTools (for deleteNote ${id})`, () => document.modelContext.getTools());
    const deleteHandle = freshHandles.find((h) => h.name === 'deleteNote');
    if (!deleteHandle) break;
    const input = { noteId: id };
    await boundedCall(`executeTool(deleteNote ${id})`, () =>
      document.modelContext.executeTool(deleteHandle, stringifyInput ? JSON.stringify(input) : input),
    );
    deleted.push(id);
  }
  return deleted;
}

// Each of the three functions below races its own dynamic import() calls
// against a cap and throws/records a clear error naming the failing specifier
// on a rejection (bad path, syntax error) or a cap breach (a genuine hang),
// instead of letting a broken/stuck import silently eat the caller's
// evaluate() budget. Duplicated inline per function, not a shared helper,
// because pageFunctionCall serializes each standalone (see top-of-file).

// An out-of-band import() like this one has been measured to take up to ~8s
// (see runStaticSchemaAssertions' comment below for the full finding).
// runStaticSchemaAssertions calls this ONCE, before the timed checks, so that
// cost is paid explicitly and visibly rather than silently eating into (and
// occasionally exceeding) the checks' own budget.
async function browserWarmDynamicImports(perImportCapMs) {
  const specifiers = ['/agent/tools.ts', '/src/agent/webmcp/webmcpDescriptors.ts', '/src/agent/webmcp/webmcpToolGating.ts'];
  const results = [];
  for (const specifier of specifiers) {
    let timer;
    const capped = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`exceeded its ${perImportCapMs}ms cap`)), perImportCapMs);
    });
    try {
      await Promise.race([import(specifier), capped]);
      results.push({ specifier, ok: true });
    } catch (err) {
      results.push({ specifier, ok: false, error: err && err.message ? err.message : String(err) });
    } finally {
      clearTimeout(timer);
    }
  }
  return results;
}

async function browserComputeStaticSchemaChecks(nameMaxLen, descriptionMaxChars, nestedDescriptionMaxChars, perImportCapMs) {
  async function importOrThrow(specifier, capMs) {
    let timer;
    const capped = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`exceeded its ${capMs}ms cap`)), capMs);
    });
    try {
      return await Promise.race([import(specifier), capped]);
    } catch (err) {
      throw new Error(`Failed to dynamically import '${specifier}': ${err && err.message ? err.message : err}`);
    } finally {
      clearTimeout(timer);
    }
  }
  const toolsMod = await importOrThrow('/agent/tools.ts', perImportCapMs);
  const descMod = await importOrThrow('/src/agent/webmcp/webmcpDescriptors.ts', perImportCapMs);
  const nameRe = new RegExp('^[A-Za-z0-9_.-]{1,' + nameMaxLen + '}$');

  let worstDescription = { toolName: null, length: -1 };
  let worstNestedDescription = { path: null, length: -1 };
  const additionalPropertiesTraps = [];
  const schemaKeyHits = [];
  const nameViolations = [];
  const recordLikeNodes = [];

  function walk(node, path) {
    if (Array.isArray(node)) {
      node.forEach((child, i) => walk(child, path + '[' + i + ']'));
      return;
    }
    if (node === null || typeof node !== 'object') return;
    if (Object.prototype.hasOwnProperty.call(node, '$schema')) schemaKeyHits.push(path + '.$schema');
    const hasProperties = Object.prototype.hasOwnProperty.call(node, 'properties');
    const hasAdditionalProperties = Object.prototype.hasOwnProperty.call(node, 'additionalProperties');
    if (hasAdditionalProperties && node.additionalProperties === false && !hasProperties) {
      additionalPropertiesTraps.push(path);
    }
    if (hasAdditionalProperties && !hasProperties && node.additionalProperties !== false) {
      recordLikeNodes.push(path);
    }
    if (typeof node.description === 'string' && node.description.length > nestedDescriptionMaxChars) {
      if (node.description.length > worstNestedDescription.length) {
        worstNestedDescription = { path, length: node.description.length };
      }
    }
    for (const key of Object.keys(node)) walk(node[key], path + '.' + key);
  }

  const perTool = [];
  for (const name of toolsMod.TOOL_NAMES) {
    const meta = descMod.buildDescriptorMeta(name);
    const nameOk = nameRe.test(meta.name);
    if (!nameOk) nameViolations.push({ toolName: name, exposedName: meta.name });
    const descLen = meta.description.length;
    if (descLen > worstDescription.length) worstDescription = { toolName: meta.name, length: descLen };
    walk(meta.inputSchema, name + '.inputSchema');
    perTool.push({
      toolName: name,
      exposedName: meta.name,
      nameOk,
      descriptionLength: descLen,
      descriptionOk: descLen <= descriptionMaxChars,
    });
  }

  return {
    totalTools: toolsMod.TOOL_NAMES.length,
    perTool,
    nameViolations,
    worstDescription,
    worstNestedDescription: worstNestedDescription.path ? worstNestedDescription : null,
    additionalPropertiesTraps,
    recordLikeNodeCount: recordLikeNodes.length,
    recordLikeNodes,
    schemaKeyHits,
  };
}

// Computes the authoritative expected-tool-name table by calling the app's
// OWN pure `computeDesiredTools` (webmcpToolGating.ts) with every
// {hasSheet, hasNote} combination this harness can actually drive (the other
// 3 gating axes — hasSchemaToken/hasPrivateResult/hasConnectorSheet — are
// held false; see the Node-side comment on gatingTableKey for why). Must run
// on the disposable SCHEMA page, never the behavior page under test — see
// this file's top-of-file comment and runStaticSchemaAssertions' comment
// below for why a dynamic import of app source corrupts whichever page it
// runs on. `computeDesiredTools` takes a plain struct and returns a Set with
// no store/DOM access, so calling it here with synthetic input (rather than
// reading live state) is faithful, not a workaround.
async function browserComputeGatingTable(perImportCapMs) {
  async function importOrThrow(specifier, capMs) {
    let timer;
    const capped = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`exceeded its ${capMs}ms cap`)), capMs);
    });
    try {
      return await Promise.race([import(specifier), capped]);
    } catch (err) {
      throw new Error(`Failed to dynamically import '${specifier}': ${err && err.message ? err.message : err}`);
    } finally {
      clearTimeout(timer);
    }
  }
  const mod = await importOrThrow('/src/agent/webmcp/webmcpToolGating.ts', perImportCapMs);
  const table = {};
  for (const hasSheet of [false, true]) {
    for (const hasNote of [false, true]) {
      const gating = { hasSheet, hasNote, hasSchemaToken: false, hasPrivateResult: false, hasConnectorSheet: false };
      table[JSON.stringify(gating)] = Array.from(mod.computeDesiredTools(gating)).sort();
    }
  }
  return table;
}

// This Chrome build's real executeTool() (a) rejects a bare tool-name string
// with "not of type 'RegisteredTool'", so this always resolves a getTools()
// handle first; and (b) rejects a plain-object input with "Failed to parse
// input arguments", so `stringifyInput` (true in native mode, false — the
// modelContext.ts-declared contract — in shim mode) controls whether `input`
// is JSON.stringify'd before the call. See webmcp-smoke.mjs's file header.
// Two native calls (getTools + executeTool) — each raced against
// `perCallCapMs` for the same reason as browserGetGatingSnapshot (see its
// comment for the evidence); a cap breach here surfaces as a structured
// `{ok:false, ...}` naming which call stalled, consistent with this
// function's existing error shape, rather than an uncaught throw.
async function browserExecTool(name, input, stringifyInput, perCallCapMs) {
  async function boundedCall(label, fn) {
    let timer;
    const capped = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} exceeded its ${perCallCapMs}ms cap`)), perCallCapMs);
    });
    try {
      return await Promise.race([fn(), capped]);
    } finally {
      clearTimeout(timer);
    }
  }
  try {
    if (!document.modelContext) return { ok: false, threw: true, errorName: 'NoModelContext', errorMessage: 'document.modelContext is not present' };
    const handles = await boundedCall('getTools', () => document.modelContext.getTools());
    const handle = handles.find((h) => h.name === name);
    if (!handle) return { ok: false, threw: true, errorName: 'NotRegistered', errorMessage: `Tool "${name}" is not currently registered (${handles.length} registered: ${handles.map((h) => h.name).join(',')})` };
    const raw = await boundedCall(`executeTool(${name})`, () =>
      document.modelContext.executeTool(handle, stringifyInput ? JSON.stringify(input) : input),
    );
    return { ok: true, isString: typeof raw === 'string', length: typeof raw === 'string' ? raw.length : null, raw: typeof raw === 'string' ? raw : JSON.stringify(raw) };
  } catch (err) {
    return { ok: false, threw: true, errorName: err && err.name ? err.name : typeof err, errorMessage: err && err.message ? String(err.message) : String(err) };
  }
}

// ── Test data builders ──────────────────────────────────────────────────────

function columnLetter(oneIndexedCol) {
  let n = oneIndexedCol;
  let s = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

// 54 columns (A..BB) x 370 rows = 19,980 cells. NOTE: clientToolExecutor's
// MAX_CREATE_SHEET_CELLS (20,000) is enforced ONLY on `createSheet`
// (clientToolExecutor.ts:542) — `setCells` (clientToolExecutor.ts:501-533)
// and the setCells zod schema (agent/tools.ts's `cells` record) have no
// cell-count cap at all, so staying under 20,000 here is not what makes this
// setCells call succeed; it succeeds regardless of count. The 19,980 figure
// is sized instead to comfortably exercise the getRange('A1:BB500')
// pathological case the brief calls out (the requested range extends 130
// rows past the populated data; getRange must still build+clip empty
// trailing rows without blowing its budget) without an excessively slow
// populate step.
const BIG_RANGE_COLS = 54; // A..BB
const BIG_RANGE_POPULATED_ROWS = 370;
const BIG_RANGE = `A1:${columnLetter(BIG_RANGE_COLS)}500`;

function buildBigRangeCells() {
  const cells = {};
  for (let row = 1; row <= BIG_RANGE_POPULATED_ROWS; row += 1) {
    for (let col = 1; col <= BIG_RANGE_COLS; col += 1) {
      cells[`${columnLetter(col)}${row}`] = { raw: String(row * 1000 + col) };
    }
  }
  return cells;
}

// ── Assertion runner ─────────────────────────────────────────────────────────

// A `skipped` assertion is neither a pass nor a genuine fail — it means a
// precondition the assertion needed (e.g. a sheet id from an earlier step)
// was unavailable, so the check never actually ran. Rendering that as a
// plain PASS would silently green-light an unproven claim; rendering it as a
// plain FAIL would blame the assertion for a setup problem elsewhere. Either
// way it must still block a green exit — see runHarness's overallPass in
// webmcp-smoke.mjs — so "PASS" is impossible for `skipped: true` regardless
// of what `passed` is set to.
export function makeAssertionTracker() {
  const results = [];
  return {
    results,
    record(id, label, passed, detail, { skipped = false } = {}) {
      results.push({ id, label, passed: skipped ? false : passed, skipped, detail });
    },
  };
}

export async function runAssertions(page, tracker, consoleSink, mode, timeoutMs, gatingTable) {
  const record = tracker.record.bind(tracker);
  const t = (baselineMs) => scaleTimeoutMs(baselineMs, timeoutMs);
  // Native mode requires JSON.stringify'd executeTool input (see
  // webmcp-smoke.mjs's file-header comment); shim mode keeps the
  // object-input contract modelContext.ts and webmcpRegistry.ts are
  // actually written against. Centralized here so every call site below
  // stays mode-agnostic.
  const stringifyInput = mode === 'native';
  const spacedEvaluate = createSpacedEvaluate(page);
  // `callCap` bounds every native getTools() call these three make, and
  // (for execTool) the DEFAULT executeTool() cap too — see
  // NATIVE_SINGLE_CALL_CAP_MS's comment for the evidence. execTool's third
  // argument is the executeTool() cap specifically: most calls hit native
  // WebMCP latency only (default is fine), but a couple of call sites below
  // (setCells over 20k cells, getRange over a big range) are genuinely slow
  // by DESIGN — not a native stall — so they pass their own larger cap for
  // just that call. The outer evaluate() budget is always computed as the
  // sum of whatever native calls a function makes, so it's never guessing a
  // flat number independent of how many calls are actually inside.
  const callCap = t(NATIVE_SINGLE_CALL_CAP_MS);
  const execTool = (name, input, executeCapMs = callCap) =>
    spacedEvaluate(
      pageFunctionCall(browserExecTool, name, input, stringifyInput, callCap, executeCapMs),
      callCap + executeCapMs + t(5_000), // 1 getTools() call + 1 executeTool() call + margin
      `executeTool('${name}')`,
    );
  const gatingSnapshot = () =>
    spacedEvaluate(
      pageFunctionCall(browserGetGatingSnapshot, gatingTable, stringifyInput, callCap),
      5 * callCap + t(10_000), // getTools, executeTool(listSheets), getTools, executeTool(listNotes), getTools(final)
      'gating snapshot (listSheets/listNotes + getTools)',
    );
  const deleteAllNotes = () =>
    spacedEvaluate(
      pageFunctionCall(browserDeleteAllNotes, stringifyInput, callCap),
      6 * callCap + t(10_000), // 2 calls up front + 2 more per deleted note (demo seed has 1; margin covers a couple more)
      'deleteAllNotes (listNotes + deleteNote loop)',
    );
  // Default raised alongside GET_TOOLS_PER_CALL_CAP_MS's revision: reaching
  // 2 consecutive stable reads needs real room for a few genuinely-slow
  // (not stalled) getTools() calls at up to ~25s each, not the smaller
  // budget that fit the old, smaller (and wrong) per-call cap.
  const toolsSnapshot = (timeoutMs_ = 2 * callCap + t(10_000)) =>
    spacedEvaluate(
      pageFunctionCall(browserWaitForToolsStable, timeoutMs_, GET_TOOLS_PER_CALL_CAP_MS),
      timeoutMs_ + GET_TOOLS_PER_CALL_CAP_MS + t(5_000),
      `document.modelContext tool list to stabilize (browser-side budget ${timeoutMs_}ms)`,
    );
  const parseToolJson = (execResult) => {
    if (!execResult.ok) return null;
    try {
      return JSON.parse(execResult.raw);
    } catch {
      return null;
    }
  };

  // Derived from gatingTable rather than hand-copied (see this file's
  // top-of-file comment): the note-gated tool names are exactly the ones
  // that appear with hasNote=true (sheet present, matching the demo seed)
  // but not with hasNote=false.
  const noteGatedNames = (gatingTable[JSON.stringify({ hasSheet: true, hasNote: true, hasSchemaToken: false, hasPrivateResult: false, hasConnectorSheet: false })] || [])
    .filter((n) => !(gatingTable[JSON.stringify({ hasSheet: true, hasNote: false, hasSchemaToken: false, hasPrivateResult: false, hasConnectorSheet: false })] || []).includes(n));

  // ── 1: getTools() count matches the gating layer for the current state ───
  // NOTE: SheetCanvas seeds a demo sheet ('demo-1') + a welcome note
  // ('note-welcome') on first load with no persisted workspace (store.ts,
  // ~line 264/307) — a genuinely empty canvas never exists on a fresh
  // profile. So "current store state" here is whatever that seed produces
  // (normally hasSheet=true, hasNote=true), not zero. See
  // browserGetGatingSnapshot's comment for why the comparison is derived
  // from listSheets/listNotes (the WebMCP door itself) rather than store.ts.
  await toolsSnapshot(3 * callCap + t(10_000));
  const baselineGating = await gatingSnapshot();
  const baselineMatches = JSON.stringify(baselineGating.expected) === JSON.stringify(baselineGating.actual);
  record(
    1,
    'getTools() count matches gating layer for the current store state',
    baselineMatches,
    `hasSheet=${baselineGating.hasSheet} hasNote=${baselineGating.hasNote} (demo seed) — expected=${baselineGating.expected.length} [${baselineGating.expected.join(',')}] actual=${baselineGating.actual.length} [${baselineGating.actual.join(',')}]`,
  );

  // ── 10: registration transition ───────────────────────────────────────────
  // The brief's scenario (empty canvas -> create a sheet -> tool count
  // changes) does not apply as written: the demo seed means hasSheet/hasNote
  // are ALREADY true at baseline (assertion 1's finding above), so creating
  // another sheet leaves the desired tool NAME SET unchanged (SHEET_GATED
  // tools are already registered). Exercising a real transition therefore
  // means flipping a gating fact that starts false, or removing one that
  // starts true. This adapts to whichever is actually true at baseline:
  //   - hasNote already true (the normal case)  -> delete all notes, wait
  //     past HYSTERESIS_MS (webmcpRegistry.ts, 2000ms) + margin, expect
  //     NOTE_GATED tools to disappear.
  //   - hasNote false (e.g. seed logic changes later) -> create a note, wait
  //     GATING_CHANGE_DEBOUNCE_MS (250ms) + margin, expect them to appear.
  // Either direction proves the same mechanism: reconcile reacting to a
  // durable gating-fact change.
  // Retries the tools snapshot a few times with a full hysteresis-sized wait
  // between attempts. HYSTERESIS_MS (2000ms) + GATING_CHANGE_DEBOUNCE_MS
  // (250ms) is the theoretical minimum, but React effect scheduling /
  // reconcile coalescing (webmcpRegistry.ts's "coalesce plus one extra pass"
  // design) occasionally pushes the observable change past a single
  // wait-then-check — empirically flaky in shim mode at ~1-in-3 with a
  // single 2400ms wait, reliable within 2 attempts. This does not weaken the
  // assertion: it still requires the tool set to genuinely converge to the
  // expected membership, just tolerates real async scheduling jitter rather
  // than a hardcoded instant.
  async function waitForStableMatch(isDone, attempts = 3, delayMs = 2_400) {
    let snapshot = null;
    for (let i = 0; i < attempts; i += 1) {
      await new Promise((resolvePromise) => setTimeout(resolvePromise, delayMs));
      snapshot = await toolsSnapshot();
      if (isDone(snapshot)) return { snapshot, attemptsUsed: i + 1 };
    }
    return { snapshot, attemptsUsed: attempts };
  }

  let transitionDetail;
  let transitionPassed;
  if (baselineGating.hasNote) {
    const deletedNoteIds = await deleteAllNotes();
    const { snapshot: afterDeleteSnapshot, attemptsUsed } = await waitForStableMatch(
      (snap) => noteGatedNames.every((n) => !snap.names.includes(n)),
    );
    const noteToolsGone = noteGatedNames.every((n) => !afterDeleteSnapshot.names.includes(n));
    transitionPassed = deletedNoteIds.length > 0 && noteToolsGone;
    transitionDetail = `removal path: deleted ${deletedNoteIds.length} note(s) [${deletedNoteIds.join(',')}] (${attemptsUsed} attempt(s)), before=${baselineGating.actual.length} after=${afterDeleteSnapshot.count}, NOTE_GATED tools gone: ${noteToolsGone}`;
  } else {
    const createNoteResult = await execTool('createNote', { content: '# WebMCP smoke transition note' });
    const { snapshot: afterCreateSnapshot, attemptsUsed } = await waitForStableMatch(
      (snap) => noteGatedNames.every((n) => snap.names.includes(n)),
      3,
      GATING_DEBOUNCE_MARGIN_MS,
    );
    const noteToolsPresent = noteGatedNames.every((n) => afterCreateSnapshot.names.includes(n));
    transitionPassed = createNoteResult.ok && noteToolsPresent;
    transitionDetail = `addition path: createNote.ok=${createNoteResult.ok} (${attemptsUsed} attempt(s)), before=${baselineGating.actual.length} after=${afterCreateSnapshot.count}, NOTE_GATED tools present: ${noteToolsPresent}`;
  }
  record(10, 'Registration transition: tool set changes when a durable gating fact (hasNote) flips', transitionPassed, transitionDetail);

  // ── 7: functional round trip ──────────────────────────────────────────────
  const createSmallResult = await execTool('createSheet', {
    title: 'WebMCP Smoke Sheet',
    data: [
      ['Name', 'Value'],
      ['Alpha', '1'],
      ['Beta', '2'],
    ],
  });
  const smallSheetId = parseToolJson(createSmallResult)?.sheetId ?? null;

  const listSheetsResult = await execTool('listSheets', {});
  let roundTripOk = false;
  let roundTripDetail = 'createSheet did not return ok/sheetId';
  const parsedList = parseToolJson(listSheetsResult);
  if (createSmallResult.ok && smallSheetId && parsedList) {
    const found = Array.isArray(parsedList.sheets) && parsedList.sheets.some((s) => s.sheetId === smallSheetId);
    roundTripOk = found;
    roundTripDetail = found
      ? `sheetId ${smallSheetId} present in listSheets (${parsedList.sheets.length} sheet(s) total)`
      : `sheetId ${smallSheetId} NOT found in listSheets response: ${listSheetsResult.raw.slice(0, 300)}`;
  } else {
    roundTripDetail = `createSheet.ok=${createSmallResult.ok} sheetId=${smallSheetId} listSheets.ok=${listSheetsResult.ok} createRaw=${JSON.stringify(createSmallResult).slice(0, 300)} listRaw=${JSON.stringify(listSheetsResult).slice(0, 300)}`;
  }
  record(7, "Round trip: executeTool('createSheet') then executeTool('listSheets') reflects the new sheet", roundTripOk, roundTripDetail);

  // ── 8: shaped result budgets (listSheets, describeSheet, getRange pathological) ─
  const budgetMeasurements = [{ tool: 'listSheets', ...(await execTool('listSheets', {})) }];
  if (smallSheetId) {
    budgetMeasurements.push({ tool: 'describeSheet', ...(await execTool('describeSheet', { sheetId: smallSheetId })) });
  }

  const createBigResult = await execTool('createSheet', { title: 'WebMCP Smoke Big Range' });
  const bigSheetId = parseToolJson(createBigResult)?.sheetId ?? null;
  if (bigSheetId) {
    const populateResult = await execTool('setCells', { sheetId: bigSheetId, cells: buildBigRangeCells() }, t(60_000));
    if (!populateResult.ok) {
      record(8, `Shaped result budgets (<= ${WEBMCP_OUTPUT_BUDGET} chars): listSheets/describeSheet/getRange(${BIG_RANGE})`, false, `Failed to populate big-range sheet: ${JSON.stringify(populateResult)}`);
    } else {
      budgetMeasurements.push({ tool: `getRange(${BIG_RANGE})`, ...(await execTool('getRange', { sheetId: bigSheetId, range: BIG_RANGE }, t(30_000))) });
      const allOk = budgetMeasurements.every((m) => m.ok && typeof m.length === 'number' && m.length <= WEBMCP_OUTPUT_BUDGET);
      const detail = budgetMeasurements.map((m) => `${m.tool}=${m.ok ? `${m.length}ch` : `FAILED(${m.errorMessage})`}`).join(', ');
      record(8, `Shaped result budgets (<= ${WEBMCP_OUTPUT_BUDGET} chars): listSheets/describeSheet/getRange(${BIG_RANGE})`, allOk, detail);
    }
  } else {
    record(8, `Shaped result budgets (<= ${WEBMCP_OUTPUT_BUDGET} chars): listSheets/describeSheet/getRange(${BIG_RANGE})`, false, `createSheet for the big-range sheet failed: ${JSON.stringify(createBigResult)}`);
  }

  // ── 9: malformed input rejects, never resolves ────────────────────────────
  // If assertion 7's createSheet failed, there's no sheet id to target and
  // this check cannot meaningfully run at all — that's a distinct "skipped"
  // outcome (see makeAssertionTracker's comment), not a claim that the
  // rejection behavior itself was observed and failed.
  if (!smallSheetId) {
    record(
      9,
      'Malformed input (setCells with a bad cells value) causes executeTool to REJECT',
      false,
      'SKIPPED: no small sheet id available to target (assertion 7 createSheet did not produce one)',
      { skipped: true },
    );
  } else {
    const invalidInputResult = await execTool('setCells', { sheetId: smallSheetId, cells: { A1: 'not-an-object-should-fail-schema' } });
    const invalidInputRejected = invalidInputResult.ok === false;
    record(
      9,
      'Malformed input (setCells with a bad cells value) causes executeTool to REJECT',
      invalidInputRejected,
      invalidInputRejected
        ? `rejected as expected: ${invalidInputResult.errorName}: ${invalidInputResult.errorMessage}`
        : `DID NOT REJECT — resolved with: ${JSON.stringify(invalidInputResult).slice(0, 300)}`,
    );
  }

  // ── 10b: zero InvalidStateError across the whole run's console ───────────
  const invalidStateHits = consoleSink.filter((entry) => /InvalidStateError/.test(entry.text ?? ''));
  record(
    '10b',
    'Zero InvalidStateError occurrences in console across the whole run',
    invalidStateHits.length === 0,
    invalidStateHits.length === 0 ? `0 occurrences across ${consoleSink.length} console/log/exception entries` : `${invalidStateHits.length} occurrence(s): ${JSON.stringify(invalidStateHits.slice(0, 5))}`,
  );

  return { smallSheetId, bigSheetId, baselineGating };
}

// ── Static schema assertions (2,3,4,5,6) — run on a SEPARATE, isolated page ─
// Discovered during harness development: dynamically `import()`-ing the
// app's own TS source (agent/tools.ts, webmcpDescriptors.ts) via
// Runtime.evaluate — needed to compute these checks against the real,
// currently-shipping descriptors for all 26 tools, including ones gating
// never registers in this run (see browserComputeStaticSchemaChecks) —
// reliably and silently breaks that PAGE's live WebMCP reconcile loop
// afterwards: a subsequent deleteNote-driven gating change stopped
// unregistering NOTE_GATED tools even 5+ seconds later, though the store
// mutation itself (confirmed via listNotes) succeeded. Reproduced in
// isolation (minimal repro: import('/agent/tools.ts') then delete a note —
// removal that normally completes in <1s never happens). Most likely an
// artifact of Vite dev-server HMR module-graph tracking reacting badly to an
// out-of-band dynamic import of an already-loaded module (the same class of
// issue as the separate-store-instance finding documented on
// browserGetGatingSnapshot). This is a harness-only hazard, not a
// SheetCanvas defect — a real WebMCP consumer never re-imports the app's own
// source. Fix: run this check on its own freshly-navigated page/target so
// its dynamic imports can never contaminate the behavioral assertions (1, 7,
// 8, 9, 10, 10b), which all run on a different page.
//
// A second, independent timing finding (2026-08-28 root-cause investigation
// of the `runStaticSchemaAssertions` timeout reported in the field): a
// dynamic import() of one of this file's three app-source specifiers, issued
// out-of-band via Runtime.evaluate, has been measured to take upwards of 8s —
// reproduced with ZERO WebMCP flags (before document.modelContext even
// enters the picture), so unrelated to the finding above. NOT a one-time
// cold-start cost either: re-importing the SAME specifier in a LATER,
// separate evaluate() call has also independently exceeded 8s, so
// pre-warming reduces but doesn't eliminate the risk. browserWarmDynamicImports
// still pays for one round up front, off the clock the checks below are
// measured against; IMPORT_CAP_MS applies to every individual import (warm-up
// included) with real margin above the largest latency observed (~8.3s).
const IMPORT_CAP_MS = 25_000;

export async function runStaticSchemaAssertions(page, tracker, timeoutMs) {
  const record = tracker.record.bind(tracker);
  const t = (baselineMs) => scaleTimeoutMs(baselineMs, timeoutMs);
  const importCapMs = t(IMPORT_CAP_MS);

  const warmupResults = await evaluate(
    page,
    pageFunctionCall(browserWarmDynamicImports, importCapMs),
    3 * importCapMs + t(5_000), // 3 specifiers, imported sequentially, each individually capped
    'warming the Vite module graph for agent/tools.ts, webmcpDescriptors.ts and webmcpToolGating.ts (one-time cold-import cost, not counted against the checks below)',
  );
  const failedWarmup = warmupResults.find((r) => !r.ok);
  if (failedWarmup) {
    throw new Error(
      `Static schema checks cannot proceed: dynamic import of '${failedWarmup.specifier}' failed while warming the module graph: ${failedWarmup.error}`,
    );
  }

  const schemaChecks = await evaluate(
    page,
    pageFunctionCall(browserComputeStaticSchemaChecks, NAME_MAX_LEN, DESCRIPTION_MAX_CHARS, NESTED_DESCRIPTION_MAX_CHARS, importCapMs),
    2 * importCapMs + t(5_000), // 2 specifiers (tools.ts, webmcpDescriptors.ts), each individually capped
    'static schema checks (dynamic import of agent/tools.ts + webmcpDescriptors.ts)',
  );
  // Computed here (same disposable page) rather than on the behavior page —
  // see this file's top-of-file comment on GATING_AXES/gatingTableKey for
  // why. Handed back to main() so runAssertions can use it without ever
  // importing gating source into the page under test.
  const gatingTable = await evaluate(
    page,
    pageFunctionCall(browserComputeGatingTable, importCapMs),
    importCapMs + t(5_000), // 1 specifier (webmcpToolGating.ts), individually capped
    'gating table (dynamic import of webmcpToolGating.ts)',
  );

  record(
    2,
    `Tool name charset/length /^[A-Za-z0-9_.-]{1,${NAME_MAX_LEN}}$/`,
    schemaChecks.nameViolations.length === 0,
    schemaChecks.nameViolations.length === 0
      ? `all ${schemaChecks.totalTools} names OK`
      : `violations: ${JSON.stringify(schemaChecks.nameViolations)}`,
  );

  record(
    3,
    `Tool description <= ${DESCRIPTION_MAX_CHARS} chars`,
    schemaChecks.worstDescription.length <= DESCRIPTION_MAX_CHARS,
    `worst: "${schemaChecks.worstDescription.toolName}" = ${schemaChecks.worstDescription.length} chars`,
  );

  record(
    4,
    `Nested parameter description <= ${NESTED_DESCRIPTION_MAX_CHARS} chars`,
    schemaChecks.worstNestedDescription === null,
    schemaChecks.worstNestedDescription
      ? `worst: ${schemaChecks.worstNestedDescription.path} = ${schemaChecks.worstNestedDescription.length} chars`
      : `no node exceeds ${NESTED_DESCRIPTION_MAX_CHARS} chars across ${schemaChecks.totalTools} tools' schemas`,
  );

  record(
    5,
    'No additionalProperties:false on a node lacking properties (setCells/createChart/createSparkline/query* record trap)',
    schemaChecks.additionalPropertiesTraps.length === 0,
    schemaChecks.additionalPropertiesTraps.length === 0
      ? `0 traps found; ${schemaChecks.recordLikeNodeCount} correctly-untouched record-like node(s): ${JSON.stringify(schemaChecks.recordLikeNodes)}`
      : `TRAPPED nodes (structurally uncallable): ${JSON.stringify(schemaChecks.additionalPropertiesTraps)}`,
  );

  record(
    6,
    'No $schema key survives in any emitted inputSchema',
    schemaChecks.schemaKeyHits.length === 0,
    schemaChecks.schemaKeyHits.length === 0 ? 'clean' : `found at: ${JSON.stringify(schemaChecks.schemaKeyHits)}`,
  );

  return { schemaChecks, gatingTable };
}
