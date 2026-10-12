// Agent tool handlers for diagrams (createDiagram, updateDiagramElement,
// readDiagram, listDiagrams). Diagram logic lives in the shared `diagram/`
// module; this file only bridges it to the canvas store.
import { useStore } from '../../store';
import type { DiagramData } from '../../types';
import {
  cardSizeFor,
  ensureSemanticIds,
  patchElement,
  summarizeElements,
  type DiagramElementPatch,
  type DiagramSpec,
} from '../../diagram';
import { placeNote } from '../../utils/canvasLayout';
import { DIAGRAM_SPEC_SCHEMAS } from '../../agent/tools';
import { accumulateNoteFocus } from './agentFocusAccumulator';
import type { ToolResult } from './clientToolExecutor';

export const DIAGRAM_BEING_EDITED = 'diagram is being edited';

const generateId = () => `diagram-${Math.random().toString(36).slice(2, 11)}`;

const semanticIds = (elements: DiagramData['elements']) =>
  elements.map((el) => el.customData?.id).filter((id): id is string => !!id);

// Lazy: the converter bundles the dagre layout engine, kept out of the main chunk.
const loadSpecToScene = () => import('../../diagram/specToElements').then((m) => m.specToScene);

export async function handleCreateDiagram(input: {
  kind: DiagramSpec['kind'];
  title?: string;
  position?: { x: number; y: number };
  spec: unknown;
}): Promise<ToolResult> {
  const parsedSpec = DIAGRAM_SPEC_SCHEMAS[input.kind]?.safeParse(input.spec);
  if (!parsedSpec?.success) {
    const issue = parsedSpec?.error.issues[0];
    return { ok: false, error: issue ? `spec.${issue.path.join('.')}: ${issue.message}` : `Unknown kind: ${input.kind}` };
  }
  const spec = { kind: input.kind, spec: parsedSpec.data } as DiagramSpec;
  const specToScene = await loadSpecToScene();
  let elements: DiagramData['elements'];
  let warnings: string[];
  try {
    ({ elements, warnings } = specToScene(spec));
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  const store = useStore.getState();
  const diagram: DiagramData = {
    id: generateId(),
    position: input.position ?? placeNote(store),
    size: cardSizeFor(elements),
    ...(input.title ? { title: input.title } : {}),
    elements,
    spec,
    version: 1,
  };
  store.addDiagram(diagram);
  accumulateNoteFocus(diagram);
  return {
    ok: true,
    diagramId: diagram.id,
    elementIds: semanticIds(elements),
    ...(warnings.length > 0 ? { warnings } : {}),
  };
}

export function handleUpdateDiagramElement(input: { diagramId: string; id: string; patch: DiagramElementPatch }): ToolResult {
  const store = useStore.getState();
  const diagram = store.diagrams[input.diagramId];
  if (!diagram) return { ok: false, error: `Unknown diagramId: ${input.diagramId}` };
  if (store.editingDiagramId === diagram.id) return { ok: false, error: DIAGRAM_BEING_EDITED };
  const result = patchElement(diagram.elements, input.id, input.patch);
  if (result.ok === false) return { ok: false, error: result.error };
  store.saveSnapshot();
  const elements = ensureSemanticIds(result.elements);
  store.updateDiagram(diagram.id, { elements, size: cardSizeFor(elements) });
  return { ok: true, diagramId: diagram.id, id: input.id };
}

export function handleReadDiagram(input: { diagramId: string; includeGeometry?: boolean }): ToolResult {
  const diagram = useStore.getState().diagrams[input.diagramId];
  if (!diagram) return { ok: false, error: `Unknown diagramId: ${input.diagramId}` };
  return {
    ok: true,
    diagramId: diagram.id,
    title: diagram.title ?? null,
    kind: diagram.spec?.kind ?? null,
    elements: summarizeElements(diagram.elements, input.includeGeometry === true),
  };
}

export function handleListDiagrams(): ToolResult {
  const store = useStore.getState();
  const diagrams = store.diagramIds
    .map((id) => store.diagrams[id])
    .filter((d): d is DiagramData => !!d)
    .map((d) => ({
      diagramId: d.id,
      title: d.title ?? null,
      kind: d.spec?.kind ?? null,
      elementCount: d.elements.filter((el) => !el.isDeleted).length,
    }));
  return { ok: true, diagrams };
}
