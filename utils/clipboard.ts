
export const parseCSVLine = (text: string, separator: string): string[] => {
  const res: string[] = [];
  let current = '';
  let inQuote = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') {
      if (inQuote && text[i + 1] === '"') {
         // Escaped quote
         current += '"';
         i++;
      } else {
         inQuote = !inQuote;
      }
    } else if (char === separator && !inQuote) {
      res.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  res.push(current);
  return res;
};

const parseMarkdownTable = (text: string): string[][] | null => {
  const lines = text.split(/\r\n|\n|\r/).filter(line => line.trim() !== '');
  if (lines.length === 0 || !text.includes('|')) return null;

  const matrix: string[][] = [];
  let hasSeparator = false;

  for (const line of lines) {
    const trimmed = line.trim();
    
    // Check for separator line (e.g. |---|---| or ---|---)
    // It usually consists only of |, -, :, and spaces
    if (/^[\s|:-]+$/.test(trimmed) && trimmed.includes('-')) {
        hasSeparator = true;
        continue;
    }

    // Split by pipe
    const parts = trimmed.split('|');
    
    // If the line starts with a pipe, the first element is empty string before the pipe
    if (trimmed.startsWith('|')) {
        parts.shift();
    }
    // If the line ends with a pipe, the last element is empty string after the pipe
    if (trimmed.endsWith('|')) {
        parts.pop();
    }
    
    matrix.push(parts.map(p => p.trim()));
  }

  // If we found a separator line, it's definitely a markdown table (or intended as one)
  if (hasSeparator) return matrix;

  // If no separator line was found, we need to be careful.
  // If the text contains tabs, it is likely TSV (Excel copy), so we shouldn't treat pipes as separators
  // unless explicitly formatted as markdown.
  if (text.includes('\t')) return null;

  // If there are no tabs, but there are pipes creating multiple columns, treat as pipe-separated values
  if (matrix.some(r => r.length > 1)) return matrix;

  return null;
};

export const parseClipboardData = (text: string): string[][] => {
  if (!text) return [];

  // 1. Try Markdown Table parsing
  const mdMatrix = parseMarkdownTable(text);
  if (mdMatrix) return mdMatrix;

  // 2. Fallback to CSV/TSV parsing
  // Basic detection
  const hasTabs = text.includes('\t');
  const hasCommas = text.includes(',');

  // Preference: Tab (Excel/Sheets) > Comma (CSV)
  const separator = hasTabs ? '\t' : (hasCommas ? ',' : '\t');

  const rows = text.split(/\r\n|\n|\r/);
  
  // Remove trailing empty row often added by Excel/Sheets selection copy
  if (rows.length > 0 && rows[rows.length - 1].trim() === '') {
    rows.pop();
  }

  if (rows.length === 0) return [];

  return rows.map(row => {
    // If using commas or if quotes are detected, use the robust CSV parser
    if (separator === ',' || row.includes('"')) {
        return parseCSVLine(row, separator);
    }
    return row.split(separator);
  });
};
