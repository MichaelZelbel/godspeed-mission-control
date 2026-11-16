export const NOTEBOOK_DAILY_ROWS_MAX_BYTES = 20 * 1024;

export function notebookDailyRows(text) {
  if (!text || Buffer.byteLength(text) > NOTEBOOK_DAILY_ROWS_MAX_BYTES) return undefined;
  try {
    const rows = JSON.parse(text);
    return Array.isArray(rows) && rows.every((row) => row && typeof row === "object" && !Array.isArray(row) && typeof row.date === "string") ? rows : undefined;
  } catch {
    return undefined;
  }
}
