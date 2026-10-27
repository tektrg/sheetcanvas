// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import { MarkdownNote } from '../MarkdownNote';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function render(content: string): Promise<HTMLElement> {
  const el = document.createElement('div');
  const root = createRoot(el);
  await act(async () => root.render(<MarkdownNote content={content} />));
  // Let the lazy MermaidBlock chunk resolve and commit.
  for (let i = 0; i < 5 && el.querySelector('pre code.language-mermaid, pre code.lang-mermaid'); i++) {
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
  }
  return el;
}

describe('MarkdownNote mermaid fences', () => {
  it('renders a valid ```mermaid block as an svg diagram', async () => {
    const el = await render('# Flow\n\n```mermaid\nflowchart LR\n  A --> B\n```\n');
    expect(el.querySelector('.mdx-mermaid .diagram-kit-diagram svg')).not.toBeNull();
    expect(el.querySelector('pre')).toBeNull();
  });

  it('shows the error box for invalid mermaid', async () => {
    const el = await render('```mermaid\nflowchart LR\n  A -->[\n```\n');
    expect(el.querySelector('.mdx-mermaid [role="alert"].diagram-kit-error')?.textContent).toMatch(/Diagram error/);
  });

  it('leaves other code blocks unchanged', async () => {
    const el = await render('```js\nconst a = 1;\n```\n');
    expect(el.querySelector('.mdx-mermaid')).toBeNull();
    expect(el.querySelector('pre > code')?.textContent).toContain('const a = 1;');
  });
});
