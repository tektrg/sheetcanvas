# 202605281735 Wrangler Pages deploy path

Production deploy = `npm run deploy:pages`, which runs `npm run seo:audit && wrangler pages deploy dist --project-name sheetcanvas --branch main`.

Cloudflare Pages project: **`sheetcanvas`**, serving `sheetcanvas.pages.dev`, `sheetcanvas.com`, `www.sheetcanvas.com`. The `--branch main` value is locked: `scripts/seo-audit.mjs` enforces the exact `deploy:pages` command string, so branch/project/dist drift fails before deploy.

## Why
Earlier attempts used Vercel; user clarified the canonical path is Wrangler Pages. The audit gate exists because the support-page SEO surface is large enough that silent metadata/sitemap drift is the real shipping risk.

## How to apply
- Never suggest Vercel, `git push` to a Pages-connected branch, or bypassing the audit.
- If `npm run seo:audit` fails, fix it — don't deploy around it.
- Post-deploy, smoke check `https://sheetcanvas.com/`, `/sitemap.xml`, `/rss.xml`, and any newly added static route.
- Backend deploys are a separate Worker (under `backend/`), not part of `deploy:pages`.

## Links
- [[Resources/architecture/202605281734-product-overview]]
- [[Areas/seo/202605281736-seo-operating-model]]
