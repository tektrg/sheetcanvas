// Embed contract shared by the backend (/e/*, /oembed) and the frontend Embed
// dialog: URL shapes, theme values and the iframe snippet. Embeds run zero JS,
// so the iframe cannot auto-size; these default heights fit typical content.

export const EMBED_THEMES = ['auto', 'light', 'dark'] as const;
export type EmbedTheme = (typeof EMBED_THEMES)[number];

export const EMBED_DEFAULT_WIDTH = 760;
export const EMBED_DEFAULT_HEIGHT = { page: 800, chart: 420 } as const;

export type EmbedTarget = { kind: 'page'; pageId: string } | { kind: 'chart'; pageId: string; chartIndex: number };

export interface EmbedOptions {
  theme?: EmbedTheme;
  hideData?: boolean;
}

export const parseEmbedTheme = (value: string | null | undefined): EmbedTheme =>
  (EMBED_THEMES as readonly string[]).includes(value ?? '') ? (value as EmbedTheme) : 'auto';

/** Path + query of an embed, e.g. "/e/c/abc123/0?theme=dark&data=0". Defaults are omitted. */
export const embedPath = (target: EmbedTarget, options: EmbedOptions = {}): string => {
  const id = encodeURIComponent(target.pageId);
  const path = target.kind === 'page' ? `/e/p/${id}` : `/e/c/${id}/${target.chartIndex}`;
  const query = new URLSearchParams();
  if (options.theme && options.theme !== 'auto') query.set('theme', options.theme);
  if (options.hideData) query.set('data', '0');
  const search = query.toString();
  return search ? `${path}?${search}` : path;
};

const escapeAttribute = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Responsive iframe snippet (full width, fixed height) for an absolute embed URL. */
export const embedIframeHtml = (src: string, title: string, height: number): string =>
  `<iframe src="${escapeAttribute(src)}" title="${escapeAttribute(title)}" width="100%" height="${height}" style="border:0;max-width:100%" loading="lazy"></iframe>`;
