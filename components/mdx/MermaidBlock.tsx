import React from 'react';
import { MermaidDiagram } from '@tektrg/diagram-kit/react';
import { peleThemeCss } from '@tektrg/diagram-kit';
import { COLORS, COLORS_DARK } from '../../theme';

// Maps diagram-kit's --pele-* color vars onto SheetCanvas tokens. Keyed off the
// `.dark` ancestor class, so it follows the app theme and PortalThemeScope alike.
export const MERMAID_THEME_CSS = [
  peleThemeCss('.mdx-mermaid', {
    bg: 'transparent', fg: '#262626', muted: '#737373', line: '#a3a3a3',
    surface: '#ffffff', 'surface-alt': '#f5f5f5', border: '#d4d4d4',
    accent: `var(--color-accent, ${COLORS.accent})`, critical: '#dc2626', error: '#dc2626',
  }),
  peleThemeCss('.dark .mdx-mermaid', {
    fg: '#e5e5e5', muted: '#a3a3a3', line: '#737373',
    surface: '#262626', 'surface-alt': '#404040', border: '#525252',
    accent: `var(--color-accent, ${COLORS_DARK.accent})`, critical: '#f87171', error: '#f87171',
  }),
  '.mdx-mermaid .diagram-kit-error { font-size: 12px; color: #dc2626; border: 1px solid currentColor; border-radius: 4px; padding: 6px 8px; white-space: pre-wrap; }',
  '.dark .mdx-mermaid .diagram-kit-error { color: #f87171; }',
].join('\n');

/** Renders one ```mermaid fence. Default export so MarkdownNote can lazy-load it (keeps pele out of the main chunk). */
const MermaidBlock: React.FC<{ source: string }> = ({ source }) => (
  <div className="mdx-mermaid my-2">
    <style>{MERMAID_THEME_CSS}</style>
    <MermaidDiagram source={source} />
  </div>
);

export default MermaidBlock;
