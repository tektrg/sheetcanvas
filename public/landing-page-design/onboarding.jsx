// ────────── SheetCanvas onboarding · bottom sheet ──────────
const { useState, useEffect, useCallback } = React;

// ── inline icons (lucide-style) ────────────────────────────
const Ic = {
  Grip: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="5" cy="5" r="1.4"/><circle cx="12" cy="5" r="1.4"/><circle cx="19" cy="5" r="1.4"/>
      <circle cx="5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="19" cy="12" r="1.4"/>
      <circle cx="5" cy="19" r="1.4"/><circle cx="12" cy="19" r="1.4"/><circle cx="19" cy="19" r="1.4"/>
    </svg>
  ),
  Zap: () => <svg viewBox="0 0 24 24" fill="currentColor"><path d="M13 2 L4 14 H11 L10 22 L20 9 H13 Z"/></svg>,
  Upload: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"/></svg>,
  Search: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>,
  Filter: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 4h18l-7 9v6l-4-2v-4z"/></svg>,
  Chart: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M3 21h18M7 17v-6M12 17v-9M17 17v-4"/></svg>,
  Spark: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M12 3l1.6 5 5 1.6-5 1.6L12 16l-1.6-4.8-5-1.6 5-1.6Z"/></svg>,
  Note: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M15 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-9zM15 3v6h5"/></svg>,
  Database: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><ellipse cx="12" cy="5" rx="8" ry="2.4"/><path d="M4 5v6c0 1.3 3.6 2.4 8 2.4s8-1.1 8-2.4V5M4 11v6c0 1.3 3.6 2.4 8 2.4s8-1.1 8-2.4v-6"/></svg>,
  Dollar: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>,
  Wifi: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0M2 9a15 15 0 0 1 20 0M3 3l18 18"/></svg>,
  Keyboard: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10"/></svg>,
  Chevron: ({d}) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ transform: d==='l' ? 'rotate(180deg)' : 'none' }}><path d="m9 6 6 6-6 6"/></svg>,
};

// ── keyboard chip ──────────────────────────────────────────
const Kbds = ({ keys }) => (
  <span className="kbds">{keys.map((k,i) => <kbd key={i} className="kbd">{k}</kbd>)}</span>
);

// ── per-step preview components ────────────────────────────
const PrevWhy = () => (
  <div className="pv-why">
    <div className="pv-why__pane pv-why__pane--bad">
      <span className="pv-why__label">legacy grid</span>
      <span className="pv-why__title">loading 240k rows</span>
      <div className="pv-why__rows">
        <span/><span/><span/><span/><span/><span/>
      </div>
      <div className="pv-why__spinner"/>
      <div className="pv-why__bar"><span/></div>
      <span className="pv-why__ms">480 ms</span>
    </div>
    <div className="pv-why__pane pv-why__pane--good">
      <span className="pv-why__label">SheetCanvas</span>
      <span className="pv-why__title">canvas · 6 objects ready</span>
      <div className="pv-why__rows">
        <span/><span className="hl"/><span/><span className="hl"/><span/><span/>
      </div>
      <svg viewBox="0 0 100 24" style={{ height: 20, marginTop: 4 }}>
        <polyline points="0,20 14,16 28,18 42,8 56,12 70,4 84,8 100,2" fill="none" stroke="#0d9488" strokeWidth="1.4"/>
      </svg>
      <div className="pv-why__bar"><span/></div>
      <span className="pv-why__ms">12 ms</span>
    </div>
  </div>
);

const PrevImport = () => (
  <>
    <div className="pv-imp__file">
      <span className="pv-imp__ext">CSV</span>
      <div className="pv-imp__name">orders_q3.csv</div>
      <div className="pv-imp__metab">2 384 rows · 18 KB</div>
    </div>
    <svg className="pv-imp__arrow" viewBox="0 0 80 40" fill="none">
      <path d="M4,8 C 28,8 36,32 76,32" stroke="currentColor" strokeWidth="1.2" strokeDasharray="3 3"/>
      <path d="M72,28 L78,32 L72,36" stroke="currentColor" strokeWidth="1.2"/>
    </svg>
    <div className="pv-imp__target">
      <div className="pv-imp__target-cnt">
        <div className="pv-imp__plus">+</div>
        <div className="pv-imp__target-lbl">drop to place a table</div>
      </div>
    </div>
  </>
);

