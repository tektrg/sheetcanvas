import { describe, expect, it } from 'vitest';
import type { SheetData } from '../../../types';
import { getCellId } from '../../../utils/formulas';
import { runSheetQuery, sheetTableSchema } from '../alasqlAdapter';

function makeWideSheet(): SheetData {
  const width = 54; // BB
  const cells: SheetData['cells'] = {};
  for (let col = 0; col < width; col += 1) {
    const columnId = getCellId(col, 0).replace(/\d+$/, '');
    cells[`${columnId}1`] = { raw: `Header ${columnId}`, value: `Header ${columnId}` };
  }
  cells.AU1 = { raw: 'Interview Status', value: 'Interview Status' };
  cells.BB1 = { raw: 'Admission Status', value: 'Admission Status' };
  cells.AU2 = { raw: '[1] Đã hẹn phỏng vấn', value: '[1] Đã hẹn phỏng vấn' };
  cells.BB2 = { raw: '[1] Trúng tuyển', value: '[1] Trúng tuyển' };

  return {
    id: 'sheet-wide',
    title: 'Applicants',
    position: { x: 0, y: 0 },
    size: { width, height: 2 },
    cells,
  };
}

describe('sheetTableSchema', () => {
  it('maps wide spreadsheet column letters to SQL names and header cells', () => {
    const schema = sheetTableSchema(makeWideSheet());

    expect(schema).toContainEqual({
      columnLetter: 'AU',
      headerCell: 'AU1',
      header: 'Interview Status',
      sqlName: 'interview_status',
      sampleValue: '[1] Đã hẹn phỏng vấn',
    });
    expect(schema).toContainEqual({
      columnLetter: 'BB',
      headerCell: 'BB1',
      header: 'Admission Status',
      sqlName: 'admission_status',
      sampleValue: '[1] Trúng tuyển',
    });
  });

  it('uses occupied cells beyond the viewport-constrained sheet size', () => {
    const sheet = makeWideSheet();
    sheet.size = { width: 8, height: 2 };

    const schema = sheetTableSchema(sheet);
    const result = runSheetQuery(
      sheet,
      'SELECT interview_status, admission_status FROM t',
    );

    expect(schema.find((column) => column.columnLetter === 'AU')).toMatchObject({
      sqlName: 'interview_status',
    });
    expect(schema.find((column) => column.columnLetter === 'BB')).toMatchObject({
      sqlName: 'admission_status',
    });
    expect(result.rows).toEqual([['[1] Đã hẹn phỏng vấn', '[1] Trúng tuyển']]);
  });
});
