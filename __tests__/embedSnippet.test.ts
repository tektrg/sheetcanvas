import { describe, expect, it } from 'vitest';
import { embedIframeHtml, embedPath, parseEmbedTheme } from '../shared/embed';

describe('embed snippet contract', () => {
  it('builds paths, omitting defaults', () => {
    expect(embedPath({ kind: 'page', pageId: 'abc' })).toBe('/e/p/abc');
    expect(embedPath({ kind: 'chart', pageId: 'abc', chartIndex: 2 }, { theme: 'dark', hideData: true })).toBe('/e/c/abc/2?theme=dark&data=0');
    expect(embedPath({ kind: 'page', pageId: 'abc' }, { theme: 'auto', hideData: false })).toBe('/e/p/abc');
  });

  it('falls back to auto for unknown themes', () => {
    expect(parseEmbedTheme('INJECTED')).toBe('auto');
    expect(parseEmbedTheme(null)).toBe('auto');
    expect(parseEmbedTheme('light')).toBe('light');
  });

  it('escapes the title in the iframe snippet', () => {
    const html = embedIframeHtml('https://sheetcanvas.com/e/p/abc', '"><b>INJECTED</b>', 420);
    expect(html).not.toContain('<b>');
    expect(html).toContain('height="420"');
  });
});
