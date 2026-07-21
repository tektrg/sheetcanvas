import { SheetData, ChartData } from '../types';
import { refreshPivotTable } from './pivotHelpers';
import { refreshSparklineTable } from './sparklineHelpers';
import {
  buildColumnRebind,
  rebindPivotConfig,
  rebindSparklineConfig,
  rebindChartConfig,
} from './columnRebind';

// When an origin sheet's data changes, every chart/table derived from it — and
// everything derived from THOSE, transitively — must reflect the new data. Each
// derived sheet has exactly one source (single parent), so the dependency graph
// is a forest; a breadth-first walk from the changed sheet yields a valid
// recompute order (parent always before child). This module owns that walk plus
// the per-edge column rebinding, and is pure so it can run headless (e.g. from a
// future scheduled refresh) and be unit-tested without the store.

export const getSourceSheetId = (sheet: SheetData): string | undefined =>
  sheet.pivotConfig?.sourceSheetId ?? sheet.sparklineConfig?.sourceSheetId;

// Derived sheet ids that (transitively) depend on rootId, in recompute order.
// Sheets still awaiting setup are excluded (their config isn't materializable).
// A `visited` set guards against accidental source cycles (A→B→A).
export const collectDependentSheetIdsTopo = (
  rootId: string,
  sheets: Record<string, SheetData>,
): string[] => {
  const childrenBySource = new Map<string, string[]>();
  for (const id of Object.keys(sheets)) {
    const sheet = sheets[id];
    if (sheet.setupRequired) continue;
    const sourceId = getSourceSheetId(sheet);
    if (!sourceId) continue;
    if (!childrenBySource.has(sourceId)) childrenBySource.set(sourceId, []);
    childrenBySource.get(sourceId)!.push(id);
  }

  const ordered: string[] = [];
  const visited = new Set<string>([rootId]);
  let frontier = childrenBySource.get(rootId) ?? [];
  while (frontier.length > 0) {
    const nextFrontier: string[] = [];
    for (const id of frontier) {
      if (visited.has(id)) continue; // cycle / diamond guard
      visited.add(id);
      ordered.push(id);
      nextFrontier.push(...(childrenBySource.get(id) ?? []));
    }
    frontier = nextFrontier;
  }
  return ordered;
};

export const collectDependentChartIds = (
  affectedSheetIds: Set<string>,
  charts: Record<string, ChartData>,
): string[] =>
  Object.keys(charts).filter(id => affectedSheetIds.has(charts[id].sourceSheetId));

// Recompute one derived sheet against its parent's before/after states, rebinding
// column references if the parent's shape changed. On a structural break (a
// dimension column disappeared) the last-good cells are kept and only warnings
// are attached — better a frozen-but-labeled table than a garbage recompute.
const refreshDerivedSheet = (
  derived: SheetData,
  parentBefore: SheetData,
  parentAfter: SheetData,
): SheetData => {
  const rebind = buildColumnRebind(parentBefore, parentAfter);

  if (derived.pivotConfig) {
    let config = derived.pivotConfig;
    let warnings: string[] = [];
    let structuralBroken = false;
    if (rebind.shapeChanged) {
      const result = rebindPivotConfig(config, rebind);
      config = result.config;
      warnings = result.warnings;
      structuralBroken = result.structuralBroken;
    }
    if (structuralBroken) {
      return { ...derived, pivotConfig: config, refreshWarnings: warnings };
    }
    const refreshed = refreshPivotTable({ ...derived, pivotConfig: config }, parentAfter);
    return { ...refreshed, refreshWarnings: warnings.length > 0 ? warnings : undefined };
  }

  if (derived.sparklineConfig) {
    let config = derived.sparklineConfig;
    let warnings: string[] = [];
    let structuralBroken = false;
    if (rebind.shapeChanged) {
      const result = rebindSparklineConfig(config, rebind);
      config = result.config;
      warnings = result.warnings;
      structuralBroken = result.structuralBroken;
    }
    if (structuralBroken) {
      return { ...derived, sparklineConfig: config, refreshWarnings: warnings };
    }
    const refreshed = refreshSparklineTable({ ...derived, sparklineConfig: config }, parentAfter);
    return { ...refreshed, refreshWarnings: warnings.length > 0 ? warnings : undefined };
  }

  return derived;
};

export interface PropagateRefreshInput {
  // State BEFORE the root update is applied (used to diff each parent's shape).
  sheets: Record<string, SheetData>;
  charts: Record<string, ChartData>;
  rootId: string;
  // The root sheet AFTER its own update (and any self-refresh) is applied.
  rootSheet: SheetData;
}

export interface PropagateRefreshResult {
  sheets: Record<string, SheetData>;
  charts: Record<string, ChartData>;
  changedSheetIds: string[];
  changedChartIds: string[];
}

// Compute the full downstream refresh atomically: returns new sheets/charts maps
// with every dependent recomputed, so the caller can commit them in a single
// update (the canvas never shows a half-updated chain).
export const propagateDerivedRefresh = ({
  sheets,
  charts,
  rootId,
  rootSheet,
}: PropagateRefreshInput): PropagateRefreshResult => {
  const workingSheets: Record<string, SheetData> = { ...sheets, [rootId]: rootSheet };
  const order = collectDependentSheetIdsTopo(rootId, workingSheets);
  const changedSheetIds: string[] = [];

  for (const id of order) {
    const derived = workingSheets[id];
    const parentId = getSourceSheetId(derived);
    if (!parentId) continue;
    const parentBefore = sheets[parentId];
    const parentAfter = workingSheets[parentId];
    if (!parentBefore || !parentAfter) continue;
    workingSheets[id] = refreshDerivedSheet(derived, parentBefore, parentAfter);
    changedSheetIds.push(id);
  }

  const affectedSheetIds = new Set<string>([rootId, ...changedSheetIds]);
  const workingCharts: Record<string, ChartData> = { ...charts };
  const changedChartIds: string[] = [];

  for (const chartId of collectDependentChartIds(affectedSheetIds, charts)) {
    const chart = charts[chartId];
    const parentBefore = sheets[chart.sourceSheetId];
    const parentAfter = workingSheets[chart.sourceSheetId];
    if (!parentBefore || !parentAfter) continue;
    const rebind = buildColumnRebind(parentBefore, parentAfter);
    // Charts read their source live at render time, so only a shape change needs
    // a config rewrite; pure value changes require no chart update.
    if (!rebind.shapeChanged) continue;
    const { config, warnings, structuralBroken } = rebindChartConfig(chart.config, rebind);
    // A chart renders live from its source, so unlike a table it can't "freeze"
    // last-good data on a structural break (its label/value/group axis column
    // vanished). Leaving the stale column letter would silently plot a different
    // column's data under the old config — the wrong-number failure this feature
    // prevents. Clear the data-bearing fields so it renders empty + flagged, and
    // the user reconfigures deliberately.
    const safeConfig = structuralBroken
      ? { ...config, dataColumns: [], valueCol: undefined }
      : config;
    workingCharts[chartId] = {
      ...chart,
      config: safeConfig,
      refreshWarnings: warnings.length > 0 ? warnings : undefined,
    };
    changedChartIds.push(chartId);
  }

  return {
    sheets: workingSheets,
    charts: workingCharts,
    changedSheetIds,
    changedChartIds,
  };
};
