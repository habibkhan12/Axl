"use client";
import { useEffect, useMemo, useState } from "react";
import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight, CarFront, Download, Hash, Plus, Receipt, Scale, Trash2, X } from "lucide-react";
import { useDb, useDbContext } from "@/lib/local-db";
import type { Transaction, Kind } from "@/lib/types";
// (canEdit comes from useDbContext)
import type { TransactionInput } from "@/lib/store";
import { updateTransaction } from "@/lib/repo";
import { rowsInRange, monthBounds, totalsOf } from "@/lib/analytics";
import { fmtAED, fmtDate, fmtDateShort, fmtTime, todayISO, monthLabel } from "@/lib/format";
import {
  Avatar,
  Button,
  Card,
  ConfirmDelete,
  EmptyState,
  Input,
  Label,
  Pill,
  SearchInput,
  Segmented,
  SelectMenu,
  SlideOver,
  SortGlyph,
  StatCard,
} from "@/components/ui";
import { PageHeader, useQuickEntry } from "@/components/app-shell";
import { MonthPicker } from "@/components/date-picker";

type SortKey = "date" | "amount";

export default function TransactionsPage() {
  const { db, setDb } = useDb();
  const { canWrite, canEdit } = useDbContext();
  // This page's edit actions need the transactions tab granted as editable.
  const canEditTxn = canWrite && canEdit("/transactions");
  const { openQuickEntry } = useQuickEntry();
  const nowYm = todayISO().slice(0, 7);

  const [kind, setKind] = useState<"all" | Kind>("all");
  const [ym, setYm] = useState(nowYm);
  const [categoryId, setCategoryId] = useState("");
  const [methodId, setMethodId] = useState("");
  const [q, setQ] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [sortAsc, setSortAsc] = useState(false);
  const [viewing, setViewing] = useState<Transaction | null>(null);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [flashId, setFlashId] = useState<string | null>(null);

  const from = monthBounds(ym).from;
  const to = monthBounds(ym).to;

  const nameOf = {
    category: (id: string | null | undefined) => db.categories.find((c) => c.id === id)?.name ?? "—",
    method: (id: string | null | undefined) => db.payment_methods.find((m) => m.id === id)?.name ?? "—",
    vehicle: (id: string | null | undefined) => db.vehicles.find((v) => v.id === id)?.label ?? "",
    user: (id: string) => db.users.find((u) => u.id === id)?.name ?? "—",
  };

  const rows = useMemo(() => {
    let list = rowsInRange(db, from, to);
    if (kind !== "all") list = list.filter((t) => t.kind === kind);
    if (categoryId) list = list.filter((t) => t.category_id === categoryId);
    if (methodId) list = list.filter((t) => t.payment_method_id === methodId);
    const needle = q.trim().toLowerCase();
    if (needle) {
      list = list.filter((t) => {
        const hay = [t.description, t.notes, t.job_ref, t.voucher_no, nameOf.category(t.category_id), nameOf.method(t.payment_method_id), String(t.amount)]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return hay.includes(needle);
      });
    }
    return [...list].sort((a, b) => {
      if (sortKey === "amount") return sortAsc ? a.amount - b.amount : b.amount - a.amount;
      const cmp = a.txn_date < b.txn_date ? -1 : a.txn_date > b.txn_date ? 1 : a.created_at < b.created_at ? -1 : 1;
      return sortAsc ? cmp : -cmp;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, from, to, kind, categoryId, methodId, q, sortKey, sortAsc]);

  const totals = useMemo(() => totalsOf(rows), [rows]);

  // Deep links from the command palette / dashboard:
  // #txn-<id> or #edit-<id> scrolls to, flashes and opens the entry modal.
  // Runs on mount AND on every hashchange so Enter from the palette works
  // even when you're already on this page (router.push only swaps the hash).
  useEffect(() => {
    const handle = () => {
      const hash = window.location.hash;
      if (!hash.startsWith("#txn-") && !hash.startsWith("#edit-")) return;
      const editId = hash.startsWith("#edit-") ? hash.slice(6) : null;
      const viewId = hash.startsWith("#txn-") ? hash.slice(5) : null;
      const id = editId ?? viewId;
      if (!id) return;
      const tx = db.transactions.find((x) => x.id === id);
      if (!tx) return;
      setYm(tx.txn_date.slice(0, 7));
      setKind("all");
      setCategoryId("");
      setMethodId("");
      setQ("");
      setFlashId(tx.id);
      setViewing(tx);
      setTimeout(() => {
        document.getElementById("txn-" + tx.id)?.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 150);
      setTimeout(() => setFlashId(null), 2600);
      history.replaceState(null, "", window.location.pathname + window.location.search);
    };
    handle();
    window.addEventListener("hashchange", handle);
    return () => window.removeEventListener("hashchange", handle);
  }, [db.transactions]);

  function toggleSort(k: SortKey) {
    if (sortKey === k) setSortAsc((s) => !s);
    else {
      setSortKey(k);
      setSortAsc(false);
    }
  }

  function exportCsv() {
    const header = ["Date", "Type", "Category", "Method", "Job Ref", "Voucher", "Description", "Notes", "Amount", "Entered By"];
    const lines = rows.map((t) =>
      [t.txn_date, t.kind, nameOf.category(t.category_id), nameOf.method(t.payment_method_id), t.job_ref ?? "", t.voucher_no ?? "", t.description ?? "", t.notes ?? "", t.amount.toFixed(2), nameOf.user(t.created_by)]
        .map((cell) => '"' + String(cell).replace(/"/g, '""') + '"')
        .join(",")
    );
    const csv = [header.join(","), ...lines].join("\r\n");
    const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `axl-transactions-${ym}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    setSelected((prev) => (prev.size === rows.length ? new Set() : new Set(rows.map((t) => t.id))));
  }

  const filtersActive = ym !== nowYm || kind !== "all" || categoryId !== "" || methodId !== "" || q.trim() !== "";

  function clearFilters() {
    setYm(nowYm);
    setKind("all");
    setCategoryId("");
    setMethodId("");
    setQ("");
  }

  return (
    <div>
      <PageHeader
        title="Transactions"
        subtitle={rows.length + " " + (rows.length === 1 ? "entry" : "entries") + " · " + monthLabel(ym) + " · in " + fmtAED(totals.income, { compact: true }) + " · out " + fmtAED(totals.expense, { compact: true })}
        actions={
          <>
            <Button onClick={exportCsv}>
              <Download size={13} /> Export CSV
            </Button>
            {canEditTxn ? (
              <Button variant="primary" onClick={() => openQuickEntry("expense")}>
                <Plus size={13} /> New entry
              </Button>
            ) : null}
          </>
        }
      />

      {/* Summary band — same StatCard components as Fleet & Dashboard */}
      <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          title="Money in"
          icon={<ArrowDownLeft size={15} />}
          value={fmtAED(totals.income, { compact: true })}
          sub={rows.filter((t) => t.kind === "income").length + " income " + (rows.filter((t) => t.kind === "income").length === 1 ? "entry" : "entries")}
          tone={totals.income > 0 ? "ok" : "plain"}
        />
        <StatCard
          title="Money out"
          icon={<ArrowUpRight size={15} />}
          value={fmtAED(totals.expense, { compact: true })}
          sub={rows.filter((t) => t.kind === "expense").length + " expense " + (rows.filter((t) => t.kind === "expense").length === 1 ? "entry" : "entries")}
          tone={totals.expense > 0 ? "bad" : "plain"}
        />
        <StatCard
          title="Net"
          icon={<Scale size={15} />}
          value={fmtAED(totals.net, { compact: true })}
          sub={"Net for " + monthLabel(ym)}
          tone={totals.net >= 0 ? "ok" : "bad"}
        />
        <StatCard title="Entries" icon={<Receipt size={15} />} value={String(rows.length)} sub={monthLabel(ym)} />
      </div>

      <Card className="overflow-hidden">
        {/* Toolbar: tinted Kravio card strip */}
        <div className="flex flex-wrap items-center gap-2 border-b border-[#f0ece4] bg-[#faf8f4] px-4 py-2.5">
          <div className="w-full sm:w-40">
            <MonthPicker value={ym} onChange={setYm} />
          </div>
          <div className="w-full sm:w-44">
            <SelectMenu
              value={categoryId}
              onChange={setCategoryId}
              placeholder="All categories"
              options={db.categories.filter((c) => !c.archived).map((c) => [c.id, c.name])}
            />
          </div>
          <div className="w-full sm:w-36">
            <SelectMenu
              value={methodId}
              onChange={setMethodId}
              placeholder="All methods"
              options={db.payment_methods.filter((m) => !m.archived).map((m) => [m.id, m.name])}
            />
          </div>
          <Segmented
            size="sm"
            value={kind}
            onChange={setKind}
            options={[
              ["all", "All"],
              ["income", "In"],
              ["expense", "Out"],
            ]}
          />
          <div className="w-full sm:w-52 sm:ml-auto">
            <SearchInput
              value={q}
              onChange={setQ}
              placeholder="Search entries"
              className="w-full"
              onEnter={() => {
                if (rows.length > 0) {
                  setSelected(new Set());
                  setViewing(rows[0]);
                }
              }}
            />
          </div>
        </div>

        {filtersActive ? (
          <div className="flex flex-wrap items-center gap-1.5 border-b border-[#efefec] px-4 py-2 sm:px-5">
            {ym !== nowYm ? (
              <FilterChip label={ym} onClear={() => setYm(nowYm)} />
            ) : null}
            {kind !== "all" ? (
              <FilterChip label={kind === "income" ? "In" : "Out"} onClear={() => setKind("all")} />
            ) : null}
            {categoryId ? <FilterChip label={nameOf.category(categoryId)} onClear={() => setCategoryId("")} /> : null}
            {methodId ? <FilterChip label={nameOf.method(methodId)} onClear={() => setMethodId("")} /> : null}
            {q.trim() ? <FilterChip label={`“${q.trim()}”`} onClear={() => setQ("")} /> : null}
            <button
              onClick={clearFilters}
              className="ml-1 inline-flex items-center gap-1 rounded-full border border-[#e9e9e6] bg-white px-2.5 py-1 text-[11px] font-semibold text-zinc-600 transition-colors hover:border-zinc-300 hover:bg-zinc-50 hover:text-zinc-900"
            >
              <X size={11} /> Clear all
            </button>
          </div>
        ) : null}

        {selected.size > 0 ? (
          <div className="flex items-center justify-between gap-3 border-b border-[#efefec] bg-blue-50/50 px-5 py-2">
            <span className="text-xs font-medium text-zinc-700">
              {selected.size} selected
            </span>
            <div className="flex items-center gap-2">
              <button onClick={() => setSelected(new Set())} className="text-xs font-medium text-zinc-500 transition-colors hover:text-zinc-900">
                Deselect all
              </button>
              <Button variant="primary" className="!bg-red-600 hover:!bg-red-700" onClick={() => setBulkDeleting(true)}>
                <Trash2 size={12} /> Delete selected
              </Button>
            </div>
          </div>
        ) : null}

        {rows.length === 0 ? (
          <EmptyState
            icon={<ArrowLeftRight size={18} />}
            title="No transactions match"
            hint="Try a different month or clear a filter. Add entries with Quick Entry (N)."
          />
        ) : (
          <>
          {/* Mobile: stacked row cards */}
          <div className="divide-y divide-[#f1f1ef] md:hidden">
            {rows.map((t) => (
              <div
                key={t.id}
                id={"txn-" + t.id}
                onClick={() => setViewing(t)}
                className={"flex items-center gap-3 px-4 py-3 active:bg-[#fafaf9] " + (flashId === t.id ? "bg-amber-50" : selected.has(t.id) ? "bg-blue-50/60" : "")}
              >
                {canEditTxn ? (
                  <div onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" checked={selected.has(t.id)} onChange={() => toggleSelect(t.id)} className="h-4 w-4 rounded" aria-label="Select row" />
                  </div>
                ) : null}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <Pill tone={t.kind === "income" ? "emerald" : "red"}>{t.kind === "income" ? "IN" : "OUT"}</Pill>
                    <span className="truncate text-[13px] font-medium text-zinc-800">{t.description || nameOf.category(t.category_id) || "—"}</span>
                  </div>
                  <div className="mt-0.5 truncate text-[11px] text-zinc-400">
                    {fmtDateShort(t.txn_date)} · {nameOf.category(t.category_id)}
                    {nameOf.vehicle(t.vehicle_id) ? " · " + nameOf.vehicle(t.vehicle_id) : ""}
                    {t.job_ref ? " · #" + t.job_ref : ""}
                  </div>
                </div>
                <div className={"shrink-0 text-right text-[13px] font-semibold tabular-nums " + (t.kind === "income" ? "text-emerald-600" : "text-zinc-900")}>
                  {t.kind === "income" ? "+" : "−"}{fmtAED(t.amount)}
                  <div className="text-[10px] font-normal text-zinc-400">{fmtTime(t.created_at)}</div>
                </div>
              </div>
            ))}
          </div>

          {/* Desktop: full table */}
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-[#e9e9e6] bg-[#fbfbfa] text-left text-[10px] uppercase tracking-wider text-zinc-400">
                  {canEditTxn ? (
                    <th className="w-10 px-4 py-2.5">
                      <input
                        type="checkbox"
                        checked={rows.length > 0 && selected.size === rows.length}
                        onChange={toggleSelectAll}
                        className="rounded"
                        aria-label="Select all"
                      />
                    </th>
                  ) : null}
                  <th className="px-2 py-2.5 font-semibold">
                    <button onClick={() => toggleSort("date")} className="inline-flex items-center transition-colors hover:text-zinc-600">
                      Date <SortGlyph active={sortKey === "date"} />
                    </button>
                  </th>
                  <th className="px-2 py-2.5 font-semibold">Type</th>
                  <th className="px-2 py-2.5 font-semibold">Description</th>
                  <th className="px-2 py-2.5 font-semibold">Category</th>
                  <th className="hidden px-2 py-2.5 font-semibold lg:table-cell">Method</th>
                  <th className="hidden px-2 py-2.5 font-semibold xl:table-cell">By</th>
                  <th className="px-4 py-2.5 text-right font-semibold">
                    <button onClick={() => toggleSort("amount")} className="inline-flex items-center transition-colors hover:text-zinc-600">
                      Amount <SortGlyph active={sortKey === "amount"} />
                    </button>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((t) => (
                  <tr
                    key={t.id}
                    id={"txn-" + t.id}
                    onClick={() => setViewing(t)}
                    className={"cursor-pointer scroll-mt-32 border-b border-[#f1f1ef] transition-colors last:border-0 " + (flashId === t.id ? "bg-amber-50" : selected.has(t.id) ? "bg-blue-50/60" : "hover:bg-[#fafaf9]")}
                  >
                    {canEditTxn ? (
                      <td className="px-4 py-2.5" onClick={(e) => e.stopPropagation()}>
                        <input type="checkbox" checked={selected.has(t.id)} onChange={() => toggleSelect(t.id)} className="rounded" aria-label="Select row" />
                      </td>
                    ) : null}
                    <td className="whitespace-nowrap px-2 py-2.5">
                      <div className="text-zinc-500">{fmtDateShort(t.txn_date)}</div>
                      <div className="text-[10px] tabular-nums text-zinc-400">{fmtTime(t.created_at)}</div>
                    </td>
                    <td className="px-2 py-2.5">
                      <Pill tone={t.kind === "income" ? "emerald" : "red"}>{t.kind === "income" ? "IN" : "OUT"}</Pill>
                    </td>
                    <td className="max-w-64 px-2 py-2.5">
                      <div className="truncate font-medium text-zinc-800">{t.description || "—"}</div>
                      <div className="mt-0.5 flex items-center gap-1.5">
                        {t.job_ref ? (
                          <span className="inline-flex items-center gap-1 rounded-md bg-[#f7f7f5] px-1.5 py-0.5 text-[10px] font-semibold text-zinc-500">
                            <Hash size={9} />
                            {t.job_ref}
                          </span>
                        ) : null}
                        {nameOf.vehicle(t.vehicle_id) ? (
                          <span className="inline-flex items-center gap-1 rounded-md bg-blue-50 px-1.5 py-0.5 text-[10px] font-medium text-blue-600">
                            <CarFront size={9} />
                            {nameOf.vehicle(t.vehicle_id)}
                          </span>
                        ) : null}
                        {t.voucher_no ? <span className="text-[10px] text-zinc-400">V {t.voucher_no}</span> : null}
                      </div>
                    </td>
                    <td className="px-2 py-2.5 text-zinc-500">{nameOf.category(t.category_id)}</td>
                    <td className="hidden px-2 py-2.5 text-zinc-500 lg:table-cell">{nameOf.method(t.payment_method_id)}</td>
                    <td className="hidden px-2 py-2.5 xl:table-cell">
                      <div className="flex items-center gap-2">
                        <Avatar name={nameOf.user(t.created_by)} size="sm" />
                        <span className="text-xs text-zinc-500">{nameOf.user(t.created_by)}</span>
                      </div>
                    </td>
                    <td className={"whitespace-nowrap px-4 py-2.5 text-right font-semibold tabular-nums " + (t.kind === "income" ? "text-emerald-600" : "text-zinc-900")}>
                      {t.kind === "income" ? "+" : "−"}
                      {fmtAED(t.amount)}
                    </td>
                  </tr>
                ))}
                          </tbody>
            </table>
          </div>
          </>
        )}
      </Card>

      <ViewModal tx={viewing} onClose={() => setViewing(null)} canWrite={canEditTxn} nameOf={nameOf} onSave={(id, patch) => { setDb((prev) => (prev ? updateTransaction(prev, id, patch) : prev)); setViewing(null); }} />

      <ConfirmDelete
        open={bulkDeleting}
        onClose={() => setBulkDeleting(false)}
        label={selected.size === 1 ? "1 transaction" : `${selected.size} transactions`}
        onConfirm={() => {
          setDb((prev) => (prev ? { ...prev, transactions: prev.transactions.filter((t) => !selected.has(t.id)) } : prev));
          setSelected(new Set());
          setBulkDeleting(false);
        }}
      />
    </div>
  );
}

function FilterChip({ label, onClear }: { label: string; onClear: () => void }) {
  return (
    <span className="inline-flex max-w-48 items-center gap-1 rounded-full border border-[#e9e9e6] bg-white px-2.5 py-1 text-[11px] font-medium text-zinc-700">
      <span className="truncate">{label}</span>
      <button onClick={onClear} className="shrink-0 rounded-full text-zinc-400 transition-colors hover:text-zinc-900" aria-label={'Clear filter ' + label}>
        <X size={11} />
      </button>
    </span>
  );
}

function ViewModal({
  tx,
  onClose,
  onSave,
  canWrite,
  nameOf,
}: {
  tx: Transaction | null;
  onClose: () => void;
  onSave: (id: string, patch: Partial<TransactionInput>) => void;
  canWrite: boolean;
  nameOf: { category: (id: string | null | undefined) => string; method: (id: string | null | undefined) => string; vehicle: (id: string | null | undefined) => string; user: (id: string) => string };
}) {
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState("");
  const [desc, setDesc] = useState("");
  const [jobRef, setJobRef] = useState("");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (tx) {
      setAmount(String(tx.amount));
      setDate(tx.txn_date);
      setDesc(tx.description ?? "");
      setJobRef(tx.job_ref ?? "");
      setNotes(tx.notes ?? "");
    }
  }, [tx]);

  if (!tx) return null;

  const meta: [string, React.ReactNode, string][] = [
    ["Category", nameOf.category(tx.category_id), "cat"],
    ["Payment method", nameOf.method(tx.payment_method_id), "pm"],
    ["Vehicle", nameOf.vehicle(tx.vehicle_id), "veh"],
    ["Fuel liters", tx.fuel_liters ? tx.fuel_liters + " L" : null, "l"],
    ["Voucher", tx.voucher_no, "vc"],
    ["Entered by", nameOf.user(tx.created_by), "by"],
    ["Logged at", fmtDate(tx.created_at.slice(0, 10)) + " · " + fmtTime(tx.created_at), "at"],
  ];

  return (
    <SlideOver
      open={!!tx}
      onClose={onClose}
      title={(tx.kind === "income" ? "Income" : "Expense") + " entry · " + fmtAED(tx.amount)}
      subtitle={"Logged " + fmtDate(tx.created_at.slice(0, 10)) + " · " + fmtTime(tx.created_at)}
      footer={
        <>
          <Button onClick={onClose}>Close</Button>
          {canWrite ? (
            <Button
              variant="primary"
              onClick={() =>
                onSave(tx.id, {
                  amount: parseFloat(amount) || tx.amount,
                  txn_date: date,
                  description: desc,
                  job_ref: jobRef,
                  notes,
                })
              }
            >
              Save changes
            </Button>
          ) : null}
        </>
      }
    >
      <div className="space-y-3 p-5">
        <div className="flex items-center justify-between gap-3">
          <Pill tone={tx.kind === "income" ? "emerald" : "red"}>{tx.kind === "income" ? "Income" : "Expense"}</Pill>
          <span className="text-[11px] tabular-nums text-zinc-400">Logged {fmtDate(tx.created_at.slice(0, 10))} · {fmtTime(tx.created_at)}</span>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Amount (AED)</Label>
            <Input type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} disabled={!canWrite} />
          </div>
          <div>
            <Label>Date</Label>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} disabled={!canWrite} />
          </div>
        </div>
        <div>
          <Label>Description</Label>
          <Input value={desc} onChange={(e) => setDesc(e.target.value)} disabled={!canWrite} placeholder="—" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Job ref</Label>
            <Input value={jobRef} onChange={(e) => setJobRef(e.target.value)} disabled={!canWrite} placeholder="—" />
          </div>
          <div>
            <Label>Notes</Label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} disabled={!canWrite} placeholder="—" />
          </div>
        </div>        <dl className="space-y-0 divide-y divide-[#f1f1ef] border-t border-[#f1f1ef] pt-1">
          {meta
            .filter(([, v]) => v !== null && v !== "" && v !== "—")
            .map(([label, node, k]) => (
              <div key={k} className="flex items-center justify-between gap-4 py-2">
                <dt className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">{label}</dt>
                <dd className="text-sm text-zinc-700">{node}</dd>
              </div>
            ))}
        </dl>
      </div>
    </SlideOver>
  );
}
