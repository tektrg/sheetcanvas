export interface DateAnchors {
  today: string;
  yesterday: string;
  daysAgo7: string;
  daysAgo30: string;
  daysAgo90: string;
  monthStart: string;
  quarterStart: string;
  yearStart: string;
}

function pad(n: number): string {
  return n.toString().padStart(2, '0');
}

function fmt(d: Date): string {
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

function sub(d: Date, days: number): Date {
  const r = new Date(d.getTime());
  r.setDate(r.getDate() - days);
  return r;
}

export function computeDateAnchors(nowIso: string): DateAnchors {
  const now = new Date(nowIso);
  const quarter = Math.floor(now.getMonth() / 3);
  return {
    today: fmt(now),
    yesterday: fmt(sub(now, 1)),
    daysAgo7: fmt(sub(now, 7)),
    daysAgo30: fmt(sub(now, 30)),
    daysAgo90: fmt(sub(now, 90)),
    monthStart: now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-01',
    quarterStart: now.getFullYear() + '-' + pad(quarter * 3 + 1) + '-01',
    yearStart: now.getFullYear() + '-01-01',
  };
}
