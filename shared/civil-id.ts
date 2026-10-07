// Kuwaiti civil ID (12 digits): C YY MM DD NNNN K — C is the century of birth (1 → 18xx, 2 → 19xx, 3 → 20xx),
// then the birth date, a serial and a check digit (weights 2 1 6 3 7 9 10 5 8 4 2, mod 11).
// Same rules as django-localflavor's kw validator. The date of birth is taken from it, so age is never typed.
const CENTURY: Record<string, number> = { "1": 1800, "2": 1900, "3": 2000 };
const WEIGHTS = [2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2];

export function civilIdBirthDate(cid: string | null | undefined): string | null {
  if (!cid || !/^\d{12}$/.test(cid) || !CENTURY[cid[0]]) return null;
  const y = CENTURY[cid[0]] + Number(cid.slice(1, 3)), m = Number(cid.slice(3, 5)), d = Number(cid.slice(5, 7));
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return dt.toISOString().slice(0, 10);
}

export function civilIdCheckDigitOk(cid: string): boolean {
  if (!/^\d{12}$/.test(cid)) return false;
  const sum = WEIGHTS.reduce((s, w, i) => s + w * Number(cid[i]), 0);
  return 11 - (sum % 11) === Number(cid[11]);
}
