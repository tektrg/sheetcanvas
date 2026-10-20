import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkExternalLinks, checkServerPages, extractLinks, findBrokenDistLinks, isWorkerPath } from '../scripts/seo-link-check.mjs';

const makeDist = () => {
  const root = mkdtempSync(join(tmpdir(), 'sc-linkcheck-'));
  mkdirSync(join(root, 'blog', 'post'), { recursive: true });
  writeFileSync(join(root, 'index.html'), '<a href="/blog/">Blog</a><a href="/missing/">x</a><a href="https://sheetcanvas.com/p/abc-123">page</a><a href="/app">app</a><a href="https://example.org/a#x">ext</a><a href="#top">top</a><a href="mailto:a@b.c">m</a>');
  writeFileSync(join(root, 'blog', 'index.html'), '<a href="post/">post</a><a href="../nope.html">bad</a>');
  writeFileSync(join(root, 'blog', 'post', 'index.html'), '<a href="/">home</a>');
  writeFileSync(join(root, '_redirects'), '/app / 301\n');
  return root;
};

const fakeFetch = (statusByUrl: Record<string, number>) => (async (url: string) => {
  const status = statusByUrl[url];
  if (status === undefined) throw new Error('network');
  return new Response(`<a href="/p/ok-1">ok</a><a href="/@ann">by</a><a href="/api/pages/1/report">r</a><a href="/blog/">static</a>`, { status });
}) as typeof fetch;

describe('seo link check', () => {
  it('classifies internal, external and ignorable hrefs relative to the page', () => {
    expect(extractLinks('<a href="post/">a</a><a href="https://www.sheetcanvas.com/x?y=1">b</a><a href="//cdn.example.com/z">c</a><a href="javascript:void 0">d</a>', '/blog/'))
      .toEqual({ internal: ['/blog/post/', '/x'], external: ['https://cdn.example.com/z'] });
    expect(isWorkerPath('/p/abc')).toBe(true);
    expect(isWorkerPath('/@ann')).toBe(true);
    expect(isWorkerPath('/pricing/')).toBe(false);
  });

  it('finds broken internal links in dist, skipping worker routes and honouring _redirects', () => {
    const { broken, external } = findBrokenDistLinks(makeDist());
    expect(broken).toEqual(expect.arrayContaining([{ page: '/', link: '/missing/' }, { page: '/blog/', link: '/nope.html' }]));
    expect(broken).toHaveLength(2);
    expect([...external.keys()]).toEqual(['https://example.org/a']);
  });

  it('reports failing or timed-out external links as warnings', async () => {
    const fetchImpl = fakeFetch({ 'https://ok.example/': 200, 'https://gone.example/': 404 });
    expect(await checkExternalLinks(['https://ok.example/', 'https://gone.example/', 'https://down.example/'], { fetchImpl }))
      .toEqual([{ url: 'https://gone.example/', status: 404 }, { url: 'https://down.example/', status: 0 }]);
  });

  it('checks internal worker links on sample server-rendered pages', async () => {
    const base = 'http://127.0.0.1:9';
    const fetchImpl = fakeFetch({ [`${base}/@ann`]: 200, [`${base}/p/ok-1`]: 200, [`${base}/api/pages/1/report`]: 500 });
    expect(await checkServerPages(base, ['/@ann'], { fetchImpl })).toEqual([{ page: '/@ann', link: '/api/pages/1/report', status: 500 }]);
  });
});
