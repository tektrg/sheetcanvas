// Module-level singleton that reconciles the browser's `document.modelContext`
// tool registry against "what should be registered right now", per gating
// state. Deliberately NOT a hook-owned lifecycle, for two concrete reasons:
//
//  1. `registerTool` rejects with `InvalidStateError` on a duplicate name.
//  2. This app runs under `React.StrictMode` (index.tsx), which double-invokes
//     effects (mount → cleanup → mount) in dev. An effect that registers 26
//     tools asynchronously would race its own cleanup and hit duplicate-name
//     rejections on every dev mount.
//
// A module-level `Map` with abort bookkeeping is idempotent by construction —
// the same pattern as `agentFocusAccumulator.ts`, which is module-level for
// the same shared-chokepoint reason.
import { z } from 'zod';
import type { SelectionContext } from '../../../types';
import { toolDefs, type ToolName } from '../../../agent/tools';
import { useStore } from '../../../store';
import { dispatchTool } from './toolDispatch';
import { flushAgentFocus } from '../agentFocusAccumulator';
import { computeDesiredTools, gatingKey, readGatingState } from './webmcpToolGating';
import { buildDescriptorMeta } from './webmcpDescriptors';
import { buildErrorMessage, shapeSuccess } from './toolResultShaping';
import { getModelContext, type WebMcpAnnotations, type WebMcpToolDescriptor } from './modelContext';

export type WebMcpStatus = 'unsupported' | 'idle' | 'active' | 'blocked';

export interface ReconcileReport {
  added: ToolName[];
  removed: ToolName[];
  replaced: ToolName[];
  failed: Array<{ name: ToolName; error: string }>;
  status: WebMcpStatus;
}

interface RegistryEntry {
  controller: AbortController;
  fingerprint: string;
  inFlight: number;
  pendingRemoval: boolean;
  registeredAt: number;
}

// Never remove a tool within this long of registering it — avoids
// register/unregister flapping when gating state toggles quickly (e.g. a
// sheet created then immediately deleted by an undo).
const HYSTERESIS_MS = 2_000;

// The zod-issue clip mentioned in the brief; kept short because it becomes
// part of a rejected promise's message, which some clients surface verbatim.
const INVALID_INPUT_MESSAGE_MAX_CHARS = 400;

const registry = new Map<ToolName, RegistryEntry>();

let selectionProvider: (() => SelectionContext) | null = null;
let registryEnabled = true;

// Debounced viewport flush, matching the remote-MCP door's pattern (see
// useMcpBridge.ts) — ChatGPT calls tools one at a time with no turn boundary,
// so we coalesce a burst of calls into a single camera pan rather than
// snapping the view on every tool. Module-level like the rest of this file's
// state: `executeWrapped` isn't hook-owned.
const WEBMCP_FOCUS_FLUSH_DEBOUNCE_MS = 500;
let focusFlushTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleFocusFlush(): void {
  if (focusFlushTimer) clearTimeout(focusFlushTimer);
  focusFlushTimer = setTimeout(flushAgentFocus, WEBMCP_FOCUS_FLUSH_DEBOUNCE_MS);
}
let blocked = false;
let currentStatus: WebMcpStatus = 'idle';

// Exactly-one-retry bookkeeping for InvalidStateError (see registerOne).
const invalidStateRetried = new Set<ToolName>();

// Coalescing (not queueing) lock — see reconcileWebMcpTools.
let inflight: Promise<void> | null = null;
let pendingReason: string | null = null;
let lastReport: ReconcileReport = { added: [], removed: [], replaced: [], failed: [], status: currentStatus };

export function setSelectionProvider(fn: (() => SelectionContext) | null): void {
  selectionProvider = fn;
}

// Lets a caller (the useWebMcpBridge hook's unmount cleanup) apply the same
// identity-guard idiom used in AgentEvalBridge.tsx:248-252: only clear the
// slot if it still holds the exact function this caller installed, so a
// StrictMode remount's newer provider is never clobbered by an older mount's
// delayed cleanup.
export function getSelectionProvider(): (() => SelectionContext) | null {
  return selectionProvider;
}

function resolveSelection(): SelectionContext {
  if (selectionProvider) return selectionProvider();
  // Matches the shape of a fresh tab's selection — never throw for a
  // missing provider, since one legitimately doesn't exist before mount.
  return { sheetId: null, cellId: null, range: null };
}

export function setRegistryEnabled(enabled: boolean): void {
  registryEnabled = enabled;
}

