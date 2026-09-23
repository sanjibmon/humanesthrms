/** Indian Rupee everywhere for money. Never a dollar sign. */
export const RS = '₹';

export const inr = (n: number | null | undefined) =>
  RS + Math.round(Number(n) || 0).toLocaleString('en-IN');

export function inrShort(n: number | null | undefined) {
  const v = Number(n) || 0;
  if (v >= 1e7) return RS + (v / 1e7).toFixed(v % 1e7 ? 2 : 0) + 'Cr';
  if (v >= 1e5) return RS + (v / 1e5).toFixed(v % 1e5 ? 1 : 0) + 'L';
  if (v >= 1e3) return RS + Math.round(v / 1e3) + 'k';
  return RS + v;
}

/** Plan prices are stored in paise, exclusive of GST. */
export const paiseToInr = (paise: number) => inr((Number(paise) || 0) / 100);

export const dateLabel = (iso: string | null | undefined) =>
  iso
    ? new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
    : '—';

export const daysLeft = (iso: string | null | undefined) =>
  iso ? Math.ceil((Date.parse(iso) - Date.now()) / 864e5) : null;

export const initial = (s: string | null | undefined) =>
  (String(s || '?').trim()[0] || '?').toUpperCase();
