"use client";

export type Cell = string | number | Date | null | undefined;

// SheetJS is ~150 kB, so it is only fetched when a file is actually read or written.
function loadXlsx() {
  return import("xlsx");
}

/** Write a real .xlsx workbook (one sheet) and hand it to the browser. */
export async function downloadXlsx(filename: string, sheetName: string, rows: Cell[][], widths?: number[]): Promise<void> {
  const XLSX = await loadXlsx();
  const ws = XLSX.utils.aoa_to_sheet(rows.map((r) => r.map((c) => (c instanceof Date ? c : c ?? ""))));
  if (widths?.length) ws["!cols"] = widths.map((w) => ({ wch: w }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31));
  XLSX.writeFile(wb, filename, { compression: true });
}

/** Same plumbing as the existing Export CSV button, kept here so both share one shape. */
export function downloadCsv(filename: string, rows: Cell[][]): void {
  const csv = rows
    .map((r) => r.map((c) => '"' + String(c == null ? "" : c).replace(/"/g, '""') + '"').join(","))
    .join("\r\n");
  const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

/**
 * Read a .csv / .xlsx / .xls file into a grid of cells.
 *
 * CSV is parsed here rather than by SheetJS so every cell stays text: the
 * library would guess 11/13/2026 as a US date while 13/11/2026 fails, and the
 * two readings of the same column must stay consistent (day-first, as typed).
 */
export async function readSpreadsheet(file: File): Promise<Cell[][]> {
  const looksCsv = /\.(csv|txt)$/i.test(file.name) || file.type === "text/csv" || file.type === "text/plain";
  if (looksCsv) return parseCsv(await file.text());
  const XLSX = await loadXlsx();
  const wb = XLSX.read(await file.arrayBuffer(), { cellDates: true });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet) return [];
  return XLSX.utils.sheet_to_json<Cell[]>(sheet, { header: 1, blankrows: false, defval: "", raw: true });
}

/** Minimal RFC-4180 CSV reader: quoted fields, doubled quotes, CRLF. */
export function parseCsv(text: string): string[][] {
  const clean = text.replace(/^\ufeff/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    if (inQuotes) {
      if (ch === '"') {
        if (clean[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && clean[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

/** Excel stores dates as day counts from 1899-12-30. */
function fromSerial(serial: number): string | null {
  if (!Number.isFinite(serial)) return null;
  const ms = Date.UTC(1899, 11, 30) + Math.round(serial) * 86400000;
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return null;
  return isoOf(d);
}

function isoOf(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Accepts Date cells, Excel serials, YYYY-MM-DD and DD/MM/YYYY. Returns an ISO day. */
export function parseDateCell(value: Cell): string | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : isoOf(value);
  if (typeof value === "number") return fromSerial(value);
  const raw = String(value ?? "").trim();
  if (!raw) return null;

  const iso = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(raw);
  if (iso) {
    const [, y, m, d] = iso;
    const date = new Date(Number(y), Number(m) - 1, Number(d));
    return date.getFullYear() === Number(y) && date.getMonth() === Number(m) - 1 && date.getDate() === Number(d) ? isoOf(date) : null;
  }

  // Day-first (this is a UAE books app): 14/11/2026 or 14-11-26.
  const dmy = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/.exec(raw);
  if (dmy) {
    const [, d, m, y] = dmy;
    const year = y.length === 2 ? 2000 + Number(y) : Number(y);
    const date = new Date(year, Number(m) - 1, Number(d));
    return date.getFullYear() === year && date.getMonth() === Number(m) - 1 && date.getDate() === Number(d) ? isoOf(date) : null;
  }
  return null;
}

/** Numbers only — strips AED, commas and spaces. Returns null when it is not a number. */
export function parseAmountCell(value: Cell): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? Math.abs(Math.round(value * 100) / 100) : null;
  const cleaned = String(value ?? "")
    .replace(/[^0-9.,-]/g, "")
    .replace(/,(?=\d{3}\b)/g, "")
    .trim();
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? Math.abs(Math.round(n * 100) / 100) : null;
}

export function parseKindCell(value: Cell): "income" | "expense" | null {
  const raw = String(value ?? "").trim().toLowerCase();
  if (!raw) return null;
  if (["income", "in", "credit", "receive", "received", "receipt", "sales", "earning"].includes(raw)) return "income";
  if (["expense", "out", "debit", "payment", "paid", "spend", "spent", "cost"].includes(raw)) return "expense";
  return null;
}

/** Header labels the importer understands, mapped to one canonical key. */
export const COLUMN_ALIASES: Record<string, string> = {
  date: "date",
  txndate: "date",
  day: "date",
  type: "type",
  kind: "type",
  inout: "type",
  incomeexpense: "type",
  amount: "amount",
  aed: "amount",
  value: "amount",
  total: "amount",
  category: "category",
  cat: "category",
  paymentmethod: "method",
  method: "method",
  paidby: "method",
  account: "method",
  party: "party",
  supplier: "party",
  client: "party",
  customer: "party",
  vendor: "party",
  name: "party",
  jobref: "job_ref",
  ref: "job_ref",
  job: "job_ref",
  voucher: "voucher_no",
  voucherno: "voucher_no",
  vouchernumber: "voucher_no",
  description: "description",
  desc: "description",
  details: "description",
  notes: "notes",
  note: "notes",
  remarks: "notes",
};

export function normalizeHeader(value: Cell): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}
