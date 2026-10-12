// Run on editor save: drops deleted elements, gives every element a unique
// semantic id. Elements the user drew get `user:<n>`; copy-pasted elements
// (which clone customData) keep the id on the first copy and get a fresh one.
import type { DiagramElement } from './types';

const USER_ID = /^user:(\d+)$/;

export function ensureSemanticIds(elements: DiagramElement[]): DiagramElement[] {
  const live = elements.filter((el) => !el.isDeleted);
  let nextUserNumber = 1 + Math.max(0, ...live.map((el) => Number(USER_ID.exec(el.customData?.id ?? '')?.[1] ?? 0)));
  const seen = new Set<string>();

  return live.map((el) => {
    const current = el.customData?.id;
    if (current && !seen.has(current)) {
      seen.add(current);
      return el;
    }
    const id = `user:${nextUserNumber++}`;
    seen.add(id);
    return { ...el, customData: { ...el.customData, id } };
  });
}