const PrevCmd = () => (
  <div className="pv-cmd">
    <div className="pv-cmd__bar">
      <span className="ic">⌕</span>
      <span>create chart<span className="pv-cmd__caret"/></span>
      <span className="esc">esc</span>
    </div>
    <div className="pv-cmd__list">
      <div className="pv-cmd__row is-active">
        <span className="pv-cmd__verb">create</span>
        <span>chart from selection</span>
        <span className="ret">↵</span>
      </div>
      <div className="pv-cmd__row">
        <span className="pv-cmd__verb">create</span>
        <span>pivot summary</span>
      </div>
      <div className="pv-cmd__row">
        <span className="pv-cmd__verb">go to</span>
        <span>revenue by region</span>
      </div>
      <div className="pv-cmd__row">
        <span className="pv-cmd__verb">filter</span>
        <span>where revenue &gt; 50000</span>
      </div>
    </div>
  </div>
);

const PrevSort = () => (
  <div className="pv-tbl">
    <div className="pv-tbl__row pv-tbl__row--hd"><span>region</span><span>units <em>↓</em></span><span>rev</span></div>
    <div className="pv-tbl__row"><span>APAC</span><span>1 410</span><span>$103k</span></div>
    <div className="pv-tbl__row"><span>NA W</span><span>1 204</span><span>$84k</span></div>
    <div className="pv-tbl__row"><span>NA E</span><span>988</span><span>$72k</span></div>
    <div className="pv-tbl__row pv-tbl__row--hide"><span>EU S</span><span>884</span><span>$66k</span></div>
    <div className="pv-tbl__row pv-tbl__row--hide"><span>EU N</span><span>612</span><span>$48k</span></div>
    <div className="pv-tbl__filter">units &gt; 900 · sort desc</div>
  </div>
);

const PrevChart = () => (
  <div className="pv-ch">
    <div className="pv-ch__mini">
      <span className="pv-ch__lbl">bar · revenue by region</span>
      <svg viewBox="0 0 100 40"><rect x="4" y="18" width="12" height="22"/><rect x="22" y="10" width="12" height="30"/><rect x="40" y="22" width="12" height="18"/><rect x="58" y="4" width="12" height="36" className="hl"/><rect x="76" y="14" width="12" height="26"/></svg>
    </div>
    <div className="pv-ch__mini">
      <span className="pv-ch__lbl">line · weekly trend</span>
      <svg viewBox="0 0 100 40"><polyline fill="none" strokeWidth="1.8" points="2,32 18,26 34,28 50,14 66,18 82,8 98,12"/></svg>
    </div>
    <div className="pv-ch__mini">
      <span className="pv-ch__lbl">area · 30‑day</span>
      <svg viewBox="0 0 100 40"><path d="M2,34 L18,26 L34,28 L50,14 L66,18 L82,6 L98,10 L98,38 L2,38 Z" opacity=".25"/><polyline fill="none" stroke="#0d9488" strokeWidth="1.6" points="2,34 18,26 34,28 50,14 66,18 82,6 98,10"/></svg>
    </div>
    <div className="pv-ch__mini">
      <span className="pv-ch__lbl">scatter · price/volume</span>
      <svg viewBox="0 0 100 40"><circle cx="14" cy="30" r="2.2"/><circle cx="28" cy="22" r="2.2"/><circle cx="40" cy="32" r="2.2"/><circle cx="54" cy="14" r="2.2"/><circle cx="66" cy="24" r="2.2"/><circle cx="82" cy="10" r="2.2" style={{fill:'#0d9488', opacity:1}}/></svg>
    </div>
  </div>
);

const PrevPivot = () => (
  <div className="pv-pv">
    <div className="pv-pv__hd"><span>region</span><span>Q1</span><span>Q2</span><span>Q3</span><span>trend</span></div>
    <div className="pv-pv__row"><span>NA</span><span>$142k</span><span>$168k</span><span>$192k</span>
      <svg viewBox="0 0 40 14" preserveAspectRatio="none"><polyline points="0,11 8,9 16,7 24,6 32,4 40,2"/></svg></div>
    <div className="pv-pv__row"><span>EU</span><span>$98k</span><span>$112k</span><span>$115k</span>
      <svg viewBox="0 0 40 14" preserveAspectRatio="none"><polyline points="0,10 8,8 16,9 24,7 32,6 40,5"/></svg></div>
    <div className="pv-pv__row"><span>APAC</span><span>$76k</span><span>$94k</span><span>$132k</span>
      <svg viewBox="0 0 40 14" preserveAspectRatio="none"><polyline points="0,12 8,11 16,9 24,7 32,4 40,1"/></svg></div>
    <div className="pv-pv__row"><span>LATAM</span><span>$28k</span><span>$31k</span><span>$36k</span>
      <svg viewBox="0 0 40 14" preserveAspectRatio="none"><polyline points="0,10 8,9 16,9 24,7 32,6 40,5"/></svg></div>
  </div>
);

