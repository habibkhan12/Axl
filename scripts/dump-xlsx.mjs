/**
 * Dump every sheet of the three production workbooks as JSON so we can map
 * columns → Supabase tables. Run: node scripts/dump-xlsx.mjs
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
  const wb = XLSX.readFile(f, { cellDates: true });
  const name = f.split("/").pop().replace(/\.xlsx$/i, "");
  const out = {};
  for (const sheetName of wb.SheetNames) {
    out[sheetName] = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { defval: null, raw: false });
  }
  writeFileSync(`scripts/dump-${name}.json`, JSON.stringify(out, null, 2));
  console.log(name, "→", wb.SheetNames.map((s) => `${s} (${out[s].length} rows)`).join(", "));
}
