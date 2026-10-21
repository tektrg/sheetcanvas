import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '../store';
import { previewIsStale, previewKey, previewSrc } from '../diagram/preview';
import { watchDiagramPreviews } from '../hooks/useDiagramPreviews';
import type { DiagramData } from '../types';
import type { DiagramElement } from '../diagram/types';

vi.mock('../components/diagramExport', () => ({ exportDiagramSvg: vi.fn() }));

const el = (id: string, version = 1) => ({ id, version, isDeleted: false }) as DiagramElement;
const diagram = (elements: DiagramElement[], extra: Partial<DiagramData> = {}): DiagramData => ({
  id: 'd1', position: { x: 0, y: 0 }, size: { width: 400, height: 300 }, elements, version: 1, ...extra,
});

describe('diagram preview key', () => {
  it('goes stale when an element, its version, deletion or the background changes', () => {
    const base = previewKey([el('a'), el('b')], '#fff');
    expect(previewKey([el('a'), el('b')], '#fff')).toBe(base);
    expect(previewKey([el('a'), el('b', 2)], '#fff')).not.toBe(base);
    expect(previewKey([el('a'), { ...el('b'), isDeleted: true }], '#fff')).not.toBe(base);
    expect(previewKey([el('a'), el('b')], '#000')).not.toBe(base);
    expect(previewIsStale(diagram([el('a')]))).toBe(true); // old diagram, no picture yet
    expect(previewIsStale(diagram([el('a')], { preview: { svg: '<svg/>', key: previewKey([el('a')]) } }))).toBe(false);
  });

  it('is shown as an image data URL, never as live markup', () => {
    expect(previewSrc('<svg><script>x</script></svg>')).toMatch(/^data:image\/svg\+xml;charset=utf-8,%3Csvg%3E%3Cscript/);
  });
});

describe('watchDiagramPreviews', () => {
  let stop = () => {};
  beforeEach(() => {
    vi.useFakeTimers();
    useStore.setState({ diagrams: {}, diagramIds: [] });
  });
  afterEach(() => {
    stop();
    vi.useRealTimers();
  });

  it('exports old diagrams at once, debounces edits, and stores the SVG', async () => {
    useStore.setState({ diagrams: { d1: diagram([el('a')]) }, diagramIds: ['d1'] });
    const exporter = vi.fn(async (els: DiagramElement[]) => `<svg data-n="${els.length}"/>`);
    stop = watchDiagramPreviews(exporter, 500);
    await vi.advanceTimersByTimeAsync(0);
    expect(exporter).toHaveBeenCalledTimes(1);
    expect(useStore.getState().diagrams.d1.preview?.svg).toBe('<svg data-n="1"/>');

    // three quick edits (e.g. agent tool writes) -> one export after the pause
    for (const v of [2, 3, 4]) useStore.getState().updateDiagram('d1', { elements: [el('a', v), el('b')] });
    await vi.advanceTimersByTimeAsync(499);
    expect(exporter).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(exporter).toHaveBeenCalledTimes(2);
    const d = useStore.getState().diagrams.d1;
    expect(d.preview).toEqual({ svg: '<svg data-n="2"/>', key: previewKey(d.elements) });
  });

  it('keeps a picture that already matches (e.g. the editor exported it before Save)', async () => {
    const elements = [el('a')];
    useStore.setState({ diagrams: { d1: diagram(elements, { preview: { svg: '<svg/>', key: previewKey(elements) } }) }, diagramIds: ['d1'] });
    const exporter = vi.fn(async () => '<svg/>');
    stop = watchDiagramPreviews(exporter, 500);
    await vi.advanceTimersByTimeAsync(1000);
    expect(exporter).not.toHaveBeenCalled();
  });
});
