/**
 * All monetary values in Felt are stored as integer cents on the wire and in
 * state (so `stack: 1050` means $10.50). These helpers translate between that
 * canonical representation and human-facing decimal strings.
 */

export function formatMoney(cents: number): string {
  const negative = cents < 0;
  const abs = Math.abs(Math.round(cents));
  const dollars = Math.floor(abs / 100);
  const remainder = abs % 100;
  const dollarsStr = dollars.toLocaleString("en-US");
  const centsStr = remainder.toString().padStart(2, "0");
  return `${negative ? "-" : ""}$${dollarsStr}.${centsStr}`;
}

/**
 * Parse a decimal-dollar string (e.g. "10.50", "$0.10", "1,234.56") into integer
 * cents. Returns null on any malformed input.
 */
export function parseMoney(input: string): number | null {
  const trimmed = input.trim();
  if (trimmed.length === 0) return null;
  let s = trimmed;
  if (s.startsWith("$")) s = s.slice(1);
  s = s.replace(/,/g, "");
  if (!/^-?\d+(\.\d+)?$|^-?\.\d+$/.test(s)) return null;
  const num = Number(s);
  if (!Number.isFinite(num)) return null;
  return Math.round(num * 100);
}
