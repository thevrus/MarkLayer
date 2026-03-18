/** Relative time using Intl.RelativeTimeFormat */
const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto', style: 'narrow' });

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 31_536_000],
  ['month', 2_592_000],
  ['week', 604_800],
  ['day', 86_400],
  ['hour', 3_600],
  ['minute', 60],
  ['second', 1],
];

export function timeAgo(ts: number): string {
  const diff = Math.round((ts - Date.now()) / 1000);
  for (const [unit, secs] of UNITS) {
    if (Math.abs(diff) >= secs || unit === 'second') {
      return rtf.format(Math.round(diff / secs), unit);
    }
  }
  return 'just now';
}
