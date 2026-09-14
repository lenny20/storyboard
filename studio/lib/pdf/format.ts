const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

function parts(value: string): { day: number; month: number; year: string } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value || '');
  if (!match) return null;
  return { day: Number(match[3]), month: Number(match[2]), year: match[1] };
}

/** `14 SEP 2026`, for the page footer. */
export function shortDate(value: string): string {
  const found = parts(value);
  if (!found) return '';
  const month = (MONTHS[found.month - 1] ?? '').slice(0, 3).toUpperCase();
  return `${found.day} ${month} ${found.year}`;
}

/** `14 September 2026`, for the cover meta line. */
export function longDate(value: string): string {
  const found = parts(value);
  if (!found) return '';
  return `${found.day} ${MONTHS[found.month - 1] ?? ''} ${found.year}`;
}

/** `2.39 : 1`. */
export function ratioLabel(ratio: number): string {
  if (!Number.isFinite(ratio) || ratio <= 0) return '';
  return `${String(Math.round(ratio * 1000) / 1000)} : 1`;
}

export function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

/** Joins the non-empty parts of a label with the spec's middle dot. */
export function joinParts(values: readonly string[]): string {
  return values
    .map((value) => (value ?? '').trim())
    .filter(Boolean)
    .join(' · ');
}
