import { describe, expect, it } from 'vitest';
import {
  buildChartSeriesDisplayNames,
  getChartLabelIconDomain,
  getChartLabelIconUrl,
  getChartLegendVisibility,
  normalizeChartSeriesLabel,
} from '../chartDisplay';

describe('chartDisplay', () => {
  it('normalizes noisy analytics source labels for chart legends', () => {
    expect(normalizeChartSeriesLabel('(direct) (sessions)')).toBe('(direct)');
    expect(normalizeChartSeriesLabel('t.co (sessions)')).toBe('t.co');
    expect(normalizeChartSeriesLabel('47162e2d.theindieapp-website.pages.dev (sessions)')).toBe('theindie.app preview');
  });

  it('resolves favicon URLs from raw domain labels without changing readable labels', () => {
    expect(getChartLabelIconDomain('t.co (sessions)')).toBe('t.co');
    expect(getChartLabelIconDomain('https://example.com/path (users)')).toBe('example.com');
    expect(getChartLabelIconUrl('t.co (sessions)')).toBe('https://www.google.com/s2/favicons?domain=t.co&sz=64');
    expect(getChartLabelIconUrl('https://example.com/path (users)')).toBe('https://www.google.com/s2/favicons?domain=example.com&sz=64');
    expect(getChartLabelIconUrl('theindie.app preview')).toBeNull();
    expect(getChartLabelIconUrl('1.25')).toBeNull();
  });

  it('keeps normalized duplicate source labels distinct', () => {
    expect(
      buildChartSeriesDisplayNames([
        { key: 'B', label: '(direct) (sessions)' },
        { key: 'C', label: '47162e2d.theindieapp-website.pages.dev (sessions)' },
        { key: 'D', label: '9786f437.theindieapp-website.pages.dev (sessions)' },
        { key: 'E', label: 't.co (sessions)' },
      ]),
    ).toEqual({
      B: '(direct)',
      C: 'theindie.app preview 1',
      D: 'theindie.app preview 2',
      E: 't.co',
    });
  });

  it('hides legends when labels would dominate the dashboard tile', () => {
    expect(
      getChartLegendVisibility({
        labels: ['(direct)', 'theindie.app preview 1', 'theindie.app preview 2', 't.co'],
        chartWidth: 400,
        chartHeight: 400,
      }),
    ).toBe('visible');

    expect(
      getChartLegendVisibility({
        labels: [
          '47162e2d.theindieapp-website.pages.dev (sessions)',
          '9786f437.theindieapp-website.pages.dev (sessions)',
          'd5844796.theindieapp-website.pages.dev (sessions)',
          'an extremely long source name that should never consume the tile',
          'another extremely long source name that should never consume the tile',
        ],
        chartWidth: 400,
        chartHeight: 400,
      }),
    ).toBe('hidden');
  });
});
