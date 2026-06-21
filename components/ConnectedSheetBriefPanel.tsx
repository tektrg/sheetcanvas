import React, { useMemo, useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronRight, Info } from 'lucide-react';
import type { ConnectorQueryBrief } from '../types';

interface ConnectedSheetBriefPanelProps {
  brief?: ConnectorQueryBrief;
}

const listPreview = (items: string[]) => items.slice(0, 2).join(' / ');

const BriefSection = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="text-xs leading-relaxed text-neutral-700 dark:text-neutral-300">
    <span className="font-semibold text-neutral-950 dark:text-neutral-100">{label}:</span> {children}
  </div>
);

export const ConnectedSheetBriefPanel: React.FC<ConnectedSheetBriefPanelProps> = ({ brief }) => {
  const [expanded, setExpanded] = useState(true);

  const hasBrief = !!brief?.logic?.trim();
  const preview = useMemo(() => {
    if (!brief) return '';
    return [brief.logic, listPreview(brief.scope), listPreview(brief.sources)].filter(Boolean).join(' - ');
  }, [brief]);

  if (!hasBrief || !brief) return null;

  const isStale = brief.status === 'stale';

  return (
    <div className="border-t border-neutral-100 bg-white/95 dark:border-neutral-800 dark:bg-neutral-900/85">
      <button
        type="button"
        className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-neutral-50 dark:hover:bg-neutral-800/70"
        aria-expanded={expanded}
        onClick={() => setExpanded(value => !value)}
      >
        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <Info size={14} className="text-teal-600 dark:text-teal-400" />
        <span className="text-[11px] font-semibold uppercase tracking-wide text-neutral-600 dark:text-neutral-300">
          Data brief
        </span>
        {isStale && (
          <span className="inline-flex items-center gap-1 rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-amber-700 dark:border-amber-900/70 dark:bg-amber-950/30 dark:text-amber-300">
            <AlertTriangle size={11} />
            Stale
          </span>
        )}
        {!expanded && preview && (
          <span className="min-w-0 flex-1 truncate text-xs text-neutral-500 dark:text-neutral-400">
            {preview}
          </span>
        )}
      </button>

      {expanded && (
        <div className="space-y-2 border-t border-neutral-100 px-3 py-2 dark:border-neutral-800">
          <BriefSection label="Logic">{brief.logic}</BriefSection>
          <BriefSection label="Scope">
            <span className="inline-flex flex-wrap gap-1.5 align-middle">
              {brief.scope.map(item => (
                <span key={item} className="rounded border border-neutral-200 px-1.5 py-0.5 dark:border-neutral-700">
                  {item}
                </span>
              ))}
            </span>
          </BriefSection>
          <BriefSection label="Sources">
            <span className="inline-flex flex-wrap gap-1.5 align-middle">
              {brief.sources.map(item => (
                <span key={item} className="rounded border border-neutral-200 px-1.5 py-0.5 dark:border-neutral-700">
                  {item}
                </span>
              ))}
            </span>
          </BriefSection>
          <BriefSection label="Judgment notes">
            <span className="inline-flex flex-col gap-1 align-middle">
              {brief.judgmentNotes.map(item => (
                <span key={item}>{item}</span>
              ))}
            </span>
          </BriefSection>
        </div>
      )}
    </div>
  );
};
