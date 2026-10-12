// Public surface of the shared diagram module (no app/store imports).
export * from './types';
export { specToElements, resolveColor } from './specToElements';
export { layoutGraph, createCurveScale } from './layout';
export { patchElement, findBySemanticId, type PatchResult } from './patch';
export { ensureSemanticIds } from './ensureIds';
export { summarizeElements, type DiagramElementSummary } from './summarize';
export { sceneBounds } from './renderSvg';
