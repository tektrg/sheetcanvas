import React, { useEffect, useMemo, useState } from 'react';
import {
  BarChart3,
  ChevronLeft,
  ChevronRight,
  Cloud,
  Database,
  DollarSign,
  FileSpreadsheet,
  Filter,
  Grip,
  Search,
  Sparkles,
  StickyNote,
  Upload
} from 'lucide-react';

type GuideStep = {
  id: string;
  title: string;
  capability: string;
  icon: React.ElementType;
  sectionLabel: string;
  mentalModel: string;
  interaction: string;
  hyperframesPrompt: string;
  kind?: 'workflow' | 'pricing';
};

const GUIDE_STEPS: GuideStep[] = [
  {
    id: 'import',
    title: 'Import local files',
    capability: 'Drop CSV, XLSX, or XLS files directly onto the canvas.',
    icon: Upload,
    sectionLabel: 'Object-first workflow',
    mentalModel: 'Local files become editable tables that stay connected to the surrounding analysis.',
    interaction: 'Drag a spreadsheet file over the window and drop it where the table should appear.',
    hyperframesPrompt: 'Animate a CSV file entering the viewport, the drop target lighting up, then a new table appearing on the canvas.'
  },
  {
    id: 'command-search',
    title: 'Command search',
    capability: 'Search for actions, jump to objects, and run quick calculations.',
    icon: Search,
    sectionLabel: 'Object-first workflow',
    mentalModel: 'The command bar is the fastest way to operate once the canvas gets busy.',
    interaction: 'Press Ctrl+K, type the action or object name, then press Enter.',
    hyperframesPrompt: 'Open the command bar from the bottom, type "chart", highlight matching commands, and execute one.'
  },
  {
    id: 'sort-filter',
    title: 'Sort and filter',
    capability: 'Each table can narrow, order, and prepare data for charts.',
    icon: Filter,
    sectionLabel: 'Object-first workflow',
    mentalModel: 'Filtering changes the visible working set without separating the table from its context.',
    interaction: 'Use the column menu or command bar to sort a column or open the filter panel.',
    hyperframesPrompt: 'Zoom into a table header, open the column menu, apply a filter, then show fewer visible rows.'
  },
  {
    id: 'charts',
    title: 'Create charts',
    capability: 'Turn selected columns into bar, line, area, pie, scatter, or treemap charts.',
    icon: BarChart3,
    sectionLabel: 'Object-first workflow',
    mentalModel: 'Charts are linked objects. Keep them near the source table so the story stays inspectable.',
    interaction: 'Select a table column or range, then create a chart from the sheet tools or command bar.',
    hyperframesPrompt: 'Select columns in a table, choose a chart type, and place the generated chart beside the table.'
  },
  {
    id: 'summaries',
    title: 'Pivots and sparklines',
    capability: 'Create compact summary tables and trend views from larger sheets.',
    icon: Sparkles,
    sectionLabel: 'Object-first workflow',
    mentalModel: 'Use summaries as second-order objects that answer one question without hiding the source data.',
    interaction: 'Start from a sheet, choose pivot or sparkline, then configure the relevant columns.',
    hyperframesPrompt: 'Transform a detailed table into a pivot summary, then add sparkline trend cells for fast scanning.'
  },
  {
    id: 'notes',
    title: 'Notes and context',
    capability: 'Add notes next to the data they explain.',
    icon: StickyNote,
    sectionLabel: 'Object-first workflow',
    mentalModel: 'A useful canvas keeps interpretation close to the evidence.',
    interaction: 'Add a note, write the decision or caveat, and place it beside the relevant table or chart.',
    hyperframesPrompt: 'Add a note near a chart, type a short insight, and show the note anchoring the interpretation.'
  },
  {
    id: 'connectors',
    title: 'Connected data',
    capability: 'Connect Google Sheets, Google Analytics, CSV links, and ClickHouse sources.',
    icon: Database,
    sectionLabel: 'Object-first workflow',
    mentalModel: 'Connected sheets will refresh cloud data into the same object-based canvas model.',
    interaction: 'Use Connect Data to create a linked sheet, then refresh or edit its configuration later.',
    hyperframesPrompt: 'Open Connect Data, pick a source, configure a query, and create a connected sheet on the canvas.'
  },
  {
    id: 'pricing',
    title: 'Pricing',
    capability: 'Local processing is free now. AI assistance and cloud sync are planned as paid add-ons later.',
    icon: DollarSign,
    sectionLabel: 'Pricing',
    mentalModel: 'Use SheetCanvas locally without a paywall while paid cloud features are still being shaped.',
    interaction: 'Keep using local files, manual tables, formulas, charts, pivots, notes, and exports for free.',
    hyperframesPrompt: 'Show local spreadsheet work staying on the device, then preview future AI and cloud sync as separate upcoming add-ons.',
    kind: 'pricing'
  }
];

interface OnboardingGuideProps {
  isOpen: boolean;
  onClose: () => void;
}