export function getRegisteredToolNames(): ToolName[] {
  return Array.from(registry.keys());
}

export function getWebMcpStatus(): WebMcpStatus {
  return currentStatus;
}

// ── Descriptor + fingerprint cache ──────────────────────────────────────────
// Lazily built on first reconcile so browsers without `modelContext` (and the
// first-paint path in every browser) never pay for the 26 schema conversions.

interface CachedDescriptor {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: WebMcpAnnotations;
  fingerprint: string;
}

const descriptorCache = new Map<ToolName, CachedDescriptor>();

function getDescriptorMeta(name: ToolName): CachedDescriptor {
  const cached = descriptorCache.get(name);
  if (cached) return cached;
  const meta = buildDescriptorMeta(name);
  const fingerprint = JSON.stringify({
    name: meta.name,
    title: meta.title,
    description: meta.description,
    inputSchema: meta.inputSchema,
    annotations: meta.annotations,
  });
  const built: CachedDescriptor = { ...meta, fingerprint };
  descriptorCache.set(name, built);
  return built;
}

function describeError(err: unknown): string {
  if (err instanceof Error) return err.message || err.name || 'Unknown error';
  return String(err);
}

function errorName(err: unknown): string {
  return err instanceof Error ? err.name : '';
}

// ── The execute wrapper handed to `registerTool` ────────────────────────────
// Order matters (see webmcp brief): validate → dispatch on the door
// chokepoint → translate ok:false into a rejection → shape + JSON-round-trip
// the success payload. WebMCP has no `isError` field; failure is signaled by
// rejecting the promise, never by resolving with an error shape.
async function executeWrapped(name: ToolName, input: unknown): Promise<unknown> {
  const entry = registry.get(name);
  if (entry) entry.inFlight += 1;

  try {
    const parsed = toolDefs[name].inputSchema.safeParse(input);
    if (!parsed.success) {
      const issueSummary = (parsed.error as z.ZodError).issues
        .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
        .join('; ');
      throw new Error(`Invalid input for ${name}: ${issueSummary}`.slice(0, INVALID_INPUT_MESSAGE_MAX_CHARS));
    }

    // Pass the parsed/coerced data, not the raw input, so defaults match the
    // remote MCP door exactly (the backend safeParses before forwarding too).
    const result = await dispatchTool(name, parsed.data, {
      getSelection: resolveSelection,
      door: 'chatgpt',
    });
    // Arm the debounced viewport flush regardless of outcome — the
    // accumulator only collected rects for tools that actually wrote.
    scheduleFocusFlush();

    if (result.ok === false) {
      throw new Error(buildErrorMessage(name, result as Record<string, unknown>));
    }

    // JSON round-trip both enforces serializability (a non-serializable
    // return is otherwise a WebMCP failure with a useless message) and gives
    // shapeSuccess's budget math something real to work against.
    return JSON.parse(JSON.stringify(shapeSuccess(name, result as Record<string, unknown>)));
  } finally {
    if (entry) {
      entry.inFlight = Math.max(0, entry.inFlight - 1);
      // Self-cleanup: a removal that was deferred because this call was
      // in-flight is swept the moment the call finishes, rather than waiting
      // for the next externally-triggered reconcile.
      if (entry.inFlight === 0 && entry.pendingRemoval) {
        entry.controller.abort();
        registry.delete(name);
      }
    }
  }
}

// ── Registration primitive ──────────────────────────────────────────────────

interface RegisterOutcome {
  added: ToolName[];
  replaced: ToolName[];
  failed: Array<{ name: ToolName; error: string }>;
}

