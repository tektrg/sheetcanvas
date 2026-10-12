// Public surface of the shared diagram module (no app/store imports).
export * from './types';
// specToElements/layout pull in dagre; import them directly (or lazily) so
// light consumers of this index don't bundle the layout engine.
export { resolveColor } from './colors';
export { patchElement, findBySemanticId, type PatchResult } from './patch';
export { ensureSemanticIds } from './ensureIds';
export { summarizeElements, type DiagramElementSummary } from './summarize';
export { sceneBounds } from './renderSvg';
export { cardSizeFor, sameElements } from './scene';
