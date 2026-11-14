"use client";
import React, { useRef, useState } from "react";
import { CheckCircle2, Download, FileSpreadsheet, Upload } from "lucide-react";
import { Button, Modal, MicroLabel } from "@/components/ui";
import { useDb } from "@/lib/local-db";
import { activeUser, addTransaction, uid } from "@/lib/repo";
import { COLUMN_ALIASES, downloadXlsx, normalizeHeader, parseAmountCell, parseDateCell, parseKindCell, readSpreadsheet, type Cell } from "@/lib/spreadsheet";
import { fmtAED } from "@/lib/format";
import type { Database, Party } from "@/lib/types";

/** Exactly the columns the importer looks for; every one but the first three is optional. */
const TEMPLATE_HEADER = ["Date", "Type", "Amount", "Category", "Payment Method", "Party", "Job Ref", "Voucher", "Description", "Notes"];

const TEMPLATE_ROWS: Cell[][] = [
  TEMPLATE_HEADER,
  ["2026-11-01", "expense", 250.5, "Fuel", "CASH", "ADNOC", "JOB-1042", "V-001", "Diesel for Hilux", ""],
  ["2026-11-03", "income", 1500, "General Income", "ADCB", "Al Noor Trading", "JOB-1043", "INV-220", "Site work payment", "Part payment"],
];

const COLUMN_HELP: { name: string; required: boolean; hint: string }[] = [
  { name: "Date", required: true, hint: "2026-11-14 or 14/11/2026" },
  { name: "Type", required: true, hint: "income or expense" },
  { name: "Amount", required: true, hint: "Number only — 1250.50" },
  { name: "Category", required: false, hint: "Fuel, Materials… (created if new)" },
  { name: "Payment Method", required: false, hint: "CASH, ADCB… must already exist" },
  { name: "Party", required: false, hint: "Supplier or client name (created if new)" },
  { name: "Job Ref", required: false, hint: "Free text" },
  { name: "Voucher", required: false, hint: "Free text" },
  { name: "Description", required: false, hint: "Free text" },
  { name: "Notes", required: false, hint: "Free text" },
];

type Parsed = {
  line: number;
  date: string;
  kind: "income" | "expense";
  amount: number;
  category: string;
  method: string;
  party: string;
  job_ref: string;
  voucher_no: string;
  description: string;
  notes: string;
};

type Rejected = { line: number; reason: string };

function textOf(cell: Cell): string {
  return String(cell instanceof Date ? "" : cell ?? "").trim();
}

function parseGrid(grid: Cell[][]): { rows: Parsed[]; rejected: Rejected[]; badHeader: boolean } {
  let headerIndex = -1;
  let map: Record<string, number> = {};
  for (let i = 0; i < Math.min(grid.length, 10); i++) {
    const found: Record<string, number> = {};
    grid[i].forEach((cell, idx) => {
      const key = COLUMN_ALIASES[normalizeHeader(cell)];
      if (key && found[key] === undefined) found[key] = idx;
    });
    if (found.date !== undefined && found.type !== undefined && found.amount !== undefined) {
      headerIndex = i;
      map = found;
      break;
    }
  }
  if (headerIndex < 0) return { rows: [], rejected: [], badHeader: true };

  const rows: Parsed[] = [];
  const rejected: Rejected[] = [];

  for (let i = headerIndex + 1; i < grid.length; i++) {
    const raw = grid[i];
    if (!raw || raw.every((c) => textOf(c) === "")) continue;
    const line = i + 1; // 1-based, matches what Excel shows
    const at = (key: string) => (map[key] === undefined ? "" : raw[map[key]]);

    const date = parseDateCell(at("date"));
    const kind = parseKindCell(at("type"));
    const amount = parseAmountCell(at("amount"));

    if (!date) {
      rejected.push({ line, reason: "Date not understood — use 2026-11-14 or 14/11/2026" });
      continue;
    }
    if (!kind) {
      rejected.push({ line, reason: "Type must be income or expense" });
      continue;
    }
    if (amount === null || amount <= 0) {
      rejected.push({ line, reason: "Amount must be a number above zero" });
      continue;
    }

    rows.push({
      line,
      date,
      kind,
      amount,
      category: textOf(at("category")),
      method: textOf(at("method")),
      party: textOf(at("party")),
      job_ref: textOf(at("job_ref")),
      voucher_no: textOf(at("voucher_no")),
      description: textOf(at("description")),
      notes: textOf(at("notes")),
    });
  }

  return { rows, rejected, badHeader: false };
}

