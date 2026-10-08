/**
 * Dump every sheet of the production workbooks with RAW values (no number
 * formatting) so account numbers survive. Run: node scripts/dump-xlsx-raw.mjs
 */
import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";
const XLSX = createRequire(import.meta.url)("xlsx");

const files = [
  "C:/Users/OK/Downloads/Data (1).xlsx",
  "C:/Users/OK/Downloads/Inc & Exp Oct 2026.xlsx",
  "C:/Users/OK/Downloads/Income___Expense__Sep_2026_-_Dashboard.xlsx",
];

for (const f of files) {
  const wb = XLSX.readFile(f, { cellDates: true, cellNF: false, cellText: false });
  const name = f.split("/").pop().replace(/\.xlsx$/i, "").replace(/[^a-zA-Z0-9_-]+/g, "_");
  const out = {};
  for (const sheetName of wb.SheetNames) {
    out[sheetName] = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { defval: null, raw: true });
  }
  writeFileSync(`scripts/raw-${name}.json`, JSON.stringify(out, null, 1));
  console.log(name, "→", wb.SheetNames.map((s) => `${s} (${out[s].length} rows)`).join(", "));
}