export const OnboardingGuide: React.FC<OnboardingGuideProps> = ({ isOpen, onClose }) => {
  const [activeStepId, setActiveStepId] = useState(GUIDE_STEPS[0].id);
  const [hasEntered, setHasEntered] = useState(false);

  const activeIndex = useMemo(
    () => GUIDE_STEPS.findIndex(step => step.id === activeStepId),
    [activeStepId]
  );
  const activeStep = GUIDE_STEPS[Math.max(activeIndex, 0)];
  const ActiveIcon = activeStep.icon;

  const goToStep = (direction: -1 | 1) => {
    const nextIndex = Math.min(GUIDE_STEPS.length - 1, Math.max(0, activeIndex + direction));
    setActiveStepId(GUIDE_STEPS[nextIndex].id);
  };

  useEffect(() => {
    if (!isOpen) {
      setHasEntered(false);
      return;
    }

    const frameId = window.requestAnimationFrame(() => setHasEntered(true));
    return () => window.cancelAnimationFrame(frameId);
  }, [isOpen]);

  const isVisible = isOpen && hasEntered;

  return (
    <div
      className={`fixed inset-0 z-[90] flex items-end justify-center transition-all duration-300 ${
        isOpen ? 'pointer-events-auto' : 'pointer-events-none'
      }`}
      aria-hidden={!isOpen}
    >
      <div
        className={`absolute inset-0 bg-neutral-950/20 backdrop-blur-[2px] transition-opacity duration-300 ${
          isVisible ? 'opacity-100' : 'opacity-0'
        }`}
        onClick={onClose}
      />

      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="onboarding-title"
        className={`relative w-full max-w-5xl mx-3 mb-3 overflow-hidden rounded-2xl border border-neutral-200/70 bg-white shadow-2xl ring-1 ring-neutral-900/5 transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] dark:border-neutral-700/70 dark:bg-neutral-900 dark:ring-white/10 sm:mx-6 sm:mb-6 ${
          isVisible ? 'translate-y-0 opacity-100 scale-100' : 'translate-y-12 opacity-0 scale-[0.98]'
        }`}
      >
        <div className="flex items-center justify-between border-b border-neutral-200/70 px-4 py-3 dark:border-neutral-800 sm:px-5">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-teal-50 text-teal-600 dark:bg-teal-900/30 dark:text-teal-300">
              <Grip size={18} />
            </div>
            <div className="min-w-0">
              <h2 id="onboarding-title" className="truncate text-sm font-semibold text-neutral-950 dark:text-neutral-50">
                Learn the SheetCanvas object model
              </h2>
              <p className="truncate text-xs text-neutral-500 dark:text-neutral-400">
                A quick tour of the core canvas workflows.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 flex-shrink-0 items-center justify-center rounded-lg px-3 text-xs font-semibold text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-800 dark:hover:text-neutral-50"
            aria-label="Watch later"
          >
            watch later
          </button>
        </div>

        <div className="grid max-h-[78vh] grid-cols-1 overflow-y-auto md:grid-cols-[260px_minmax(0,1fr)]">
          <nav className="border-b border-neutral-200/70 p-2 dark:border-neutral-800 md:border-b-0 md:border-r">
            <div className="grid grid-cols-2 gap-1 md:grid-cols-1">
              {GUIDE_STEPS.map((step, index) => {
                const StepIcon = step.icon;
                const isActive = step.id === activeStep.id;

                return (
                  <button
                    key={step.id}
                    type="button"
                    onClick={() => setActiveStepId(step.id)}
                    className={`flex min-h-[56px] items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors ${
                      isActive
                        ? 'bg-neutral-950 text-white shadow-sm dark:bg-neutral-50 dark:text-neutral-950'
                        : 'text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800'
                    }`}
                  >
                    <span
                      className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md ${
                        isActive
                          ? 'bg-white/15 text-white dark:bg-neutral-950/10 dark:text-neutral-950'
                          : 'bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400'
                      }`}
                    >
                      <StepIcon size={16} />
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-xs font-semibold">{step.title}</span>
                      <span className={`block truncate text-[10px] ${isActive ? 'opacity-70' : 'opacity-60'}`}>
                        Step {index + 1}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </nav>

          <div className="grid gap-4 p-4 sm:p-5 lg:grid-cols-[minmax(0,1fr)_320px]">
            <div className="flex min-w-0 flex-col gap-4">
              <div>
                <div className="mb-3 flex items-center gap-3">
                  <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-neutral-950 text-white dark:bg-neutral-50 dark:text-neutral-950">
                    <ActiveIcon size={20} />
                  </div>
                  <div className="min-w-0">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-teal-600 dark:text-teal-300">
                      {activeStep.sectionLabel}
                    </p>
                    <h3 className="text-xl font-semibold text-neutral-950 dark:text-neutral-50">
                      {activeStep.title}
                    </h3>
                  </div>
                </div>
                <p className="max-w-2xl text-sm leading-6 text-neutral-600 dark:text-neutral-300">
                  {activeStep.capability}
                </p>
              </div>

              {activeStep.kind === 'pricing' ? (
                <section className="rounded-lg border border-teal-200 bg-teal-50 p-4 text-teal-950 dark:border-teal-800/70 dark:bg-teal-950/30 dark:text-teal-50" aria-labelledby="onboarding-pricing-title">
                  <div className="mb-4 flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-white/70 text-teal-700 dark:bg-teal-900/50 dark:text-teal-200">
                      <DollarSign size={18} />
                    </div>
                    <div>
                      <p id="onboarding-pricing-title" className="text-sm font-semibold">Free local workspace</p>
                      <p className="text-xs text-teal-900/65 dark:text-teal-100/65">Paid AI and cloud features later</p>
                    </div>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="rounded-lg border border-teal-200/70 bg-white/55 p-4 dark:border-teal-800/60 dark:bg-teal-950/35">
                      <div className="mb-2 flex items-center gap-2">
                        <FileSpreadsheet size={16} />
                        <p className="text-xs font-semibold">Included for free</p>
                      </div>
                      <p className="text-sm leading-6 text-teal-900/80 dark:text-teal-100/80">
                        Files, manual tables, formulas, charts, pivots, notes, exports, and other local processing.
                      </p>
                    </div>
                    <div className="rounded-lg border border-teal-200/70 bg-white/55 p-4 dark:border-teal-800/60 dark:bg-teal-950/35">
                      <div className="mb-2 flex items-center gap-2">
                        <Cloud size={16} />
                        <p className="text-xs font-semibold">Planned paid add-ons</p>
                      </div>
                      <p className="text-sm leading-6 text-teal-900/80 dark:text-teal-100/80">
                        AI assistance and cloud sync will have pricing when those features ship.
                      </p>
                    </div>
                  </div>
                </section>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-4 dark:border-neutral-800 dark:bg-neutral-950/30">
                    <p className="mb-2 text-xs font-semibold text-neutral-950 dark:text-neutral-100">Mental model</p>
                    <p className="text-sm leading-6 text-neutral-600 dark:text-neutral-300">{activeStep.mentalModel}</p>
                  </div>
                  <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-4 dark:border-neutral-800 dark:bg-neutral-950/30">
                    <p className="mb-2 text-xs font-semibold text-neutral-950 dark:text-neutral-100">Interaction</p>
                    <p className="text-sm leading-6 text-neutral-600 dark:text-neutral-300">{activeStep.interaction}</p>
                  </div>
                </div>
              )}
            </div>

            <aside className="flex min-h-[300px] flex-col rounded-lg border border-neutral-200 bg-neutral-950 p-4 text-white shadow-inner dark:border-neutral-800">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <p className="text-xs font-semibold text-teal-300">HyperFrames placeholder</p>
                  <p className="text-[11px] text-white/50">Storyboard slot for the later video asset</p>
                </div>
                <Cloud size={18} className="text-white/35" />
              </div>

              <div className="relative mb-4 flex min-h-[150px] flex-1 items-center justify-center overflow-hidden rounded-lg border border-white/10 bg-white/[0.06]">
                <div className="absolute inset-x-8 top-8 h-2 rounded-full bg-teal-300/50" />
                <div className="absolute left-8 top-16 h-16 w-24 rounded-md border border-white/15 bg-white/10" />
                <div className="absolute right-8 top-14 h-20 w-28 rounded-md border border-teal-300/30 bg-teal-300/10" />
                <div className="absolute bottom-8 left-1/2 h-10 w-32 -translate-x-1/2 rounded-md border border-white/15 bg-white/10" />
                <div className="relative z-10 rounded-lg bg-neutral-950/80 px-3 py-2 text-center text-xs font-medium shadow-xl ring-1 ring-white/10">
                  Video pending
                </div>
              </div>

              <p className="mb-4 text-xs leading-5 text-white/70">{activeStep.hyperframesPrompt}</p>

              <div className="mt-auto flex items-center justify-between border-t border-white/10 pt-4">
                <button
                  type="button"
                  onClick={() => goToStep(-1)}
                  disabled={activeIndex === 0}
                  className="flex h-9 w-9 items-center justify-center rounded-lg text-white/70 transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-30"
                  aria-label="Previous onboarding step"
                >
                  <ChevronLeft size={18} />
                </button>
                <span className="text-xs text-white/45">
                  {activeIndex + 1} of {GUIDE_STEPS.length}
                </span>
                <button
                  type="button"
                  onClick={() => goToStep(1)}
                  disabled={activeIndex === GUIDE_STEPS.length - 1}
                  className="flex h-9 w-9 items-center justify-center rounded-lg text-white/70 transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-30"
                  aria-label="Next onboarding step"
                >
                  <ChevronRight size={18} />
                </button>
              </div>
            </aside>
          </div>
        </div>
      </section>
    </div>
  );
};
