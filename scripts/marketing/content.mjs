// Source of truth for the answer-engine (AEO) marketing copy.
// Rules: only shipped SheetCanvas capabilities; neutral, verifiable statements about competitors;
// every comparison is dated with AS_OF. Bump REVIEWED_ON whenever you re-check the facts.

export const PUBLISHED_ON = '2026-10-20';
export const REVIEWED_ON = '2026-10-20';

export const POSITIONING =
  'SheetCanvas is a free visual canvas for spreadsheets, charts and notes, where you analyze data and publish shareable data pages.';

export const AGENT_LINE =
  'Optional: connect your own AI agent (such as Claude or Codex) over MCP so it can build sheets and charts on your canvas.';

export const WHO_FOR = [
  { who: 'Analysts and operators', why: 'who explore CSV, Excel, or warehouse exports and need the source table, the chart, and the conclusion visible together.' },
  { who: 'Founders and small teams', why: 'who want a quick dashboard from Google Analytics, Google Sheets, or ClickHouse without setting up a BI tool.' },
  { who: 'People who work with AI agents', why: 'who want Claude, Codex, or another MCP client to leave durable tables and charts instead of a chat reply that scrolls away.' },
];

export const WHAT_IT_DOES = [
  'Imports local CSV, XLSX, and XLS files as spreadsheet objects on a canvas.',
  'Builds bar, line, area, pie, scatter, treemap, pivot, and sparkline views next to the source data.',
  'Keeps rich-text notes and diagrams (Excalidraw-style drawings and Mermaid) beside the evidence they explain.',
  'Connects to ClickHouse, Google Sheets, and Google Analytics 4 (GA4) as refreshable connected sheets.',
  'Publishes a note or page as a shareable public data page, and embeds individual charts or pages on other websites.',
  'Secondary: exposes the open canvas to your own AI agent over MCP (Model Context Protocol), so Claude, Codex, or another MCP client can read, filter, sort, and chart sheets. A built-in copilot is announced in the app as coming soon.',
];

export const HOME_FAQS = [
  {
    q: 'What is SheetCanvas?',
    a: 'SheetCanvas is a free visual canvas for spreadsheets, charts and notes, where you analyze data and publish shareable data pages. Instead of one grid with tabs, the data and its explanation stay visible together on one canvas.',
  },
  {
    q: 'Who is SheetCanvas for?',
    a: 'It is for analysts, operators, founders, and small teams who explore exported or connected business data and want a visual working surface, and for people who want their AI agent to produce durable tables and charts rather than a chat answer.',
  },
  {
    q: 'Is SheetCanvas a replacement for Excel or Google Sheets?',
    a: 'No. Excel and Google Sheets are deeper spreadsheet systems for complex formulas, macros, and long-lived shared workbooks. SheetCanvas is better when spreadsheet data needs to sit beside charts, notes, and diagrams on one canvas during analysis. Many people use both.',
  },
  {
    q: 'Which data sources does SheetCanvas connect to?',
    a: 'As of October 2026, SheetCanvas imports local CSV, XLSX, and XLS files and has connectors for ClickHouse, Google Sheets, and Google Analytics 4. For other tools, export to CSV or Excel and import the file.',
  },
  {
    q: 'Can I use SheetCanvas with Claude or Codex?',
    a: 'Yes. SheetCanvas exposes the open canvas as an MCP server. Generate a connection URL from the Connect Agent dialog, add it to an MCP-capable client such as Claude or Codex, and the agent can list sheets, read ranges, and create charts while the SheetCanvas tab is open.',
  },
  {
    q: 'Where is my data stored?',
    a: 'Private by default: workspaces are stored locally in your browser. Local file imports stay on your device. Connector credentials are stored encrypted by the SheetCanvas backend so it can query the source on your behalf, and published pages are stored on the server only when you choose to publish.',
  },
  {
    q: 'How much does SheetCanvas cost?',
    a: 'As of October 2026, SheetCanvas has a free core, with optional paid add-ons planned. No prices are published yet.',
  },
  {
    q: 'Do I need an account?',
    a: 'No. As of October 2026, SheetCanvas works without an account. Optional accounts and public profiles are planned but not live yet.',
  },
];

const SC = 'SheetCanvas';

