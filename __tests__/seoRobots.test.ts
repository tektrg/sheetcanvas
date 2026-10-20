import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { AI_CRAWLER_USER_AGENTS, auditRobotsTxt, buildRobotsTxt } from '../scripts/seo-ai-crawlers.mjs';

const ORIGIN = 'https://sheetcanvas.com';

describe('robots.txt', () => {
  const robots = readFileSync(new URL('../public/robots.txt', import.meta.url), 'utf8');

  it('is the generated content', () => {
    expect(robots).toBe(buildRobotsTxt({ siteOrigin: ORIGIN }));
  });

  it('explicitly allows every AI answer-engine crawler and keeps the sitemap', () => {
    expect(auditRobotsTxt(robots, ORIGIN)).toEqual([]);
    for (const agent of ['GPTBot', 'ClaudeBot', 'PerplexityBot', 'meta-externalagent', 'Google-Extended', 'Bingbot']) {
      expect(AI_CRAWLER_USER_AGENTS).toContain(agent);
      expect(robots).toMatch(new RegExp(`User-agent: ${agent}\\nAllow: /\\n`));
    }
    expect(robots).toContain(`Sitemap: ${ORIGIN}/sitemap-index.xml`);
  });

  it('flags a crawler that is missing or disallowed', () => {
    const blocked = robots.replace('User-agent: GPTBot\nAllow: /', 'User-agent: GPTBot\nDisallow: /');
    expect(auditRobotsTxt(blocked, ORIGIN)).toEqual(['robots.txt must Allow: / for GPTBot.']);
    expect(auditRobotsTxt(robots.replace(/User-agent: ClaudeBot\nAllow: \/\n\n/, ''), ORIGIN)).toEqual(['robots.txt must name ClaudeBot.']);
  });
});