async function registerOne(name: ToolName, meta: CachedDescriptor, outcome: RegisterOutcome, isReplace: boolean): Promise<void> {
  const modelContext = getModelContext();
  if (!modelContext) return;

  const controller = new AbortController();
  const descriptor: WebMcpToolDescriptor = {
    name: meta.name,
    title: meta.title,
    description: meta.description,
    inputSchema: meta.inputSchema,
    annotations: meta.annotations,
    // Never pass the registration signal (`controller.signal`) into the
    // work — it exists solely for unregistration. `execute` gets its own
    // per-call signal from the caller, which we intentionally don't need.
    execute: (input) => executeWrapped(name, input),
  };

  try {
    await modelContext.registerTool(descriptor, { signal: controller.signal });
    registry.set(name, {
      controller,
      fingerprint: meta.fingerprint,
      inFlight: 0,
      pendingRemoval: false,
      registeredAt: Date.now(),
    });
    invalidStateRetried.delete(name);
    if (isReplace) outcome.replaced.push(name);
    else outcome.added.push(name);
  } catch (err) {
    controller.abort();
    const failureName = errorName(err);

    if (failureName === 'NotAllowedError') {
      // Permissions-Policy denial is a whole-surface failure, not a
      // per-tool one. Stop trying entirely so we don't retry 26 rejections
      // forever on every future reconcile.
      blocked = true;
      for (const [, entry] of registry) entry.controller.abort();
      registry.clear();
      return;
    }

    if (failureName === 'InvalidStateError') {
      // The browser still holds this name even though our map thinks it's
      // unregistered. Allow exactly one retry (the name stays in "desired
      // minus registered" and comes back through this function next pass);
      // fail for real only if the retry also hits InvalidStateError.
      if (invalidStateRetried.has(name)) {
        invalidStateRetried.delete(name);
        outcome.failed.push({ name, error: describeError(err) });
      } else {
        invalidStateRetried.add(name);
      }
      return;
    }

    outcome.failed.push({ name, error: describeError(err) });
  }
}

// ── One reconcile pass ───────────────────────────────────────────────────────

async function runSingleReconcile(): Promise<ReconcileReport> {
  const modelContext = getModelContext();
  if (!modelContext) {
    for (const [, entry] of registry) entry.controller.abort();
    registry.clear();
    currentStatus = 'unsupported';
    return { added: [], removed: [], replaced: [], failed: [], status: currentStatus };
  }

  if (blocked) {
    currentStatus = 'blocked';
    return { added: [], removed: [], replaced: [], failed: [], status: currentStatus };
  }

  const removed: ToolName[] = [];
  const outcome: RegisterOutcome = { added: [], replaced: [], failed: [] };

  const gating = readGatingState(useStore.getState());
  const desired = registryEnabled ? computeDesiredTools(gating) : new Set<ToolName>();
  const now = Date.now();

  // 1. Removal pass: registered ∖ desired.
  for (const [name, entry] of registry) {
    if (desired.has(name)) continue;
    if (entry.inFlight > 0) {
      entry.pendingRemoval = true;
      continue;
    }
    if (now - entry.registeredAt < HYSTERESIS_MS) {
      continue; // Too soon — re-evaluated next pass.
    }
    entry.controller.abort();
    registry.delete(name);
    removed.push(name);
  }

  // 2. Add / replace pass over the desired set.
  for (const name of desired) {
    if (blocked) break; // A NotAllowedError mid-loop stops further attempts.

    const meta = getDescriptorMeta(name);
    const existing = registry.get(name);

    if (existing && existing.fingerprint === meta.fingerprint) {
      existing.pendingRemoval = false; // Desired again — cancel any pending removal.
      continue;
    }

    if (existing) {
      if (existing.inFlight > 0) continue; // Defer the replace to next pass.
      existing.controller.abort();
      registry.delete(name);
      await registerOne(name, meta, outcome, true);
    } else {
      await registerOne(name, meta, outcome, false);
    }
  }

  currentStatus = blocked ? 'blocked' : registry.size > 0 ? 'active' : 'idle';

  return { added: outcome.added, removed, replaced: outcome.replaced, failed: outcome.failed, status: currentStatus };
}

async function runReconcileLoop(initialReason: string): Promise<void> {
  let reason = initialReason;
  // Coalescing loop: run once, then if another caller recorded a reason
  // while we were running, loop once more so it sees a fresh pass rather
  // than a stale report from before its trigger happened.
  for (;;) {
    void reason; // Reserved for future diagnostics/logging.
    lastReport = await runSingleReconcile();
    if (pendingReason === null) break;
    reason = pendingReason;
    pendingReason = null;
  }
}

/**
 * Reconciles the WebMCP tool registry against current gating state.
 * Concurrent callers coalesce onto a single in-flight run (plus, if a call
 * arrives mid-run, exactly one extra pass) rather than queueing up N
 * sequential runs — two overlapping reconciles racing straight into
 * `registerTool` is the single most likely source of duplicate-name
 * `InvalidStateError`s.
 */
export async function reconcileWebMcpTools(reason: string): Promise<ReconcileReport> {
  if (inflight) {
    pendingReason = reason;
    await inflight;
    return lastReport;
  }
  const run = runReconcileLoop(reason);
  inflight = run.finally(() => {
    inflight = null;
  });
  await inflight;
  return lastReport;
}
