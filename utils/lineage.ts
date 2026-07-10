import { ChartData, SheetData } from '../types';

export type LineageNodeKind = 'sheet' | 'chart';

export interface LineageLink {
  id: string;
  sourceId: string | null;
  targetId: string;
  sourceKind: LineageNodeKind;
  targetKind: LineageNodeKind;
  missingSourceId?: string;
}

interface LineageIndexes {
  parentByNodeId: Map<string, string>;
  kindByNodeId: Map<string, LineageNodeKind>;
  childrenBySourceId: Map<string, LineageLink[]>;
}

const getSheetSourceId = (sheet?: SheetData) =>
  sheet?.pivotConfig?.sourceSheetId || sheet?.sparklineConfig?.sourceSheetId || null;

const getNodeSourceSheetId = (
  nodeId: string,
  sheets: Record<string, SheetData>,
  charts: Record<string, ChartData>
) => {
  if (charts[nodeId]) return charts[nodeId].sourceSheetId;
  return getSheetSourceId(sheets[nodeId]);
};

const getNodeKind = (
  nodeId: string,
  sheets: Record<string, SheetData>,
  charts: Record<string, ChartData>
): LineageNodeKind | null => {
  if (sheets[nodeId]) return 'sheet';
  if (charts[nodeId]) return 'chart';
  return null;
};

const getChildLinks = (
  sourceId: string,
  sheets: Record<string, SheetData>,
  charts: Record<string, ChartData>
) => {
  const childLinks: LineageLink[] = [];

  Object.values(sheets).forEach((sheet) => {
    if (getSheetSourceId(sheet) === sourceId) {
      childLinks.push({
        id: `${sourceId}->${sheet.id}`,
        sourceId,
        targetId: sheet.id,
        sourceKind: 'sheet',
        targetKind: 'sheet',
      });
    }
  });

  Object.values(charts).forEach((chart) => {
    if (chart.sourceSheetId === sourceId) {
      childLinks.push({
        id: `${sourceId}->${chart.id}`,
        sourceId,
        targetId: chart.id,
        sourceKind: 'sheet',
        targetKind: 'chart',
      });
    }
  });

  return childLinks;
};

export const buildLineageIndexes = (
  sheets: Record<string, SheetData>,
  charts: Record<string, ChartData>
): LineageIndexes => {
  const parentByNodeId = new Map<string, string>();
  const kindByNodeId = new Map<string, LineageNodeKind>();
  const childrenBySourceId = new Map<string, LineageLink[]>();

  const addChildLink = (sourceId: string, link: LineageLink) => {
    const links = childrenBySourceId.get(sourceId);
    if (links) {
      links.push(link);
    } else {
      childrenBySourceId.set(sourceId, [link]);
    }
  };

  Object.values(sheets).forEach((sheet) => {
    kindByNodeId.set(sheet.id, 'sheet');
    const sourceId = getSheetSourceId(sheet);
    if (!sourceId) return;

    parentByNodeId.set(sheet.id, sourceId);
    addChildLink(sourceId, {
      id: `${sourceId}->${sheet.id}`,
      sourceId,
      targetId: sheet.id,
      sourceKind: 'sheet',
      targetKind: 'sheet',
    });
  });

  Object.values(charts).forEach((chart) => {
    kindByNodeId.set(chart.id, 'chart');
    parentByNodeId.set(chart.id, chart.sourceSheetId);
    addChildLink(chart.sourceSheetId, {
      id: `${chart.sourceSheetId}->${chart.id}`,
      sourceId: chart.sourceSheetId,
      targetId: chart.id,
      sourceKind: 'sheet',
      targetKind: 'chart',
    });
  });

  return { parentByNodeId, kindByNodeId, childrenBySourceId };
};

export const getLineageAvailableNodeIds = (
  nodeIds: string[],
  indexes: LineageIndexes
) => {
  const availableIds = new Set<string>();

  nodeIds.forEach((id) => {
    if (indexes.parentByNodeId.has(id) || indexes.childrenBySourceId.has(id)) {
      availableIds.add(id);
    }
  });

  return availableIds;
};

export const hasLineageForNode = (
  nodeId: string,
  sheets: Record<string, SheetData>,
  charts: Record<string, ChartData>
) => {
  return Boolean(getNodeSourceSheetId(nodeId, sheets, charts) || getChildLinks(nodeId, sheets, charts).length > 0);
};

export const buildLineageLinks = (
  activeNodeIds: string[],
  sheets: Record<string, SheetData>,
  charts: Record<string, ChartData>,
  indexes = buildLineageIndexes(sheets, charts)
) => {
  const links = new Map<string, LineageLink>();

  const addLink = (link: LineageLink) => {
    links.set(link.id, link);
  };

  const addAncestorLinks = (nodeId: string) => {
    const visited = new Set<string>();
    let currentId: string | null = nodeId;

    while (currentId && !visited.has(currentId)) {
      visited.add(currentId);
      const parentId = indexes.parentByNodeId.get(currentId) ?? null;
      if (!parentId) return;

      const targetKind = indexes.kindByNodeId.get(currentId) ?? getNodeKind(currentId, sheets, charts);
      if (!targetKind) return;

      if (!sheets[parentId]) {
        addLink({
          id: `missing:${parentId}->${currentId}`,
          sourceId: null,
          targetId: currentId,
          sourceKind: 'sheet',
          targetKind,
          missingSourceId: parentId,
        });
        return;
      }

      addLink({
        id: `${parentId}->${currentId}`,
        sourceId: parentId,
        targetId: currentId,
        sourceKind: 'sheet',
        targetKind,
      });
      currentId = parentId;
    }
  };

  const addDescendantLinks = (nodeId: string) => {
    const queue = [nodeId];
    const visited = new Set<string>();

    while (queue.length > 0) {
      const currentId = queue.shift()!;
      if (visited.has(currentId)) continue;
      visited.add(currentId);

      (indexes.childrenBySourceId.get(currentId) ?? []).forEach((link) => {
        addLink(link);
        if (link.targetKind === 'sheet') queue.push(link.targetId);
      });
    }
  };

  activeNodeIds.forEach((nodeId) => {
    addAncestorLinks(nodeId);
    addDescendantLinks(nodeId);
  });

  return Array.from(links.values());
};