const PrevNotes = () => (
  <div className="pv-nt">
    <div className="pv-nt__chart">
      <svg viewBox="0 0 100 56">
        <rect x="4" y="32" width="10" height="20"/>
        <rect x="20" y="22" width="10" height="30"/>
        <rect x="36" y="38" width="10" height="14"/>
        <rect x="52" y="28" width="10" height="24"/>
        <rect x="68" y="4" width="10" height="48" className="hl"/>
        <rect x="84" y="18" width="10" height="34"/>
      </svg>
    </div>
    <svg className="pv-nt__arrow" viewBox="0 0 80 50">
      <path d="M4,12 C 30,12 40,38 76,40"/>
      <path d="M72,36 L78,40 L72,44"/>
    </svg>
    <div className="pv-nt__note">
      APAC lifted Q3 — verify FX adjust with finance before readout.
      <span>— mira · oct 14</span>
    </div>
  </div>
);

const PrevConnect = () => (
  <div className="pv-cn">
    <svg className="pv-cn__lines" viewBox="0 0 200 130" preserveAspectRatio="none">
      <path d="M30,16 C 80,16 90,65 100,65"/>
      <path d="M170,16 C 120,16 110,65 100,65"/>
      <path d="M30,114 C 80,114 90,65 100,65"/>
      <path d="M170,114 C 120,114 110,65 100,65"/>
    </svg>
    <div className="pv-cn__src pv-cn__src--1"><span className="dot"/>Google Sheets</div>
    <div className="pv-cn__src pv-cn__src--2"><span className="dot"/>GA</div>
    <div className="pv-cn__src pv-cn__src--3"><span className="dot"/>ClickHouse</div>
    <div className="pv-cn__src pv-cn__src--4"><span className="dot"/>CSV link</div>
    <div className="pv-cn__hub"><div style={{textAlign:'center'}}><b>canvas</b>sync</div></div>
  </div>
);

const PrevPricing = () => (
  <div className="pv-pr">
    <div className="pv-pr__tile pv-pr__tile--free">
      <span className="pv-pr__chip">available now</span>
      <div className="pv-pr__lbl">Local workspace</div>
      <div className="pv-pr__price"><b>$0</b><small>forever for local</small></div>
      <div className="pv-pr__tags">
        <span className="pv-pr__tag">tables</span>
        <span className="pv-pr__tag">charts</span>
        <span className="pv-pr__tag">pivots</span>
        <span className="pv-pr__tag">notes</span>
        <span className="pv-pr__tag">exports</span>
      </div>
    </div>
    <div className="pv-pr__tile pv-pr__tile--soon">
      <span className="pv-pr__chip">planned · pricing later</span>
      <div className="pv-pr__lbl">AI &amp; cloud sync</div>
      <div className="pv-pr__price"><b>TBD</b><small>shipping in waves</small></div>
      <div className="pv-pr__tags">
        <span className="pv-pr__tag">AI formulas</span>
        <span className="pv-pr__tag">cloud sync</span>
        <span className="pv-pr__tag">team workspaces</span>
      </div>
    </div>
  </div>
);

