import type { PublishedChart } from '../../../shared/publishSnapshot';
import { escapeHtml, formatNumber } from './escape';

// The crawlable/accessible twin of each chart: an HTML table of the frozen rows,
// capped so a big dataset never bloats the public page.

export const MAX_TABLE_ROWS = 100;

/** HTML table for a chart's data, or '' when the author hid the data. */
export const renderDataTable = (chart: PublishedChart): string => {
  if (chart.hideData) return '';
  const shown = chart.rows.slice(0, MAX_TABLE_ROWS);
  const header = ['Label', ...chart.series.map(s => s.label)].map(h => `<th scope="col">${escapeHtml(h)}</th>`).join('');
  const body = shown
    .map(row => {
      const cells = chart.series.map((_, i) => `<td>${escapeHtml(formatNumber(row.values[i] ?? null))}</td>`).join('');
      return `<tr><th scope="row">${escapeHtml(row.label)}</th>${cells}</tr>`;
    })
    .join('');
  const note =
    chart.rows.length > MAX_TABLE_ROWS
      ? `<p class="table-note">Showing ${MAX_TABLE_ROWS} of ${chart.rows.length} rows</p>`
      : '';
  return `<details class="data-table"><summary>Data</summary><div class="table-scroll"><table><thead><tr>${header}</tr></thead><tbody>${body}</tbody></table></div>${note}</details>`;
};
