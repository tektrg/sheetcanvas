import { SheetData, CellData } from '../types';
import { parseCellId, getCellId } from './formulas';

export const extractChartData = (sheet: SheetData, labelCol: string, dataCols: string[]) => {
  if (!sheet) return [];

  const labelColIndex = parseCellId(`${labelCol}1`)?.col ?? 0;
  const dataColIndices = dataCols.map(c => parseCellId(`${c}1`)?.col ?? 1);

  // Find max row
  let maxRow = -1;
  Object.keys(sheet.cells).forEach(key => {
    const pos = parseCellId(key);
    if (pos) maxRow = Math.max(maxRow, pos.row);
  });

  const chartData = [];

  // We iterate rows. We assume the first row might be headers if they are strings in data cols?
  // For simplicity, let's just iterate all rows that have data.
  
  for (let r = 0; r <= maxRow; r++) {
    const labelId = getCellId(labelColIndex, r);
    const labelCell = sheet.cells[labelId];
    
    // Skip if label is empty
    if (!labelCell?.value) continue;

    const dataPoint: any = {
      name: labelCell.value.toString(),
    };

    dataColIndices.forEach((colIdx, i) => {
        const cellId = getCellId(colIdx, r);
        const cell = sheet.cells[cellId];
        // Try to parse as number
        let val = Number(cell?.value);
        if (isNaN(val)) val = 0;
        dataPoint[`value_${i}`] = val;
    });

    chartData.push(dataPoint);
  }

  return chartData;
};