// ── step definitions ─────────────────────────────────────
const STEPS = [
  {
    id: 'why',
    section: 'Start here',
    title: 'Why SheetCanvas',
    icon: Ic.Zap,
    capability: 'Spreadsheet work without the spreadsheet bottlenecks — built for fast, local, keyboard‑led analysis on a visual canvas.',
    mentalModel: 'Treat the canvas like a workshop: tables, charts, pivots and notes are loose objects you arrange — not cells trapped inside a grid.',
    interaction: 'Open it when a spreadsheet starts feeling slow, boxed in, or too disconnected from your live data.',
    shortcut: null,
    tags: ['speed', 'offline', 'keyboard', 'connectors', 'visualizations'],
    Preview: PrevWhy,
    previewLabel: 'comparison',
    previewCaption: 'A 240k‑row grid stalling on load vs. the same data already arranged as objects on a canvas.',
  },
  {
    id: 'import',
    section: 'Object‑first workflow',
    title: 'Import local files',
    icon: Ic.Upload,
    capability: 'Drop CSV, XLSX, or XLS files directly onto the canvas. They become editable tables that stay connected to their analysis.',
    mentalModel: 'A dropped file is an object, not a tab — it lives where you place it, beside the charts and notes it belongs to.',
    interaction: 'Drag a spreadsheet file over the window and drop it where the table should appear.',
    shortcut: { keys: ['⌘','O'], label: 'or open from disk' },
    tags: ['.csv', '.xlsx', '.xls', 'drag‑drop'],
    Preview: PrevImport,
    previewLabel: 'drop · place',
    previewCaption: 'A CSV floats into the drop target, lights up the zone, and renders a live table where you let go.',
  },
  {
    id: 'cmd',
    section: 'Object‑first workflow',
    title: 'Command search',
    icon: Ic.Search,
    capability: 'Search for actions, jump to objects, and run quick calculations from one bar — the fastest way to operate once the canvas gets busy.',
    mentalModel: 'The command bar is the canvas\'s nervous system. If you can name it, you can run it without leaving the keyboard.',
    interaction: 'Press the shortcut, type the action or object name, then press ↵.',
    shortcut: { keys: ['⌘','K'], label: 'opens anywhere' },
    tags: ['fuzzy match', 'verb · noun', '↑↓ navigate', '⌘↵ run & pin'],
    Preview: PrevCmd,
    previewLabel: 'command bar',
    previewCaption: 'Typed "create chart" — six matching actions; the verb chip on each result tells you what will happen.',
  },
  {
    id: 'sort',
    section: 'Object‑first workflow',
    title: 'Sort and filter',
    icon: Ic.Filter,
    capability: 'Each table can narrow, order, and prepare data for charts — without disconnecting from the surrounding context.',
    mentalModel: 'Filters change the visible working set on a table object. The source rows stay put; the view is what moves.',
    interaction: 'Use the column header menu, or open the filter panel from the command bar.',
    shortcut: { keys: ['F'], label: 'open filter on selected column' },
    tags: ['column menu', 'multi‑sort', 'numeric · text · date', 'live preview'],
    Preview: PrevSort,
    previewLabel: 'table · filtered',
    previewCaption: 'Filter "units > 900" + sort desc hides two regions; chart objects downstream update in place.',
  },
  {
    id: 'charts',
    section: 'Object‑first workflow',
    title: 'Create charts',
    icon: Ic.Chart,
    capability: 'Turn selected columns into bar, line, area, pie, scatter, or treemap charts — placed wherever the story needs them.',
    mentalModel: 'A chart is a linked object pointing at its source range. Keep it close so the story stays inspectable.',
    interaction: 'Select a column or range in a table, then create a chart from sheet tools or command bar.',
    shortcut: { keys: ['⌘','E'], label: 'chart from selection' },
    tags: ['bar', 'line', 'area', 'pie', 'scatter', 'treemap'],
    Preview: PrevChart,
    previewLabel: 'chart types',
    previewCaption: 'Four mini‑charts from the same table — each kept on the canvas, each editable from its source range.',
  },
  {
    id: 'pivot',
    section: 'Object‑first workflow',
    title: 'Pivots and sparklines',
    icon: Ic.Spark,
    capability: 'Compact summary tables and trend cells that answer one question without hiding the source data.',
    mentalModel: 'Use summaries as second‑order objects. The detail table stays nearby — auditable in a glance.',
    interaction: 'Start from a sheet, choose pivot or sparkline, then configure the relevant columns.',
    shortcut: { keys: ['⌘','⇧','P'], label: 'new pivot · ⌘⇧S for sparkline' },
    tags: ['group by', 'sum · avg · count', 'inline spark', 'auto refresh'],
    Preview: PrevPivot,
    previewLabel: 'pivot · sparklines',
    previewCaption: 'Q1‑Q3 by region with sparkline trend cells — fast scanning of where revenue is going.',
  },
  {
    id: 'notes',
    section: 'Object‑first workflow',
    title: 'Notes and context',
    icon: Ic.Note,
    capability: 'Add notes next to the data they explain — interpretation stays close to the evidence.',
    mentalModel: 'A useful canvas remembers why a decision was made. The note IS the documentation; the canvas IS the deck.',
    interaction: 'Add a note, write the decision or caveat, and place it beside the relevant table or chart.',
    shortcut: { keys: ['N'], label: 'new note at cursor' },
    tags: ['markdown', 'anchored', '@mention', 'color tabs'],
    Preview: PrevNotes,
    previewLabel: 'note · anchored',
    previewCaption: 'A sticky note points at the APAC outlier — caveat, author, and date pinned to the artifact.',
  },
  {
    id: 'connect',
    section: 'Object‑first workflow',
    title: 'Connected data',
    icon: Ic.Database,
    capability: 'Pull Google Sheets, Google Analytics, CSV links and ClickHouse into the same canvas as your local files.',
    mentalModel: 'A connected sheet is just another canvas object — it refreshes from its source but lives where you placed it.',
    interaction: 'Use Connect Data to create a linked sheet, then refresh or edit its configuration any time.',
    shortcut: { keys: ['⌘','⇧','D'], label: 'open Connect Data' },
    tags: ['google sheets', 'google analytics', 'clickhouse', 'csv url', 'postgres · soon'],
    Preview: PrevConnect,
    previewLabel: 'sources → canvas',
    previewCaption: 'Four live sources feed one canvas hub. The same object model wraps local files and cloud queries.',
  },
  {
    id: 'pricing',
    section: 'Pricing',
    title: 'Pricing',
    icon: Ic.Dollar,
    capability: 'Local processing is free now. AI assistance and cloud sync are planned as paid add‑ons later.',
    mentalModel: 'Use the canvas locally without a paywall while paid cloud features are still being shaped.',
    interaction: 'Keep using local files, tables, formulas, charts, pivots, notes, and exports for free.',
    shortcut: null,
    tags: ['free · local', 'paid · ai (later)', 'paid · cloud sync (later)'],
    Preview: PrevPricing,
    previewLabel: 'tiers',
    previewCaption: 'Local stays free. Paid features will be priced before any of them ships — never a surprise upgrade.',
  },
];

