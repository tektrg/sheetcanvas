/** Escape text for an HTML/SVG text node or a double-quoted attribute. */
export const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

/** JSON for inline <script type="application/ld+json">: `<` escaped so `</script>` cannot close it. */
export const jsonForScript = (value: unknown): string =>
  JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');

const numberFormatter = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });

export const formatNumber = (value: number | null): string => (value === null ? '' : numberFormatter.format(value));
export { formatCompact } from '../../../shared/numberFormat';
