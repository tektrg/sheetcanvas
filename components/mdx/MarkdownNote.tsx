import React, { useMemo } from 'react';
import Markdown, { MarkdownToJSX } from 'markdown-to-jsx';
import { CellValue } from './CellValue';
import { CanvasChart } from './CanvasChart';
import { Sparkline } from './Sparkline';

// The whitelist of live components an MDX-lite note may embed. Anything else that
// looks like a component (a capitalized tag) renders as inert text — no
// user-supplied code ever executes. This IS the security model.
const WHITELIST_COMPONENTS = new Set(['CellValue', 'CanvasChart', 'Sparkline']);

// HTML tags allowed through the renderer: what markdown itself emits, plus the
// handful of inline formatters legacy sticky-notes carried. Unknown/dangerous
// tags are dropped (children kept). markdown-to-jsx's `tagfilter` (on by default)
// additionally escapes script/iframe/style/etc.
const ALLOWED_HTML_TAGS = new Set([
  'p', 'br', 'hr', 'span', 'div', 'strong', 'b', 'em', 'i', 'u', 's', 'del', 'mark',
  'small', 'sub', 'sup', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li',
  'blockquote', 'pre', 'code', 'a', 'img', 'table', 'thead', 'tbody', 'tr', 'th',
  'td', 'figure', 'figcaption',
]);

// Custom JSX factory giving us the inert-by-default guarantee.
const createElement: MarkdownToJSX.Options['createElement'] = (tag, props, ...children) => {
  // Whitelisted live components arrive already resolved to a function via `overrides`.
  if (typeof tag !== 'string') {
    return React.createElement(tag, props, ...children);
  }
  // Preserve the list key markdown-to-jsx supplies via props so inert branches
  // don't trip React's "unique key" warning when they sit among siblings.
  const key = (props as { key?: React.Key } | null)?.key;
  // A component-looking tag that is not whitelisted → show it inert, as text.
  if (/^[A-Z]/.test(tag) && !WHITELIST_COMPONENTS.has(tag)) {
    return React.createElement('span', { key, className: 'mdx-inert text-neutral-400' }, `<${tag}>`);
  }
  // A disallowed HTML tag → strip the tag but keep its text content.
  if (!ALLOWED_HTML_TAGS.has(tag.toLowerCase())) {
    return React.createElement(React.Fragment, { key }, ...children);
  }
  // Allowed HTML tag: scrub any event-handler attributes (onClick/onerror/…)
  // before rendering. React already ignores raw HTML handlers, but stripping
  // them at the source keeps the DOM clean and the "no code execution" model
  // explicit rather than incidental.
  const safeProps = props
    ? Object.fromEntries(Object.entries(props).filter(([name]) => !/^on/i.test(name)))
    : props;
  return React.createElement(tag, safeProps, ...children);
};

interface MarkdownNoteProps {
  content: string;
  darkMode?: boolean;
}

/**
 * Renders an MDX-lite note: standard Markdown plus a fixed whitelist of live,
 * data-bound components. Single entry point used by NoteNode's display path.
 */
export const MarkdownNote: React.FC<MarkdownNoteProps> = ({ content, darkMode }) => {
  const options = useMemo<MarkdownToJSX.Options>(
    () => ({
      forceBlock: true,
      createElement,
      overrides: {
        CellValue: { component: CellValue },
        CanvasChart: { component: CanvasChart, props: { darkMode } },
        Sparkline: { component: Sparkline },
      },
    }),
    [darkMode]
  );

  return (
    <div className="mdx-note-content w-full h-full overflow-auto">
      <Markdown options={options}>{content || ''}</Markdown>
    </div>
  );
};
