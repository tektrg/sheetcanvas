// Run on editor save: drops deleted elements, gives every element a unique
// semantic id. Elements the user drew get `user:<n>`. Copy-pasted elements
// clone customData; the original (lower version, then older `updated`) keeps
// the id and the copy gets a fresh one.
import type { DiagramElement } from './types';

const USER_ID = /^user:(\d+)$/;

const isOlder = (a: DiagramElement, b: DiagramElement) =>
  a.version !== b.version ? a.version < b.version : (a.updated ?? 0) < (b.updated ?? 0);

export function ensureSemanticIds(elements: DiagramElement[]): DiagramElement[] {
  const live = elements.filter((el) => !el.isDeleted);
  let nextUserNumber = 1 + Math.max(0, ...live.map((el) => Number(USER_ID.exec(el.customData?.id ?? '')?.[1] ?? 0)));

  const owner = new Map<string, DiagramElement>();
  for (const el of live) {
    const id = el.customData?.id;
    if (!id) continue;
    const current = owner.get(id);
    if (!current || isOlder(el, current)) owner.set(id, el);
  }

  return live.map((el) => {
    const id = el.customData?.id;
    if (id && owner.get(id) === el) return el;
    return { ...el, customData: { ...el.customData, id: `user:${nextUserNumber++}` } };
  });
}
