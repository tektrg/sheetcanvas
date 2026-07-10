const METRIC_SUFFIX_PATTERN = /\s*\(([^()]+)\)\s*$/;
const DOMAIN_PATTERN = /^(https?:\/\/)?([a-z0-9-]+\.)+[a-z]{2,}(\/.*)?$/i;
const HASH_SUBDOMAIN_PATTERN = /^[a-f0-9]{6,}$/i;

const TITLE_CASE_EXCEPTIONS = new Set(['app', 'api', 'www']);

export type ChartLegendVisibility = 'visible' | 'hidden';

export function getChartLabelIconUrl(rawLabel: string): string | null {
  const domain = getChartLabelIconDomain(rawLabel);
  if (!domain) return null;
  return `https://www.google.com/s2/favicons?domain=${domain}&sz=64`;
}

export function getChartLabelIconDomain(rawLabel: string): string | null {
  return getDomainFromLabel(rawLabel);
}

export function normalizeChartSeriesLabel(rawLabel: string): string {
  const trimmedLabel = rawLabel.trim();
  if (!trimmedLabel) return 'Series';

  const labelWithoutMetric = trimmedLabel.replace(METRIC_SUFFIX_PATTERN, '').trim();
  if (!labelWithoutMetric) return trimmedLabel;
  if (labelWithoutMetric.startsWith('(') && labelWithoutMetric.endsWith(')')) {
    return labelWithoutMetric;
  }

  if (DOMAIN_PATTERN.test(labelWithoutMetric)) {
    return normalizeDomainLabel(labelWithoutMetric);
  }

  return compactLongLabel(labelWithoutMetric);
}

export function buildChartSeriesDisplayNames(
  entries: Array<{ key: string; label: string }>,
): Record<string, string> {
  const baseNames = entries.map(entry => normalizeChartSeriesLabel(entry.label));
  const duplicateCounts = baseNames.reduce<Record<string, number>>((counts, name) => {
    counts[name] = (counts[name] || 0) + 1;
    return counts;
  }, {});
  const seenCounts: Record<string, number> = {};

  return entries.reduce<Record<string, string>>((displayNames, entry, index) => {
    const baseName = baseNames[index];
    const count = duplicateCounts[baseName] || 0;
    if (count <= 1) {
      displayNames[entry.key] = baseName;
      return displayNames;
    }

    seenCounts[baseName] = (seenCounts[baseName] || 0) + 1;
    displayNames[entry.key] = `${baseName} ${seenCounts[baseName]}`;
    return displayNames;
  }, {});
}

export function getChartLegendVisibility(args: {
  labels: string[];
  chartWidth: number;
  chartHeight: number;
}): ChartLegendVisibility {
  const meaningfulLabels = args.labels.map(label => label.trim()).filter(Boolean);
  if (meaningfulLabels.length <= 1) return 'hidden';

  const availableWidth = Math.max(160, args.chartWidth - 48);
  const estimatedLegendWidth = meaningfulLabels.reduce(
    (sum, label) => sum + Math.min(180, label.length * 7 + 30),
    0,
  );
  const estimatedRows = Math.ceil(estimatedLegendWidth / availableWidth);
  const estimatedHeight = estimatedRows * 24;
  const maxLegendHeight = Math.max(56, args.chartHeight * 0.28);

  if (estimatedRows > 2 || estimatedHeight > maxLegendHeight) return 'hidden';
  return 'visible';
}

function normalizeDomainLabel(rawDomain: string): string {
  const host = getChartLabelIconDomain(rawDomain);
  if (!host) return compactLongLabel(rawDomain);
  const parts = host.split('.');
  const baseDomain = parts.length >= 2 ? parts.slice(-2).join('.') : host;
  const subdomainParts = parts.slice(0, -2).filter(part => part !== 'www');

  if (baseDomain === 'pages.dev' && subdomainParts.length > 0) {
    const projectPart = subdomainParts.find(part => !HASH_SUBDOMAIN_PATTERN.test(part)) || subdomainParts[0];
    return `${humanizeDomainPart(projectPart)} preview`;
  }

  if (subdomainParts.length === 1 && subdomainParts[0] === 'www') return baseDomain;
  return compactLongLabel(host);
}

function humanizeDomainPart(value: string): string {
  const normalizedValue = value.replace(/-website$/i, '');
  if (/^[a-z0-9]+app$/i.test(normalizedValue) && normalizedValue.length > 6) {
    return `${normalizedValue.slice(0, -3)}.app`;
  }

  return normalizedValue
    .split(/[-_]+/)
    .filter(Boolean)
    .map(part => (TITLE_CASE_EXCEPTIONS.has(part) ? part : part.charAt(0).toUpperCase() + part.slice(1)))
    .join(' ');
}

function compactLongLabel(label: string): string {
  if (label.length <= 28) return label;
  return `${label.slice(0, 25).trimEnd()}...`;
}

function getDomainFromLabel(rawLabel: string): string | null {
  if (!rawLabel || typeof rawLabel !== 'string') return null;
  const candidate = rawLabel.trim().replace(METRIC_SUFFIX_PATTERN, '').trim();
  if (!candidate || candidate.includes(' ')) return null;
  if (/^[\d.,-]+$/.test(candidate)) return null;
  if (!DOMAIN_PATTERN.test(candidate)) return null;
  return candidate.replace(/^https?:\/\//i, '').split('/')[0].toLowerCase();
}
