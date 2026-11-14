"use client";
import React, { useMemo, useState } from "react";
import { Link2 } from "lucide-react";
import { Button, Modal, SearchInput } from "@/components/ui";
import { fmtAED, fmtDateShort } from "@/lib/format";
import type { Category, Party, PaymentMethod, Transaction } from "@/lib/types";

/**
 * Attach transactions that were entered before suppliers/clients existed (or
 * with the field left blank) to one supplier or client.
 */
export function LinkTransactionsModal({
  party,
  noun,
  txKind,
  transactions,
  categories,
  methods,
  parties,
  onClose,
  onLink,
}: {
  party: Party;
  noun: string;
  txKind: Transaction["kind"];
  transactions: Transaction[];
  categories: Category[];
  methods: PaymentMethod[];
  parties: Party[];
  onClose: () => void;
  onLink: (ids: string[]) => void;
}) {
  const [q, setQ] = useState("");
  const [onlyUnlinked, setOnlyUnlinked] = useState(true);
  const [picked, setPicked] = useState<Set<string>>(new Set());

  const partyName = useMemo(() => {
    const map = new Map(parties.map((p) => [p.id, p.name]));
    return (id: string | null | undefined) => (id ? map.get(id) ?? "—" : "");
  }, [parties]);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const catName = (id: string | null | undefined) => categories.find((c) => c.id === id)?.name ?? "";
    const methodName = (id: string | null | undefined) => methods.find((m) => m.id === id)?.name ?? "";
    return transactions
      .filter((t) => t.kind === txKind)
      .filter((t) => (onlyUnlinked ? !t.party_id : true))
      .filter((t) => {
        if (!needle) return true;
        const hay = [
          t.description,
          t.notes,
          t.job_ref,
          t.voucher_no,
          catName(t.category_id),
          methodName(t.payment_method_id),
          partyName(t.party_id),
          String(t.amount),
          t.txn_date,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return hay.includes(needle);
      })
      .sort((a, b) => (a.txn_date < b.txn_date ? 1 : a.txn_date > b.txn_date ? -1 : 0));
  }, [transactions, txKind, onlyUnlinked, q, categories, methods, partyName]);

  const shown = rows.slice(0, 100);
  const byId = useMemo(() => new Map(transactions.map((t) => [t.id, t])), [transactions]);
  const pickedRows = [...picked].map((id) => byId.get(id)).filter((t): t is Transaction => !!t);
  const pickedTotal = pickedRows.reduce((s, t) => s + t.amount, 0);
  const allShownPicked = shown.length > 0 && shown.every((t) => picked.has(t.id));

  function toggle(id: string) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAllShown() {
    setPicked((prev) => {
      const next = new Set(prev);
      if (allShownPicked) shown.forEach((t) => next.delete(t.id));
      else shown.forEach((t) => next.add(t.id));
      return next;
    });
  }

  return (
    <Modal open onClose={onClose} title={"Link entries to " + party.name} wide>
      <div className="space-y-3">
        <p className="text-[12px] leading-relaxed text-zinc-500">
          Pick the {txKind === "expense" ? "expenses" : "income"} that belong to this {noun}. Their {noun} field is set to{" "}
          <span className="font-medium text-zinc-800">{party.name}</span> when you link them.
        </p>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <SearchInput value={q} onChange={setQ} placeholder={"Search entries — description, amount, job ref…"} className="w-full" />
          <label className="flex shrink-0 items-center gap-2 rounded-lg border border-[#e5e5e2] bg-white px-3 py-2 text-[11px] text-zinc-600">
            <input type="checkbox" checked={onlyUnlinked} onChange={(e) => setOnlyUnlinked(e.target.checked)} className="rounded" />
            Unlinked only
          </label>
        </div>

        <div className="flex items-center justify-between text-[11px] text-zinc-400">
          <span>
            {rows.length} {rows.length === 1 ? "entry" : "entries"}
            {rows.length > shown.length ? " · showing first " + shown.length : ""}
          </span>
          {shown.length > 0 ? (
            <button type="button" onClick={toggleAllShown} className="font-medium text-zinc-500 transition-colors hover:text-zinc-900">
              {allShownPicked ? "Clear shown" : "Select shown"}
            </button>
          ) : null}
        </div>

        <div className="max-h-[46vh] overflow-y-auto rounded-xl border border-[#eae4d9]">
          {shown.length === 0 ? (
            <p className="px-3 py-6 text-center text-[12px] text-zinc-400">
              {onlyUnlinked
                ? "Every " + (txKind === "expense" ? "expense" : "income entry") + " already has a " + noun + "."
                : "Nothing matches this search."}
            </p>
          ) : (
            shown.map((t) => {
              const current = partyName(t.party_id);
              return (
                <label
                  key={t.id}
                  className={
                    "flex cursor-pointer items-center gap-3 border-b border-[#f1f1ef] px-3 py-2 last:border-0 transition-colors " +
                    (picked.has(t.id) ? "bg-[#f6f4ef]" : "hover:bg-[#faf8f4]")
                  }
                >
                  <input type="checkbox" checked={picked.has(t.id)} onChange={() => toggle(t.id)} className="shrink-0 rounded" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12px] font-medium text-zinc-800">
                      {t.description || categories.find((c) => c.id === t.category_id)?.name || "Entry"}
                    </span>
                    <span className="block truncate text-[10px] text-zinc-400">
                      {fmtDateShort(t.txn_date)} · {categories.find((c) => c.id === t.category_id)?.name ?? "—"}
                      {t.job_ref ? " · " + t.job_ref : ""}
                      {current ? " · now: " + current : " · unlinked"}
                    </span>
                  </span>
                  <span className={"shrink-0 text-[12px] font-semibold tabular-nums " + (txKind === "expense" ? "text-zinc-900" : "text-emerald-600")}>
                    {txKind === "expense" ? "−" : "+"}{fmtAED(t.amount)}
                  </span>
                </label>
              );
            })
          )}
        </div>

        <div className="flex items-center justify-between border-t border-[#efefec] pt-3">
          <span className="text-[11px] text-zinc-500">
            {picked.size > 0 ? picked.size + " selected · " + fmtAED(pickedTotal) : "Nothing selected"}
          </span>
          <div className="flex gap-2">
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="primary" disabled={picked.size === 0} onClick={() => onLink([...picked])}>
              <Link2 size={13} /> Link {picked.size > 0 ? picked.size : ""} {picked.size === 1 ? "entry" : "entries"}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
