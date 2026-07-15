

import { SheetData, CellData, CellFormat, SparklineConfig, PivotOperation, GoodDirection } from '../types';
import { getCellId, parseCellId } from './formulas';
import { getSheetHeaders } from './chartHelpers';
import { CELL_WIDTH, CELL_HEIGHT } from '../constants';
import { getFilteredRows } from './dataAnalysis';
import { applyFormatRulesToCells } from './formatRules';

// S2 direction-of-good inference from a metric's name. Metrics where a decrease
// is the improvement (cost, churn, latency, …) get 'down'; clearly-positive
// metrics get 'up'; everything ambiguous stays 'unknown' → neutral coloring.
const DOWN_IS_GOOD = /\b(cost|spend|cpc|cpa|cpm|churn|bounce|refund|return|latency|load\s*time|response\s*time|error|errors|failure|defect|complaint|cancel|cancellation|abandon|abandonment|wait|downtime|attrition|unsubscribe|drop\s*off|dropoff)\b/i;
const UP_IS_GOOD = /\b(revenue|sales|profit|margin|signups?|sign\s*ups?|registrations?|users?|sessions?|conversions?|retention|orders?|engagement|clicks?|views?|impressions?|growth|active|activation|subscribers?|nps|satisfaction|uptime|throughput)\b/i;

export const inferGoodDirection = (metricName: string): GoodDirection => {
    const name = String(metricName ?? '');
    if (DOWN_IS_GOOD.test(name)) return 'down';
    if (UP_IS_GOOD.test(name)) return 'up';
    return 'unknown';
};

// Build the Change-cell format for a metric per its direction-of-good (S2).
// diverging = negatives red / positives green; heatmapFlip swaps that polarity
// for down-is-good metrics; unknown uses a single neutral hue by rank.
const changeCellFormat = (direction: GoodDirection): CellFormat => {
    if (direction === 'unknown') {
        return { type: 'percent', decimals: 1, visual: 'heatmap', heatmapColor: 'yellow' };
    }
    return {
        type: 'percent',
        decimals: 1,
        visual: 'heatmap',
        heatmapColor: 'diverging',
        heatmapFlip: direction === 'down',
    };
};

// Helper to aggregate values
const aggregate = (values: number[], op: PivotOperation): number => {
    if (values.length === 0) return 0;
    switch (op) {
        case 'SUM': return values.reduce((a, b) => a + b, 0);
        case 'COUNT': return values.length;
        case 'AVG': return values.reduce((a, b) => a + b, 0) / values.length;
        case 'MIN': return Math.min(...values);
        case 'MAX': return Math.max(...values);
        default: return 0;
    }
};

interface SparklineCalculationResult {
    cells: Record<string, CellData>;
    width: number;
    height: number;
}

const parseDate = (val: any): number => {
    if (val instanceof Date) return val.getTime();
    if (typeof val === 'number') return val;
    const d = Date.parse(String(val));
    return isNaN(d) ? 0 : d;
};

const formatDateLabel = (ts: number): string => {
    if (ts === 0) return '';
    return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: '2-digit' });
};

