import type { ConnectorQueryBrief } from '../../types';

export type ConnectorQueryBriefInput = {
  logic?: unknown;
  scope?: unknown;
  sources?: unknown;
  judgmentNotes?: unknown;
};

function normalizeTextList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map(item => String(item ?? '').trim()).filter(Boolean)
    : [];
}

export function normalizeConnectorQueryBrief(input: ConnectorQueryBriefInput | undefined): {
  brief: ConnectorQueryBrief | null;
  error: string | null;
} {
  if (!input || typeof input !== 'object') return { brief: null, error: 'brief is required' };

  const logic = String(input.logic ?? '').trim();
  const scope = normalizeTextList(input.scope);
  const sources = normalizeTextList(input.sources);
  const judgmentNotes = normalizeTextList(input.judgmentNotes);

  if (!logic) return { brief: null, error: 'brief.logic is required' };
  if (scope.length === 0) return { brief: null, error: 'brief.scope must include at least one item' };
  if (sources.length === 0) return { brief: null, error: 'brief.sources must include at least one item' };
  if (judgmentNotes.length === 0) {
    return { brief: null, error: 'brief.judgmentNotes must include at least one item' };
  }

  return {
    brief: {
      logic,
      scope,
      sources,
      judgmentNotes,
      status: 'current',
      updatedAt: Date.now(),
    },
    error: null,
  };
}
