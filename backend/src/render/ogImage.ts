import { initWasm, Resvg } from '@resvg/resvg-wasm';
// Wrangler bundles .wasm imports as a compiled WebAssembly.Module.
import resvgWasm from '@resvg/resvg-wasm/index_bg.wasm';
// Inter SemiBold, Latin subset (37 KB, SIL OFL 1.1). Wrangler bundles .bin as an ArrayBuffer.
import interFont from './fonts/inter-600-latin.bin';
import type { PublishedChart } from '../../../shared/publishSnapshot';
import { CHART_HEIGHT, CHART_WIDTH, renderChartSvg } from './chartSvg';
import { escapeHtml } from './escape';

// 1200x630 social card: page title band + the first chart. Loaded lazily by the
// /og route only, so the wasm never touches tests or the other routes.
// One bundled font (Inter) renders the title and chart labels; system fonts are off in Workers.

let wasmReady: Promise<void> | null = null;
const ensureWasm = () => (wasmReady ??= initWasm(resvgWasm));

const OG_WIDTH = 1200;
const OG_HEIGHT = 630;

const FONT_FAMILY = 'Inter';
const TITLE_MAX_CHARS = 60;

const clampTitle = (title: string): string =>
  title.length > TITLE_MAX_CHARS ? `${title.slice(0, TITLE_MAX_CHARS - 1).trimEnd()}…` : title;

const ogSvg = (chart: PublishedChart, title: string): string => {
  const chartSvg = renderChartSvg(chart).replace(/^<svg [^>]*>/, `<svg x="60" y="120" width="1080" height="470" viewBox="0 0 ${CHART_WIDTH} ${CHART_HEIGHT}">`);
  const safeTitle = escapeHtml(clampTitle(title));
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${OG_WIDTH}" height="${OG_HEIGHT}" viewBox="0 0 ${OG_WIDTH} ${OG_HEIGHT}" font-family="${FONT_FAMILY}"><title>${safeTitle}</title><rect width="100%" height="100%" fill="#ffffff"/><rect width="100%" height="12" fill="#4f46e5"/><text x="60" y="88" font-size="44" fill="#111827">${safeTitle}</text><text x="1140" y="610" font-size="18" fill="#6b7280" text-anchor="end">sheetcanvas</text>${chartSvg}</svg>`;
};

export const renderOgPng = async (chart: PublishedChart, title: string): Promise<Uint8Array> => {
  await ensureWasm();
  const resvg = new Resvg(ogSvg(chart, title), { fitTo: { mode: 'width', value: OG_WIDTH }, font: { loadSystemFonts: false, fontBuffers: [new Uint8Array(interFont)], defaultFontFamily: FONT_FAMILY, sansSerifFamily: FONT_FAMILY } });
  return resvg.render().asPng();
};