export const computeSparklineCells = (sourceSheet: SheetData, config: SparklineConfig): SparklineCalculationResult => {
    const headers = getSheetHeaders(sourceSheet);
    const visibleRows = getFilteredRows(sourceSheet);
    
    const rowIndices = visibleRows ? visibleRows.filter(r => r > 0) : (() => {
        const rows = new Set<number>();
        Object.keys(sourceSheet.cells).forEach(k => {
            const pos = parseCellId(k);
            if (pos && pos.row > 0) rows.add(pos.row);
        });
        return Array.from(rows);
    })();

    // 1. Extract Data
    // We need { date: number, [key: string]: number }
    const dateColIdx = headers.find(h => h.id === config.dateCol)?.index;
    if (dateColIdx === undefined) return { cells: {}, width: 1, height: 1 };

    const extractedRows: { date: number, rowIdx: number }[] = [];

    rowIndices.forEach(r => {
        const dateCell = sourceSheet.cells[getCellId(dateColIdx, r)];
        const dateVal = parseDate(dateCell?.value);
        if (dateVal !== 0) {
            extractedRows.push({ date: dateVal, rowIdx: r });
        }
    });

    // Sort by date ascending
    extractedRows.sort((a, b) => a.date - b.date);

    // Prepare Result Rows: Label, Current, Sparkline (JSON), Change
    interface ResultRow {
        label: string;
        current: number;
        history: { value: number; label: string }[];
        change: number;
    }
    const results: ResultRow[] = [];
    const compareMode = config.compareMode || 'vs_avg';

    if (config.mode === 'metrics' && config.dataCols) {
        config.dataCols.forEach(colId => {
            const colIdx = headers.find(h => h.id === colId)?.index;
            if (colIdx === undefined) return;
            
            const history: { value: number; label: string }[] = [];
            extractedRows.forEach(item => {
                const cell = sourceSheet.cells[getCellId(colIdx, item.rowIdx)];
                let val = Number(cell?.value);
                if (isNaN(val)) {
                    const clean = String(cell?.value || '').replace(/[^0-9.-]/g, '');
                    val = Number(clean);
                }
                if (!isNaN(val)) history.push({ value: val, label: formatDateLabel(item.date) });
            });

            if (history.length > 0) {
                const current = history[history.length - 1].value;
                let baseline = 0;
                
                if (compareMode === 'vs_prev') {
                    baseline = history.length > 1 ? history[history.length - 2].value : current;
                } else if (compareMode === 'vs_first') {
                    baseline = history[0].value;
                } else {
                    // vs_avg (default)
                    baseline = history.reduce((acc, h) => acc + h.value, 0) / history.length;
                }

                const change = baseline !== 0 ? (current - baseline) / Math.abs(baseline) : 0;
                
                results.push({
                    label: headers.find(h => h.id === colId)?.label || colId,
                    current,
                    history,
                    change
                });
            }
        });
    } else if (config.mode === 'group' && config.groupCol && config.valueCol) {
        const groupColIdx = headers.find(h => h.id === config.groupCol)?.index;
        const valColIdx = headers.find(h => h.id === config.valueCol)?.index;

        if (groupColIdx !== undefined && valColIdx !== undefined) {
            // Group data
            const groups = new Map<string, { date: number, val: number }[]>();
            
            extractedRows.forEach(item => {
                const groupCell = sourceSheet.cells[getCellId(groupColIdx, item.rowIdx)];
                const valCell = sourceSheet.cells[getCellId(valColIdx, item.rowIdx)];
                
                const groupKey = String(groupCell?.value ?? '(Blank)');
                let val = Number(valCell?.value);
                if (isNaN(val)) {
                     const clean = String(valCell?.value || '').replace(/[^0-9.-]/g, '');
                     val = Number(clean);
                }
                if (isNaN(val)) val = 0;

                if (!groups.has(groupKey)) groups.set(groupKey, []);
                groups.get(groupKey)!.push({ date: item.date, val });
            });

            // Aggregate per group
            Array.from(groups.keys()).sort().forEach(key => {
                const data = groups.get(key)!;
                // data is already sorted by date because we iterated extractedRows which was sorted
                
                const history = data.map(d => ({
                    value: d.val,
                    label: formatDateLabel(d.date)
                }));

                if (history.length > 0) {
                    const current = history[history.length - 1].value;
                    let baseline = 0;
                    
                    if (compareMode === 'vs_prev') {
                        baseline = history.length > 1 ? history[history.length - 2].value : current;
                    } else if (compareMode === 'vs_first') {
                        baseline = history[0].value;
                    } else {
                        // vs_avg
                        baseline = history.reduce((acc, h) => acc + h.value, 0) / history.length;
                    }

                    const change = baseline !== 0 ? (current - baseline) / Math.abs(baseline) : 0;
                    
                    results.push({
                        label: key,
                        current,
                        history,
                        change
                    });
                }
            });
        }
    }

    // Build Cells
    const newCells: Record<string, CellData> = {};

    // Fixed columns: Metric, Current, Trend, Change. Then optional summary columns.
    let changeLabel = 'Change';
    switch (compareMode) {
        case 'vs_avg': changeLabel = 'Change vs Avg'; break;
        case 'vs_prev': changeLabel = 'Change vs Last'; break;
        case 'vs_first': changeLabel = 'Change vs Start'; break;
    }

    const summaryColumns = config.summaryColumns ?? [];
    // Header labels in column order; extra summary headers appended after Change.
    const headerLabels = ['Metric', 'Current', 'Trend', changeLabel];
    for (const col of summaryColumns) {
        if (col === 'avg') headerLabels.push('Avg');
        else if (col === 'minmax') { headerLabels.push('Min'); headerLabels.push('Max'); }
        else if (col === 'share') headerLabels.push('Share');
    }
    headerLabels.forEach((label, c) => {
        newCells[getCellId(c, 0)] = { raw: label, value: label };
    });

    // Share-of-total uses the sum of current values across rows (S1 in-cell bar).
    const currentTotal = results.reduce((acc, res) => acc + (Number.isFinite(res.current) ? res.current : 0), 0);

    results.forEach((res, idx) => {
        const r = idx + 1;
        const direction: GoodDirection =
            config.goodDirections?.[res.label] ?? inferGoodDirection(res.label);
        const values = res.history.map(h => h.value);
        const avg = values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
        const min = values.length ? Math.min(...values) : 0;
        const max = values.length ? Math.max(...values) : 0;

        newCells[getCellId(0, r)] = { raw: res.label, value: res.label };
        newCells[getCellId(1, r)] = { raw: String(res.current), value: res.current, format: { type: 'number', decimals: 2 } };
        // Trend: Store history array as JSON string
        newCells[getCellId(2, r)] = { raw: JSON.stringify(res.history), value: JSON.stringify(res.history), format: { type: 'text', visual: 'sparkline' } };
        // Change: heatmap colored by direction of good (S2).
        newCells[getCellId(3, r)] = { raw: String(res.change), value: res.change, format: changeCellFormat(direction) };

        let c = 4;
        for (const col of summaryColumns) {
            if (col === 'avg') {
                newCells[getCellId(c, r)] = { raw: String(avg), value: avg, format: { type: 'number', decimals: 2 } };
                c += 1;
            } else if (col === 'minmax') {
                newCells[getCellId(c, r)] = { raw: String(min), value: min, format: { type: 'number', decimals: 2 } };
                newCells[getCellId(c + 1, r)] = { raw: String(max), value: max, format: { type: 'number', decimals: 2 } };
                c += 2;
            } else if (col === 'share') {
                const share = currentTotal !== 0 ? res.current / currentTotal : 0;
                newCells[getCellId(c, r)] = { raw: String(share), value: share, format: { type: 'percent', decimals: 1, visual: 'bar' } };
                c += 1;
            }
        }
    });

    return {
        cells: newCells,
        width: headerLabels.length,
        height: results.length + 1
    };
};