/** Apply parsed rows onto the database, creating categories/parties by name as needed. */
function applyImport(db: Database, rows: Parsed[]): { db: Database; newCategories: string[]; newParties: string[] } {
  let next = db;
  const newCategories: string[] = [];
  const newParties: string[] = [];
  const author = activeUser(db)?.id ?? db.settings.active_user_id;

  for (const r of rows) {
    let categoryId: string | null = null;
    if (r.category) {
      const needle = r.category.toLowerCase();
      const match =
        next.categories.find((c) => !c.archived && c.kind === r.kind && c.name.trim().toLowerCase() === needle) ??
        next.categories.find((c) => !c.archived && c.name.trim().toLowerCase() === needle);
      if (match) categoryId = match.id;
      else {
        const name = r.category.replace(/\s+/g, " ");
        const created = { id: uid("c"), name, kind: r.kind };
        next = { ...next, categories: [...next.categories, created] };
        newCategories.push(name);
        categoryId = created.id;
      }
    }

    let methodId: string | null = null;
    if (r.method) {
      const needle = r.method.toLowerCase();
      methodId = next.payment_methods.find((m) => !m.archived && m.name.trim().toLowerCase() === needle)?.id ?? null;
    }

    let partyId: string | null = null;
    if (r.party) {
      const needle = r.party.trim().replace(/\s+/g, " ").toLowerCase();
      const existing = next.parties.find((p) => !p.archived && p.name.trim().toLowerCase() === needle);
      if (existing) partyId = existing.id;
      else {
        const party: Party = {
          id: uid("pt"),
          kind: r.kind === "income" ? "client" : "supplier",
          name: r.party.trim().replace(/\s+/g, " "),
          created_at: new Date().toISOString(),
        };
        next = { ...next, parties: [...next.parties, party] };
        newParties.push(party.name);
        partyId = party.id;
      }
    }

    next = addTransaction(next, {
      kind: r.kind,
      txn_date: r.date,
      amount: r.amount,
      category_id: categoryId,
      payment_method_id: methodId,
      party_id: partyId,
      job_ref: r.job_ref || null,
      voucher_no: r.voucher_no || null,
      description: r.description || null,
      notes: r.notes || null,
      created_by: author,
    });
  }

  return { db: next, newCategories, newParties };
}

