// AI answer-engine + search crawlers that robots.txt names explicitly (Allow: /),
// so published pages (/p/, /@) stay quotable. Single source for robots.txt
// generation, seo-audit and tests.
export const AI_CRAWLER_USER_AGENTS = [
  'meta-webindexer',
  'meta-externalagent',
  'GPTBot',
  'OAI-SearchBot',
  'ChatGPT-User',
  'ClaudeBot',
  'Claude-SearchBot',
  'Claude-User',
  'PerplexityBot',
  'Perplexity-User',
  'Google-Extended',
  'Applebot-Extended',
  'Bingbot',
];

/** Each crawler gets its own group; a named group replaces `*`, so it must carry the same rules. */
export function buildRobotsTxt({ siteOrigin, rules = ['Allow: /'] }) {
  const group = (agent) => [`User-agent: ${agent}`, ...rules].join('\n');
  return [
    group('*'),
    ...AI_CRAWLER_USER_AGENTS.map(group),
    `Sitemap: ${siteOrigin}/sitemap-index.xml`,
  ].join('\n\n') + '\n';
}

/** Problems with a robots.txt body (empty = ok). */
export function auditRobotsTxt(robots, siteOrigin) {
  const problems = [];
  const groups = robots.split(/\n\s*\n/);
  for (const agent of AI_CRAWLER_USER_AGENTS) {
    const block = groups.find((g) => g.split('\n').some((line) => line.trim().toLowerCase() === `user-agent: ${agent.toLowerCase()}`));
    if (!block) problems.push(`robots.txt must name ${agent}.`);
    else if (!/^Allow: \/$/m.test(block) || /^Disallow: \/$/m.test(block)) problems.push(`robots.txt must Allow: / for ${agent}.`);
  }
  if (!robots.includes(`Sitemap: ${siteOrigin}/sitemap-index.xml`)) problems.push('robots.txt must point at the sitemap index.');
  return problems;
}
