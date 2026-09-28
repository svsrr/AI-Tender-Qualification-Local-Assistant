// Neutralizes CSV/formula injection: a leading =, +, -, or @ is interpreted as a
// formula by Excel/Sheets when the cell is opened, so prefix those with a quote.
export function csvCell(raw: unknown): string {
  let str = raw === null || raw === undefined ? '' : String(raw);
  if (/^[=+\-@]/.test(str)) str = `'${str}`;
  return `"${str.replace(/"/g, '""')}"`;
}