export function ImportTransactionsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { db, setDb } = useDb();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [rows, setRows] = useState<Parsed[]>([]);
  const [rejected, setRejected] = useState<Rejected[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ added: number; categories: string[]; parties: string[] } | null>(null);

  function reset() {
    setFileName(null);
    setRows([]);
    setRejected([]);
    setError(null);
    setResult(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  async function pick(file: File | null) {
    if (!file) return;
    setBusy(true);
    setError(null);
    setResult(null);
    setRows([]);
    setRejected([]);
    setFileName(file.name);
    try {
      const grid = await readSpreadsheet(file);
      const parsed = parseGrid(grid);
      if (parsed.badHeader) {
        setError("Could not find the heading row. The sheet needs at least Date, Type and Amount headings — download the format below and keep its first row.");
      } else if (parsed.rows.length === 0 && parsed.rejected.length === 0) {
        setError("That file has no data rows under the headings.");
      } else {
        setRows(parsed.rows);
        setRejected(parsed.rejected);
      }
    } catch {
      setError("Could not read that file. Save it as .xlsx or .csv and try again.");
    }
    setBusy(false);
  }

  function runImport() {
    if (rows.length === 0) return;
    let summary = { added: 0, categories: [] as string[], parties: [] as string[] };
    setDb((prev) => {
      if (!prev) return prev;
      const applied = applyImport(prev, rows);
      summary = { added: rows.length, categories: applied.newCategories, parties: applied.newParties };
      return applied.db;
    });
    setResult(summary);
    setRows([]);
  }

  const sample = rows.slice(0, 6);

  return (
    <Modal open={open} onClose={() => { reset(); onClose(); }} title="Import data" wide>
      {result ? (
        <div className="space-y-3">
          <div className="flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5">
            <CheckCircle2 size={15} className="mt-0.5 shrink-0 text-emerald-600" />
            <div className="text-[12px] text-emerald-800">
              <p className="font-semibold">{result.added} {result.added === 1 ? "entry" : "entries"} imported.</p>
              {result.categories.length > 0 ? <p className="mt-1">New categories: {result.categories.join(", ")}</p> : null}
              {result.parties.length > 0 ? <p className="mt-1">New parties: {result.parties.join(", ")}</p> : null}
              {rejected.length > 0 ? <p className="mt-1 text-amber-700">{rejected.length} {rejected.length === 1 ? "row was" : "rows were"} skipped.</p> : null}
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button onClick={() => { reset(); }}>Import another file</Button>
            <Button variant="primary" onClick={() => { reset(); onClose(); }}>Done</Button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div>
            <p className="text-[13px] leading-relaxed text-zinc-600">
              Upload a <span className="font-medium text-zinc-900">CSV or Excel</span> file with one row per entry. The first row must be the column headings, in any order —
              every row becomes a transaction, so you can add a whole month in one go.
            </p>
          </div>

          <div className="rounded-xl border border-[#eae4d9] bg-[#fbfaf7] p-3">
            <MicroLabel className="mb-2">Columns</MicroLabel>
            <div className="grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-2">
              {COLUMN_HELP.map((c) => (
                <div key={c.name} className="flex items-baseline gap-1.5 text-[11px]">
                  <span className="font-medium text-zinc-800">{c.name}</span>
                  {c.required ? <span className="rounded bg-zinc-900 px-1 text-[9px] font-semibold uppercase text-white">Required</span> : null}
                  <span className="min-w-0 truncate text-zinc-400">{c.hint}</span>
                </div>
              ))}
            </div>
          </div>

          <ul className="list-disc space-y-1 pl-4 text-[11px] leading-relaxed text-zinc-500">
            <li>Dates: <span className="text-zinc-700">2026-11-14</span> or <span className="text-zinc-700">14/11/2026</span>. Amounts: numbers without a currency symbol.</li>
            <li>Categories you name that don&apos;t exist yet are created. Payment methods must already exist in Settings.</li>
            <li>Parties that don&apos;t exist are created as a supplier (expense) or client (income).</li>
            <li>Rows with a bad date, type or amount are skipped and listed with their line number.</li>
          </ul>

          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={() => void downloadXlsx("axl-import-template.xlsx", "Transactions", TEMPLATE_ROWS, [12, 10, 10, 16, 16, 18, 12, 12, 28, 20])}>
              <Download size={13} /> Download format
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="hidden"
              onChange={(e) => void pick(e.target.files?.[0] ?? null)}
            />
            <Button onClick={() => fileRef.current?.click()} disabled={busy}>
              <Upload size={13} /> {busy ? "Reading…" : "Choose file"}
            </Button>
            {fileName ? <span className="truncate text-[11px] text-zinc-400">{fileName}</span> : null}
          </div>

          {error ? <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[11px] text-red-700">{error}</p> : null}

          {rows.length > 0 ? (
            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <MicroLabel>Preview — {rows.length} ready to import</MicroLabel>
                {rejected.length > 0 ? <span className="text-[10px] font-medium text-amber-700">{rejected.length} will be skipped</span> : null}
              </div>
              <div className="overflow-x-auto rounded-xl border border-[#eae4d9]">
                <table className="w-full min-w-[520px] text-[11px]">
                  <thead className="bg-[#faf8f4] text-left text-[10px] uppercase tracking-wide text-zinc-400">
                    <tr>
                      <th className="px-2 py-1.5">Line</th>
                      <th className="px-2 py-1.5">Date</th>
                      <th className="px-2 py-1.5">Type</th>
                      <th className="px-2 py-1.5 text-right">Amount</th>
                      <th className="px-2 py-1.5">Category</th>
                      <th className="px-2 py-1.5">Party</th>
                      <th className="px-2 py-1.5">Description</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sample.map((r) => (
                      <tr key={r.line} className="border-t border-[#f1f1ef] text-zinc-700">
                        <td className="px-2 py-1.5 text-zinc-400">{r.line}</td>
                        <td className="whitespace-nowrap px-2 py-1.5">{r.date}</td>
                        <td className="px-2 py-1.5">
                          <span className={"rounded px-1.5 py-0.5 text-[10px] font-medium " + (r.kind === "income" ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700")}>{r.kind}</span>
                        </td>
                        <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums">{fmtAED(r.amount)}</td>
                        <td className="max-w-[120px] truncate px-2 py-1.5">{r.category || "—"}</td>
                        <td className="max-w-[120px] truncate px-2 py-1.5">{r.party || "—"}</td>
                        <td className="max-w-[160px] truncate px-2 py-1.5">{r.description || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {rows.length > sample.length ? <p className="mt-1 text-[10px] text-zinc-400">Showing the first {sample.length} of {rows.length} rows.</p> : null}

              {rejected.length > 0 ? (
                <div className="mt-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2">
                  <p className="text-[11px] font-medium text-amber-800">These rows will be skipped:</p>
                  <ul className="mt-1 space-y-0.5">
                    {rejected.slice(0, 5).map((r) => (
                      <li key={r.line} className="text-[11px] text-amber-800">
                        Line {r.line}: {r.reason}
                      </li>
                    ))}
                  </ul>
                  {rejected.length > 5 ? <p className="mt-1 text-[10px] text-amber-700">…and {rejected.length - 5} more.</p> : null}
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="flex justify-end gap-2 border-t border-[#efefec] pt-3">
            <Button onClick={() => { reset(); onClose(); }}>Cancel</Button>
            <Button variant="primary" disabled={rows.length === 0 || busy} onClick={runImport}>
              <FileSpreadsheet size={13} /> Import {rows.length > 0 ? rows.length + (rows.length === 1 ? " entry" : " entries") : ""}
            </Button>
          </div>

          <p className="text-[10px] leading-relaxed text-zinc-300">
            Imported rows land in the same ledger as manual entries{db.transactions.length ? " (" + db.transactions.length + " already there)" : ""} and sync to Supabase like the rest.
          </p>
        </div>
      )}
    </Modal>
  );
}
