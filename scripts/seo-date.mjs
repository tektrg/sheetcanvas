export function isStrictIsoDate(dateValue) {
  if (typeof dateValue !== 'string') {
    return false;
  }

  const match = dateValue.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return false;
  }

  const [, year, month, day] = match;
  const parsed = new Date(`${dateValue}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime())
    && parsed.getUTCFullYear() === Number(year)
    && parsed.getUTCMonth() + 1 === Number(month)
    && parsed.getUTCDate() === Number(day);
}

export function assertStrictIsoDate(dateValue, contextLabel) {
  if (!isStrictIsoDate(dateValue)) {
    throw new Error(`${contextLabel} must be a valid YYYY-MM-DD calendar date.`);
  }
}

export function reviewedDateLabel(dateValue) {
  if (!isStrictIsoDate(dateValue)) {
    return '';
  }

  const parsed = new Date(`${dateValue}T00:00:00.000Z`);
  return new Intl.DateTimeFormat('en-US', {
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
    year: 'numeric',
  }).format(parsed);
}

export function toRssDate(dateValue) {
  if (!isStrictIsoDate(dateValue)) {
    return '';
  }

  const parsed = new Date(`${dateValue}T00:00:00.000Z`);
  return parsed.toUTCString();
}
