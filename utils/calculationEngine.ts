
import { SheetData, CellData } from '../types';
import { evaluateFormula, extractCellReferences } from './formulas';

// Graph State: SheetID -> { reverse: DepMap, forward: DepMap }
const sheetGraphs: Record<string, {
    reverse: Record<string, Set<string>>;
    forward: Record<string, Set<string>>;
}> = {};

const getVal = (sheet: SheetData, cellId: string, cache: Record<string, any>, visiting: Set<string>): any => {
    // Cycle detection
    if (visiting.has(cellId)) return "#CYCLE!";
    if (cache[cellId] !== undefined) return cache[cellId];

    visiting.add(cellId);

    const cell = sheet.cells[cellId];
    const raw = cell?.raw;
    let val: any;

    if (raw === undefined || raw === null || String(raw) === '') {
        val = null;
    } else if (!String(raw).startsWith('=')) {
        // Static value parsing
        const trimmed = String(raw).trim();
        if (trimmed.endsWith('%')) {
            const numPart = parseFloat(trimmed.slice(0, -1));
            val = !isNaN(numPart) ? numPart / 100 : raw;
        } else {
            const num = Number(raw);
            val = isNaN(num) ? raw : num;
        }
    } else {
        // Recursive evaluation
        val = evaluateFormula(raw, (refId) => getVal(sheet, refId, cache, visiting));
    }

    visiting.delete(cellId);
    cache[cellId] = val;
    return val;
};

const updateGraph = (sheetId: string, cellId: string, raw: string) => {
    if (!sheetGraphs[sheetId]) {
        sheetGraphs[sheetId] = { reverse: {}, forward: {} };
    }
    const { reverse, forward } = sheetGraphs[sheetId];

    // 1. Clean up old dependencies
    const oldDeps = forward[cellId];
    if (oldDeps) {
        oldDeps.forEach(dep => {
            if (reverse[dep]) reverse[dep].delete(cellId);
        });
        delete forward[cellId];
    }

    // 2. Parse new dependencies
    if (String(raw).startsWith('=')) {
        const newDeps = extractCellReferences(raw);
        if (newDeps.length > 0) {
            forward[cellId] = new Set(newDeps);
            newDeps.forEach(dep => {
                if (!reverse[dep]) reverse[dep] = new Set();
                reverse[dep].add(cellId);
            });
        }
    }
};

const computeAffected = (sheet: SheetData, changedIds: string[]): Record<string, CellData> => {
    const { reverse } = sheetGraphs[sheet.id] || { reverse: {}, forward: {} };
    const toCompute = new Set<string>();
    const queue = [...changedIds];
    
    // Breadth-First Search to find all dependents
    while (queue.length > 0) {
        const current = queue.shift()!;
        if (!toCompute.has(current)) {
            toCompute.add(current);
            const dependents = reverse[current];
            if (dependents) dependents.forEach(dep => queue.push(dep));
        }
    }

    const updates: Record<string, CellData> = {};
    const cache: Record<string, any> = {};
    
    toCompute.forEach(cellId => {
        if (!sheet.cells[cellId]) return;
        
        const newVal = getVal(sheet, cellId, cache, new Set());
        // Return new cell object with computed value
        updates[cellId] = { ...sheet.cells[cellId], value: newVal };
    });

    return updates;
};

export const initSheetCalculation = (sheet: SheetData): Record<string, CellData> => {
    sheetGraphs[sheet.id] = { reverse: {}, forward: {} };
    Object.keys(sheet.cells).forEach(cellId => {
        updateGraph(sheet.id, cellId, sheet.cells[cellId].raw);
    });
    return computeAffected(sheet, Object.keys(sheet.cells));
};

export const updateSheetCalculation = (sheet: SheetData, changedCells: Record<string, CellData>): Record<string, CellData> => {
    // Update graph for changed cells
    Object.keys(changedCells).forEach(cellId => {
        updateGraph(sheet.id, cellId, changedCells[cellId].raw);
    });
    // Pass the full sheet (which should already contain the raw updates) to computeAffected
    return computeAffected(sheet, Object.keys(changedCells));
};

export const deleteSheetCalculation = (sheetId: string) => {
    delete sheetGraphs[sheetId];
};