export const COMPARISONS = [
  {
    slug: 'sheetcanvas-vs-excel',
    competitor: 'Excel',
    competitorFull: 'Microsoft Excel',
    title: 'SheetCanvas vs Excel: which is better for data analysis?',
    description: 'An honest, dated comparison of SheetCanvas and Microsoft Excel: when a spreadsheet canvas fits better, and when Excel is still the right tool.',
    question: 'Which is better for data analysis, SheetCanvas or Excel?',
    answer: [
      'It depends on whether the workbook is the product or the analysis is. Choose Excel for financial models, complex formulas, VBA macros, Power Query pipelines, and files your organization already standardizes on; Excel is the deeper and more compatible spreadsheet. Choose SheetCanvas when you are exploring an export and want the source table, several charts, a pivot, and written notes visible side by side on one canvas, or when you want an AI agent to build that layout for you over MCP. A common pattern is to keep Excel as the system of record and open an exported CSV or XLSX in SheetCanvas to explain it.',
    ],
    rows: [
      ['Core model', 'Spreadsheets, charts, pivots, notes, and diagrams as objects on one canvas', 'Workbook of grid sheets with tabs, charts, and pivot tables'],
      ['Formulas and modeling', 'Common spreadsheet formulas for lightweight analysis', 'Very large formula library, dynamic arrays, data model, what-if tools'],
      ['Automation', 'MCP tools for external AI agents', 'VBA macros, Office Scripts, Power Automate'],
      ['Data import', 'CSV, XLSX, XLS; connectors for ClickHouse, Google Sheets, GA4', 'Broad import options including Power Query'],
      ['AI assistance', 'Bring your own agent (Claude, Codex) via MCP; built-in copilot not yet available', 'Microsoft Copilot in Microsoft 365 (plan-dependent)'],
      ['Sharing', 'Private by default; publish a page or embed a chart to share', 'Share workbooks through OneDrive / SharePoint with co-authoring'],
      ['Best at', 'Visual, exploratory analysis and agent-built dashboards', 'Heavy modeling, compatibility, enterprise workflows'],
    ],
    faqs: [
      { q: 'Can SheetCanvas open Excel files?', a: 'Yes. SheetCanvas imports XLSX and XLS files, as well as CSV, as spreadsheet objects on the canvas.' },
      { q: 'Does SheetCanvas support VBA macros?', a: 'No. SheetCanvas does not run VBA or Office Scripts. Use Excel for macro-driven workbooks.' },
      { q: 'When should I stay in Excel?', a: 'Stay in Excel for complex financial models, macro automation, Power Query transformations, and any file that must behave exactly like an Excel workbook for colleagues.' },
    ],
    related: '/alternatives/excel/',
  },
  {
    slug: 'sheetcanvas-vs-google-sheets',
    competitor: 'Google Sheets',
    competitorFull: 'Google Sheets',
    title: 'SheetCanvas vs Google Sheets: which is better for exploring data?',
    description: 'An honest, dated comparison of SheetCanvas and Google Sheets for exploring data, building quick dashboards, and working with AI agents.',
    question: 'Which is better for exploring data, SheetCanvas or Google Sheets?',
    answer: [
      'It depends on whether you need real-time collaboration or a visual analysis surface. Choose Google Sheets when several people edit the same spreadsheet live, when you rely on Apps Script automations, or when the sheet is a shared operational record; its collaboration is mature and free with a Google account. Choose SheetCanvas when you want to place several tables, charts, pivots, notes, and diagrams on one canvas to explore a question, or have your AI agent build that layout over MCP. SheetCanvas can also read a Google Sheet through its connector, so you can keep the data in Sheets and analyze it on the canvas.',
    ],
    rows: [
      ['Core model', 'Objects on one canvas (sheets, charts, pivots, notes, diagrams)', 'Grid spreadsheet with tabs, charts, and pivot tables'],
      ['Collaboration', 'Private by default: workspace stored in your browser; publish pages to share (no live co-editing)', 'Real-time multi-user editing, comments, version history'],
      ['Automation', 'MCP tools for external AI agents', 'Apps Script, add-ons, macros'],
      ['AI assistance', 'Bring your own agent (Claude, Codex) via MCP; built-in copilot not yet available', 'Gemini in Google Workspace (plan-dependent)'],
      ['Data sources', 'CSV, XLSX, XLS; ClickHouse, Google Sheets, GA4 connectors', 'Import functions, connected sheets for BigQuery, add-ons'],
      ['Best at', 'Visual exploration and agent-built dashboards', 'Shared, always-on team spreadsheets'],
    ],
    faqs: [
      { q: 'Can SheetCanvas read data from Google Sheets?', a: 'Yes. SheetCanvas has a Google Sheets connector that loads a sheet as a connected spreadsheet object on the canvas.' },
      { q: 'Does SheetCanvas have real-time collaboration like Google Sheets?', a: 'No. As of October 2026, SheetCanvas is private by default: your workspace is stored in your browser. Publish a page or embed a chart to share results; live co-editing is not supported.' },
      { q: 'When should I stay in Google Sheets?', a: 'Stay in Google Sheets when a team edits the same data together every day, or when Apps Script automations run on the sheet.' },
    ],
    related: '/alternatives/google-sheets/',
  },
  {
    slug: 'sheetcanvas-vs-notion',
    competitor: 'Notion',
    competitorFull: 'Notion',
    title: 'SheetCanvas vs Notion: which is better for data-heavy notes and dashboards?',
    description: 'An honest, dated comparison of SheetCanvas and Notion for combining notes with tables, charts, and analysis.',
    question: 'Which is better for notes with data, SheetCanvas or Notion?',
    answer: [
      'It depends on whether your work is mostly writing or mostly analysis. Choose Notion for team wikis, project tracking, documents, and databases that many people update; it is a mature all-in-one workspace with permissions and collaboration. Choose SheetCanvas when the notes exist to explain data: you import a CSV or connect ClickHouse, Google Sheets, or GA4, then keep spreadsheets, charts, pivots, diagrams, and notes side by side on a canvas, optionally built by an AI agent over MCP. SheetCanvas is not a wiki or project tracker; Notion is not a spreadsheet analysis tool. Some people analyze in SheetCanvas and link or embed the result from Notion.',
    ],
    rows: [
      ['Core model', 'Free-form canvas of spreadsheets, charts, notes, diagrams', 'Pages and blocks, with databases (table, board, calendar, chart views)'],
      ['Spreadsheet analysis', 'Spreadsheet objects with formulas, sorting, filtering, pivots', 'Database properties and formulas; not a full spreadsheet'],
      ['Charts', 'Bar, line, area, pie, scatter, treemap, pivot, sparkline', 'Chart views on databases'],
      ['Collaboration', 'Private by default: workspace stored in your browser; publish pages or embeds to share', 'Multi-user workspace with permissions, comments, and sharing'],
      ['AI assistance', 'Bring your own agent (Claude, Codex) via MCP; built-in copilot not yet available', 'Notion AI (plan-dependent)'],
      ['Best at', 'Explaining data with charts and notes together', 'Team documentation, wikis, and project tracking'],
    ],
    faqs: [
      { q: 'Can SheetCanvas replace Notion?', a: 'No. SheetCanvas is an analysis canvas, not a wiki, task manager, or team workspace. Use it alongside Notion when you need spreadsheet-style analysis.' },
      { q: 'Can I put SheetCanvas charts on a web page?', a: 'Yes. SheetCanvas can publish a note or page to a public link and generate embed code for individual charts or pages.' },
      { q: 'Does SheetCanvas have notes?', a: 'Yes. Rich-text notes, including Mermaid diagrams, sit on the canvas next to the tables and charts they describe.' },
    ],
    related: '/learn/',
  },
  {
    slug: 'sheetcanvas-vs-tableau',
    competitor: 'Tableau',
    competitorFull: 'Tableau',
    title: 'SheetCanvas vs Tableau: which is better for dashboards?',
    description: 'An honest, dated comparison of SheetCanvas and Tableau for building dashboards, from quick ad-hoc analysis to governed enterprise BI.',
    question: 'Which is better for building dashboards, SheetCanvas or Tableau?',
    answer: [
      'It depends on scale and governance. Choose Tableau when an organization needs governed, reusable dashboards over many data sources, row-level security, scheduled extracts, and a team of analysts publishing to many viewers; it is a mature enterprise BI platform. Choose SheetCanvas for quick, ad-hoc analysis: drop in a CSV or connect ClickHouse, Google Sheets, or GA4, place the source table, charts, pivots, and notes on one canvas, and optionally let an AI agent build it over MCP, without setting up a BI server. SheetCanvas does not offer Tableau-level governance, data modeling, or visual-encoding depth.',
    ],
    rows: [
      ['Core model', 'Canvas of spreadsheets, charts, pivots, notes, diagrams', 'Worksheets, dashboards, and stories on a governed data model'],
      ['Setup', 'Free; open in the browser, no account needed', 'Desktop or cloud authoring plus server/cloud for sharing'],
      ['Data sources', 'CSV, XLSX, XLS; ClickHouse, Google Sheets, GA4', 'Very broad native connector catalog'],
      ['Visualization depth', 'Common chart types for exploration', 'Advanced visual grammar, calculated fields, LOD expressions'],
      ['Governance', 'None beyond your own workspace', 'Permissions, row-level security, certified data sources'],
      ['AI assistance', 'Bring your own agent (Claude, Codex) via MCP; built-in copilot not yet available', 'Tableau AI features (edition-dependent)'],
      ['Best at', 'Fast, ad-hoc analysis with notes beside the data', 'Organization-wide, governed BI'],
    ],
    faqs: [
      { q: 'Is SheetCanvas a BI tool?', a: 'It is a lightweight analysis canvas, not an enterprise BI platform. It suits individual or small-team analysis; it does not provide row-level security or certified data sources.' },
      { q: 'Can SheetCanvas connect to a data warehouse?', a: 'As of October 2026, SheetCanvas connects to ClickHouse, plus Google Sheets and Google Analytics 4. Other warehouses are not supported.' },
      { q: 'When should I choose Tableau?', a: 'Choose Tableau when many people need the same governed dashboards, when you need many native data connectors, or when visual analysis depth matters more than setup speed.' },
    ],
    related: '/use-cases/data-analysis-canvas/',
  },
].map((page) => ({ ...page, sheetcanvas: SC }));
