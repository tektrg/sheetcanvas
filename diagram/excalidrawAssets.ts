// Excalidraw's self-hosted fonts, shared by the editor (components/DiagramEditor.tsx)
// and the canvas preview (renderSvg.tsx) so both draw text in the same font.
// Dev serves them straight from node_modules; the build copies them to
// /excalidraw-assets/ (see vite.config.ts).
export const EXCALIDRAW_ASSET_PATH = (import.meta as { env?: { DEV?: boolean } }).env?.DEV
  ? '/node_modules/@excalidraw/excalidraw/dist/prod/'
  : '/excalidraw-assets/';

const FONTS = 'fonts/';
/** Latin shard of Excalifont (the editor's default, fontFamily 5) and Virgil (fontFamily 1). */
const EXCALIFONT_LATIN = 'Excalifont/Excalifont-Regular-a88b72a24fb54c9f94e3b5fdaa7481c9.woff2';
const VIRGIL = 'Virgil/Virgil-Regular.woff2';

/** CSS font stacks keyed by Excalidraw fontFamily id (FONT_FAMILY in @excalidraw/excalidraw). */
const FONT_STACKS: Record<number, string> = {
  1: 'Virgil, Excalifont',
  2: 'Helvetica, Arial, sans-serif',
  3: 'Cascadia, "Cascadia Code", monospace',
  5: 'Excalifont, Virgil',
  6: 'Nunito, sans-serif',
  8: '"Comic Shanns", "Comic Sans MS", cursive',
};
const FALLBACK = '"Segoe Print", "Comic Sans MS", system-ui, sans-serif';

export const fontStack = (fontFamily?: number) => `${FONT_STACKS[fontFamily ?? 5] ?? FONT_STACKS[5]}, ${FALLBACK}`;

/** @font-face rules for the hand-drawn fonts, embeddable in an inline <svg><style>. */
export const HAND_DRAWN_FONT_FACES = [
  `@font-face{font-family:Excalifont;src:url(${EXCALIDRAW_ASSET_PATH}${FONTS}${EXCALIFONT_LATIN}) format("woff2");font-display:swap}`,
  `@font-face{font-family:Virgil;src:url(${EXCALIDRAW_ASSET_PATH}${FONTS}${VIRGIL}) format("woff2");font-display:swap}`,
].join('');