export const generateSparklineTable = (sourceSheet: SheetData, config: SparklineConfig): SheetData => {
    const { cells, width, height } = computeSparklineCells(sourceSheet, config);

    return {
        id: Math.random().toString(36).substr(2, 9),
        title: `Sparklines: ${sourceSheet.title}`,
        position: { 
            x: sourceSheet.position.x + (sourceSheet.size.width * CELL_WIDTH) + 60, 
            y: sourceSheet.position.y + 100
        },
        size: { width, height },
        cells,
        sparklineConfig: config,
        colWidths: { '2': 160 } // Make Trend column wider by default
    };
};

export const refreshSparklineTable = (sparkSheet: SheetData, sourceSheet: SheetData): SheetData => {
    if (!sparkSheet.sparklineConfig) return sparkSheet;

    const { cells: newCells, width, height } = computeSparklineCells(sourceSheet, sparkSheet.sparklineConfig);
    
    const mergedCells: Record<string, CellData> = {};
    Object.keys(newCells).forEach(key => {
        const newCell = newCells[key];
        const oldCell = sparkSheet.cells[key];
        
        // Preserve formatting if it wasn't the default generated one (basic heuristic)
        if (oldCell && oldCell.format && oldCell.format.visual !== 'sparkline') {
             mergedCells[key] = { ...newCell, format: oldCell.format };
        } else {
             mergedCells[key] = newCell;
        }
    });

    const formattedCells = applyFormatRulesToCells(mergedCells, sparkSheet.formatRules);

    return {
        ...sparkSheet,
        size: { width, height },
        cells: formattedCells
    };
};
