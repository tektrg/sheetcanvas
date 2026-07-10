// Small, dependency-free HTML→Markdown converter for migrating legacy sticky
// notes. Their HTML is simple — produced by contentEditable + document.execCommand
// (bold/italic/underline/lists) — so we only need to handle a limited tag set.
// The original HTML is always preserved on the note (legacyHtml) as a safety net,
// so this favours predictability over exhaustive fidelity.

const INLINE_WRAP: Record<string, string> = {
  B: '**',
  STRONG: '**',
  I: '*',
  EM: '*',
};

// Escape only characters that would otherwise be interpreted as Markdown
// structure. Deliberately narrow — legacy note text rarely contains these, and
// escaping every "." / "!" / "(" made migrated source needlessly noisy to edit.
const escapeMarkdown = (text: string): string =>
  text.replace(/([\\`*_{}\[\]#])/g, '\\$1');

const serializeChildren = (node: Node): string =>
  Array.from(node.childNodes).map(serializeNode).join('');

const serializeList = (element: Element, ordered: boolean): string => {
  const items = Array.from(element.children).filter(child => child.tagName === 'LI');
  const lines = items.map((item, index) => {
    const marker = ordered ? `${index + 1}.` : '-';
    return `${marker} ${serializeChildren(item).trim()}`;
  });
  return `\n${lines.join('\n')}\n`;
};

const serializeNode = (node: Node): string => {
  if (node.nodeType === Node.TEXT_NODE) {
    return escapeMarkdown(node.textContent ?? '');
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return '';

  const element = node as Element;
  const tag = element.tagName;

  switch (tag) {
    case 'BR':
      return '\n';
    case 'B':
    case 'STRONG':
    case 'I':
    case 'EM': {
      const inner = serializeChildren(element).trim();
      if (!inner) return '';
      const wrap = INLINE_WRAP[tag];
      return `${wrap}${inner}${wrap}`;
    }
    case 'U':
      // Markdown has no underline; keep it as an inline <u> tag (allowed by the renderer).
      return `<u>${serializeChildren(element).trim()}</u>`;
    case 'A': {
      const href = element.getAttribute('href') || '';
      const text = serializeChildren(element).trim() || href;
      return href ? `[${text}](${href})` : text;
    }
    case 'H1':
    case 'H2':
    case 'H3':
    case 'H4':
    case 'H5':
    case 'H6': {
      const level = Number(tag[1]);
      return `\n${'#'.repeat(level)} ${serializeChildren(element).trim()}\n`;
    }
    case 'UL':
      return serializeList(element, false);
    case 'OL':
      return serializeList(element, true);
    case 'LI':
      // Handled by serializeList; if orphaned, treat as a bullet.
      return `- ${serializeChildren(element).trim()}\n`;
    case 'P':
    case 'DIV': {
      const inner = serializeChildren(element).trim();
      return inner ? `\n${inner}\n` : '\n';
    }
    default:
      return serializeChildren(element);
  }
};

const collapseBlankLines = (markdown: string): string =>
  markdown
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+\n/g, '\n')
    .trim();

/**
 * Convert a legacy note's HTML string to Markdown. Returns an empty string for
 * empty/placeholder content. Any unexpected structure degrades gracefully to its
 * text content rather than throwing.
 */
export const htmlToMarkdown = (html: string): string => {
  if (!html) return '';
  const trimmed = html.trim();
  if (trimmed === '' || trimmed === '<br>') return '';

  // No markup at all — treat as plain text.
  if (!/[<]/.test(trimmed)) return trimmed;

  if (typeof DOMParser === 'undefined') {
    // Non-browser fallback: strip tags.
    return trimmed.replace(/<[^>]+>/g, '').trim();
  }

  try {
    const doc = new DOMParser().parseFromString(trimmed, 'text/html');
    return collapseBlankLines(serializeChildren(doc.body));
  } catch {
    return trimmed.replace(/<[^>]+>/g, '').trim();
  }
};
