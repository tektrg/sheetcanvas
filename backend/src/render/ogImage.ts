import { initWasm, Resvg } from '@resvg/resvg-wasm';
// Wrangler bundles .wasm imports as a compiled WebAssembly.Module.
import resvgWasm from '@resvg/resvg-wasm/index_bg.wasm';
import type { PublishedChart } from '../../../shared/publishSnapshot';
import { renderChartSvg } from './chartSvg';
import { escapeHtml } from './escape';

// 1200x630 social card: page title band + the first chart. Loaded lazily by the
// /og route only, so the wasm never touches tests or the other routes.
// No fonts are bundled, so resvg draws shapes only; the title band is a color bar.

let wasmReady: Promise<void> | null = null;
const ensureWasm = () => (wasmReady ??= initWasm(resvgWasm));

const OG_WIDTH = 1200;
const OG_HEIGHT = 630;

const ogSvg = (chart: PublishedChart, title: string): string => {
  const chartSvg = renderChartSvg(chart).replace('<svg ', '<svg x="60" y="90" width="1080" height="510" ');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${OG_WIDTH}" height="${OG_HEIGHT}" viewBox="0 0 ${OG_WIDTH} ${OG_HEIGHT}"><title>${escapeHtml(title)}</title><rect width="100%" height="100%" fill="#ffffff"/><rect width="100%" height="12" fill="#4f46e5"/>${chartSvg}</svg>`;
};

export const renderOgPng = async (chart: PublishedChart, title: string): Promise<Uint8Array> => {
  await ensureWasm();
  const resvg = new Resvg(ogSvg(chart, title), { fitTo: { mode: 'width', value: OG_WIDTH }, font: { loadSystemFonts: false } });
  return resvg.render().asPng();
};
