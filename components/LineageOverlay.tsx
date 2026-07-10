import React, { useMemo } from 'react';
import { CELL_HEIGHT, CELL_WIDTH, HEADER_COL_WIDTH, HEADER_ROW_HEIGHT } from '../constants';
import { ChartData, SheetData } from '../types';
import { LineageLink, LineageNodeKind } from '../utils/lineage';

interface LineageOverlayProps {
  links: LineageLink[];
  sheets: Record<string, SheetData>;
  charts: Record<string, ChartData>;
  darkMode: boolean;
}

interface NodeRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
  centerX: number;
  centerY: number;
}

const BROKEN_STUB_WIDTH = 120;
const OVERLAY_PADDING = 80;

const getSheetWidth = (sheet: SheetData) => {
  let tableWidth = 0;
  for (let index = 0; index < sheet.size.width; index += 1) {
    tableWidth += sheet.colWidths?.[String(index)] ?? CELL_WIDTH;
  }
  return tableWidth + HEADER_COL_WIDTH;
};

const getNodeRect = (
  id: string,
  kind: LineageNodeKind,
  sheets: Record<string, SheetData>,
  charts: Record<string, ChartData>
): NodeRect | null => {
  const sheet = kind === 'sheet' ? sheets[id] : undefined;
  const chart = kind === 'chart' ? charts[id] : undefined;
  const node = sheet ?? chart;
  if (!node) return null;

  const width = sheet ? getSheetWidth(sheet) : node.size.width;
  const height = sheet
    ? sheet.size.height * CELL_HEIGHT + HEADER_ROW_HEIGHT
    : node.size.height;

  return {
    left: node.position.x,
    top: node.position.y,
    right: node.position.x + width,
    bottom: node.position.y + height,
    centerX: node.position.x + width / 2,
    centerY: node.position.y + height / 2,
  };
};

const getAnchorPath = (sourceRect: NodeRect, targetRect: NodeRect) => {
  const sourceIsLeft = sourceRect.centerX <= targetRect.centerX;
  const horizontalGap = sourceIsLeft
    ? targetRect.left - sourceRect.right
    : sourceRect.left - targetRect.right;
  const overlapsHorizontally = sourceRect.left <= targetRect.right && targetRect.left <= sourceRect.right;

  if (overlapsHorizontally || horizontalGap < 48) {
    const startX = sourceRect.centerX;
    const endX = targetRect.centerX;
    const startY = sourceRect.top;
    const endY = targetRect.top;
    const routeY = Math.min(sourceRect.top, targetRect.top) - 48;

    return {
      path: `M ${startX} ${startY} C ${startX} ${routeY}, ${endX} ${routeY}, ${endX} ${endY}`,
      points: [
        { x: startX, y: startY },
        { x: startX, y: routeY },
        { x: endX, y: routeY },
        { x: endX, y: endY },
      ],
    };
  }

  const startX = sourceIsLeft ? sourceRect.right : sourceRect.left;
  const endX = sourceIsLeft ? targetRect.left : targetRect.right;
  const startY = sourceRect.centerY;
  const endY = targetRect.centerY;
  const controlOffset = Math.max(80, Math.abs(endX - startX) * 0.35);
  const firstControlX = startX + (sourceIsLeft ? controlOffset : -controlOffset);
  const secondControlX = endX - (sourceIsLeft ? controlOffset : -controlOffset);

  return {
    path: `M ${startX} ${startY} C ${firstControlX} ${startY}, ${secondControlX} ${endY}, ${endX} ${endY}`,
    points: [
      { x: startX, y: startY },
      { x: endX, y: endY },
    ],
  };
};

const LineageOverlayComponent: React.FC<LineageOverlayProps> = ({ links, sheets, charts, darkMode }) => {
  const renderedLinks = useMemo(() => {
    return links.flatMap((link) => {
      const targetRect = getNodeRect(link.targetId, link.targetKind, sheets, charts);
      if (!targetRect) return [];

      if (!link.sourceId) {
        const startX = targetRect.left - BROKEN_STUB_WIDTH;
        const endX = targetRect.left;
        const y = targetRect.centerY;
        return [{
          ...link,
          path: `M ${startX} ${y} C ${startX + 44} ${y}, ${endX - 44} ${y}, ${endX} ${y}`,
          markerX: startX,
          markerY: y,
          points: [
            { x: startX, y },
            { x: endX, y },
          ],
        }];
      }

      const sourceRect = getNodeRect(link.sourceId, link.sourceKind, sheets, charts);
      if (!sourceRect) return [];

      const { path, points } = getAnchorPath(sourceRect, targetRect);
      return [{ ...link, path, points }];
    });
  }, [charts, links, sheets]);

  if (renderedLinks.length === 0) return null;

  const allPoints = renderedLinks.flatMap((link) => link.points);
  const minX = Math.min(...allPoints.map((point) => point.x)) - OVERLAY_PADDING;
  const minY = Math.min(...allPoints.map((point) => point.y)) - OVERLAY_PADDING;
  const maxX = Math.max(...allPoints.map((point) => point.x)) + OVERLAY_PADDING;
  const maxY = Math.max(...allPoints.map((point) => point.y)) + OVERLAY_PADDING;
  const normalStroke = darkMode ? '#2dd4bf' : '#0f766e';
  const brokenStroke = darkMode ? '#fb7185' : '#e11d48';

  return (
    <svg
      data-lineage-overlay="true"
      className="absolute pointer-events-none z-30 overflow-visible"
      style={{ left: minX, top: minY, width: maxX - minX, height: maxY - minY }}
      viewBox={`${minX} ${minY} ${maxX - minX} ${maxY - minY}`}
      aria-hidden="true"
    >
      {renderedLinks.map((link) => {
        const isBroken = !link.sourceId;
        const stroke = isBroken ? brokenStroke : normalStroke;
        return (
          <g key={link.id}>
            <path
              d={link.path}
              fill="none"
              stroke={stroke}
              strokeWidth={2}
              strokeDasharray={isBroken ? '2 7' : '3 7'}
              strokeLinecap="round"
              opacity={isBroken ? 0.9 : 0.78}
            />
            {isBroken && link.markerX !== undefined && link.markerY !== undefined && (
              <g transform={`translate(${link.markerX}, ${link.markerY})`}>
                <circle r={8} fill={darkMode ? '#45111f' : '#fff1f2'} stroke={brokenStroke} strokeWidth={1.5} />
                <path d="M -3 -3 L 3 3 M 3 -3 L -3 3" stroke={brokenStroke} strokeWidth={1.5} strokeLinecap="round" />
              </g>
            )}
          </g>
        );
      })}
    </svg>
  );
};

export const LineageOverlay = React.memo(LineageOverlayComponent);