// group by section for the rail
const SECTIONS = STEPS.reduce((acc, s, i) => {
  const last = acc[acc.length - 1];
  if (last && last.label === s.section) last.items.push({ ...s, idx: i });
  else acc.push({ label: s.section, items: [{ ...s, idx: i }] });
  return acc;
}, []);

// ── main ─────────────────────────────────────────────────
const Onboarding = () => {
  const [i, setI] = useState(0);
  const [seen, setSeen] = useState(() => new Set([0]));

  const goTo = useCallback((next) => {
    const clamped = Math.max(0, Math.min(STEPS.length - 1, next));
    setI(clamped);
    setSeen(prev => new Set(prev).add(clamped));
  }, []);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); goTo(i + 1); }
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); goTo(i - 1); }
      else if (e.key === 'Escape') { /* close stub */ }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [i, goTo]);

  const step = STEPS[i];
  const Icon = step.icon;
  const Preview = step.Preview;
  const nextStep = STEPS[i + 1];
  const prevStep = STEPS[i - 1];

  return (
    <div className="sheet" role="dialog" aria-modal="true" aria-labelledby="ob-title">
      {/* ─── header ─── */}
      <header className="sheet__hd">
        <div className="sheet__brand"><Ic.Grip/></div>
        <div>
          <div className="sheet__title" id="ob-title">Learn the SheetCanvas object model</div>
          <div className="sheet__sub">A quick tour of the core canvas workflows · 9 steps · ~3 min</div>
        </div>
        <div className="sheet__hdmeta">
          <span className="sheet__crumbs">
            <span>step</span><b>{String(i + 1).padStart(2, '0')}</b><span>/ 09</span>
          </span>
          <button className="sheet__close" type="button">watch later</button>
        </div>
      </header>

      {/* ─── body ─── */}
      <div className="sheet__body">
        {/* rail */}
        <nav className="rail" aria-label="onboarding steps">
          {SECTIONS.map((sec, si) => (
            <div className="rail__group" key={si}>
              <div className="rail__group-label">{sec.label}</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: 4 }}>
                {sec.items.map(s => {
                  const SIcon = s.icon;
                  const active = s.idx === i;
                  const done = !active && seen.has(s.idx);
                  return (
                    <button
                      key={s.id}
                      className={`rail__item ${active ? 'is-active' : ''}`}
                      onClick={() => goTo(s.idx)}
                      type="button"
                    >
                      <span className="rail__icon"><SIcon/></span>
                      <span>
                        <span className="rail__name">{s.title}</span>
                      </span>
                      <span className="rail__num">{String(s.idx + 1).padStart(2, '0')}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        {/* main */}
        <main className="main">
          <div className="main__top">
            <div className="main__icon"><Icon/></div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="main__eyebrow"><span className="dot"/>{step.section}</div>
              <h2 className="main__title">{step.title}</h2>
            </div>
          </div>

          <p className="main__capability">{step.capability}</p>

          <div className="main__grid">
            <div className="info-card">
              <div className="info-card__label">
                <svg width="10" height="10" viewBox="0 0 12 12"><circle cx="6" cy="6" r="5" fill="none" stroke="currentColor" strokeWidth="1.4"/><circle cx="6" cy="6" r="1.6" fill="currentColor"/></svg>
                Mental model
              </div>
              <div className="info-card__body">{step.mentalModel}</div>
            </div>
            <div className="info-card">
              <div className="info-card__label">
                <svg width="10" height="10" viewBox="0 0 12 12"><path d="M2 6h6m0 0L5 3m3 3L5 9" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round"/></svg>
                Interaction
              </div>
              <div className="info-card__body">
                {step.interaction}
                {step.shortcut && (
                  <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <Kbds keys={step.shortcut.keys}/>
                    <span style={{ fontSize: 11.5, color: '#6B6B68' }}>{step.shortcut.label}</span>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div>
            <div className="info-card__label" style={{ marginBottom: 6 }}>
              <svg width="10" height="10" viewBox="0 0 12 12"><rect x="1.5" y="1.5" width="9" height="9" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.2"/><rect x="3.5" y="3.5" width="2" height="2" fill="currentColor"/><rect x="6.5" y="6.5" width="2" height="2" fill="currentColor"/></svg>
              On the canvas
            </div>
            <div className="tags">
              {step.tags.map((t, ti) => (
                <span key={ti} className={`tag ${ti === 0 ? 'tag--teal' : ''}`}>{t}</span>
              ))}
            </div>
          </div>
        </main>

        {/* preview */}
        <aside className="sheet__preview">
          <div className="preview__hd">
            <span>preview · <b>{step.previewLabel}</b></span>
            <span>{String(i + 1).padStart(2, '0')}/09</span>
          </div>
          <div className="preview__stage">
            <Preview/>
          </div>
          <p className="preview__caption">{step.previewCaption}</p>
        </aside>
      </div>

      {/* ─── footer ─── */}
      <footer className="sheet__ft">
        <div>
          <div className="progress" role="tablist" aria-label="progress">
            {STEPS.map((s, idx) => (
              <button
                key={s.id}
                className={`progress__seg ${idx === i ? 'is-active' : ''} ${idx < i || seen.has(idx) && idx !== i ? 'is-done' : ''}`}
                onClick={() => goTo(idx)}
                aria-label={`Step ${idx + 1}: ${s.title}`}
                type="button"
              />
            ))}
          </div>
          <div className="studio-links" aria-label="theindie.app apps">
            <span className="studio-about"><b>SheetCanvas</b> is built by theindie.app, a founder-led indie studio.</span>
            <a href="https://theindie.app/" target="_blank" rel="noreferrer">theindie.app</a>
            <a href="https://fasttab.theindie.app" target="_blank" rel="noreferrer">FastTab</a>
            <a href="https://strider.theindie.app" target="_blank" rel="noreferrer">Strider</a>
            <a href="https://pineapplelog.theindie.app" target="_blank" rel="noreferrer">Pineapple Log</a>
            <a href="https://gptbreeze.io" target="_blank" rel="noreferrer">GPT Breeze</a>
            <a href="https://speechtodo.com" target="_blank" rel="noreferrer">SpeechToDo</a>
          </div>
        </div>
        <div className="ft__hint mono">
          {nextStep ? <>next · <b>{nextStep.title.toLowerCase()}</b></> : <>last step · ready to start</>}
        </div>
        <div className="ft__nav">
          <button className="nav-btn" type="button" onClick={() => goTo(i - 1)} disabled={i === 0}>
            <Ic.Chevron d="l"/> Back
          </button>
          <button className="nav-btn nav-btn--primary" type="button" onClick={() => goTo(i + 1)} disabled={i === STEPS.length - 1}>
            {nextStep ? `Next · ${nextStep.title.length > 16 ? nextStep.title.slice(0,14) + '…' : nextStep.title}` : 'Done'} <Ic.Chevron d="r"/>
          </button>
        </div>
      </footer>
    </div>
  );
};

ReactDOM.createRoot(document.getElementById('root')).render(<Onboarding/>);
