"use client";
import React, { useEffect, useMemo, useRef, useState } from "react";
import type { Database, Kind, PartyKind } from "@/lib/types";
import type { TransactionInput } from "@/lib/store";
import { addTransaction, ensureParty, findOpenQuote } from "@/lib/repo";
import { todayISO, fmtAED } from "@/lib/format";
import { Button, Input, Label, Modal, SelectMenu, Toast } from "@/components/ui";
import { DatePicker } from "@/components/date-picker";
import { PartyInput } from "@/components/party-input";
import { QuoteInput } from "@/components/quote-input";
import { useDbContext } from "@/lib/local-db";

export function QuickEntry({
  open,
  onClose,
  db,
  setDb,
  initialKind = "expense",
  initialParty = null,
  initialQuote = null,
}: {
  open: boolean;
  onClose: () => void;
  db: Database;
  setDb: React.Dispatch<React.SetStateAction<Database | null>>;
  initialKind?: Kind;
  /** Supplier/client profile the entry was started from — attached on save. */
  initialParty?: { id: string; name: string } | null;
  /** Quotation the entry was started from — pre-fills the quote number. */
  initialQuote?: { id: string; quote_no: string } | null;
}) {
  const { session, profile } = useDbContext();
  const [kind, setKind] = useState<Kind>(initialKind);
  const [date, setDate] = useState(todayISO());
  const [amount, setAmount] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [vehicleId, setVehicleId] = useState("");
  const [liters, setLiters] = useState("");
  const [methodId, setMethodId] = useState("");
  const [desc, setDesc] = useState("");
  const [jobRef, setJobRef] = useState("");
  const [voucher, setVoucher] = useState("");
  const [notes, setNotes] = useState("");
  const [partyName, setPartyName] = useState("");
  const [partyId, setPartyId] = useState<string | null>(null);
  const [quoteNo, setQuoteNo] = useState("");
  const [keepEntering, setKeepEntering] = useState(true);
  const [toast, setToast] = useState<string | null>(null);
  const [todayCount, setTodayCount] = useState(0);
  const amountRef = useRef<HTMLInputElement>(null);

  const categories = useMemo(() => db.categories.filter((c) => c.kind === kind && !c.archived), [db.categories, kind]);
  const methods = useMemo(() => db.payment_methods.filter((m) => !m.archived), [db.payment_methods]);
  const vehicles = useMemo(() => db.vehicles.filter((v) => !v.archived), [db.vehicles]);
  const isFuel = categoryId === "c_fuel" || categoryId === "c_vehicles";
  const partyKind: PartyKind = kind === "expense" ? "supplier" : "client";
  const partyList = useMemo(() => db.parties.filter((p) => p.kind === partyKind), [db.parties, partyKind]);

  useEffect(() => {
    if (!open) return;
    setKind(initialKind);
    setDate(todayISO());
    setAmount("");
    setCategoryId("");
    const lastMethod = db.transactions.find((t) => t.payment_method_id)?.payment_method_id ?? "";
    setMethodId(lastMethod);
    setVehicleId("");
    setLiters("");
    setDesc("");
    setJobRef("");
    setVoucher("");
    setNotes("");
    setPartyName(initialParty?.name ?? "");
    setPartyId(initialParty?.id ?? null);
    setQuoteNo(initialQuote?.quote_no ?? "");
    const t = todayISO();
    setTodayCount(db.transactions.filter((x) => x.txn_date === t).length);
    setTimeout(() => amountRef.current?.focus(), 50);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  /** Switching Income/Expense clears category and party (both are per-kind). */
  function switchKind(next: Kind) {
    setKind(next);
    setCategoryId("");
    setPartyName("");
    setPartyId(null);
  }

  function save() {
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) {
      setToast("Enter an amount first");
      return;
    }
    // A typed quotation must resolve to an approved/completed quote.
    const quote = quoteNo.trim() ? findOpenQuote(db, quoteNo) : undefined;
    if (quoteNo.trim() && !quote) {
      const known = db.quotes.find((q) => q.quote_no.trim().toLowerCase() === quoteNo.trim().toLowerCase());
      setToast(known ? `Quotation ${known.quote_no} is ${known.status === "review" ? "under review" : "rejected"} — it cannot take entries` : `No quotation “${quoteNo.trim()}” exists`);
      return;
    }
    const lockedParty = partyId ? db.parties.find((p) => p.id === partyId) ?? null : null;
    const input: TransactionInput = {
      kind,
      txn_date: date,
      amount: amt,
      category_id: categoryId || null,
      payment_method_id: methodId || null,
      vehicle_id: isFuel ? vehicleId || null : null,
      fuel_liters: isFuel && liters ? parseFloat(liters) : null,
      job_ref: jobRef || null,
      voucher_no: voucher || null,
      quote_id: quote?.id ?? null,
      description: desc || null,
      notes: notes || null,
      // Cloud mode: must be the real auth profile id (FK to profiles).
      // Local mode: the seeded active user id.
      created_by: session?.user?.id ?? profile?.id ?? db.settings.active_user_id,
    };
    // Attach the party this entry was started from, or resolve/auto-create the
    // typed name. Renaming a prefilled name falls back to a name lookup.
    setDb((prev) => {
      const base = prev ?? db;
      const locked = partyId ? base.parties.find((p) => p.id === partyId) : null;
      if (locked && locked.name.trim().toLowerCase() === partyName.trim().toLowerCase()) {
        return addTransaction(base, { ...input, party_id: locked.id });
      }
      const { db: next, party } = ensureParty(base, partyKind, partyName);
      return addTransaction(next, { ...input, party_id: party?.id ?? null });
    });
    setTodayCount((n) => n + 1);
    setToast((kind === "income" ? "Income " : "Expense ") + fmtAED(amt) + " saved");
    if (!keepEntering) {
      onClose();
      return;
    }
    setAmount("");
    setDesc("");
    setJobRef("");
    setVoucher("");
    setNotes("");
    setPartyName(lockedParty ? lockedParty.name : "");
    setPartyId(lockedParty ? lockedParty.id : null);
    setVehicleId("");
    setLiters("");
    setTimeout(() => amountRef.current?.focus(), 30);
  }

  function onFormKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !(e.target as HTMLElement).closest("textarea")) {
      e.preventDefault();
      save();
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Quick Entry" wide>
      <div onKeyDown={onFormKeyDown} className="space-y-4">
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => switchKind("income")}
            className={
              "rounded-xl border px-4 py-2.5 text-sm font-semibold transition-all " +
              (kind === "income" ? "border-emerald-500/40 bg-emerald-50 text-emerald-700 shadow-[0_1px_2px_rgba(5,150,105,0.12)]" : "border-[#e5e5e2] bg-white text-zinc-500 hover:border-zinc-300")
            }
          >
            Income
          </button>
          <button
            type="button"
            onClick={() => switchKind("expense")}
            className={
              "rounded-xl border px-4 py-2.5 text-sm font-semibold transition-all " +
              (kind === "expense" ? "border-red-500/40 bg-red-50 text-red-700 shadow-[0_1px_2px_rgba(220,38,38,0.12)]" : "border-[#e5e5e2] bg-white text-zinc-500 hover:border-zinc-300")
            }
          >
            Expense
          </button>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div>
            <Label>Amount (AED)</Label>
            <Input innerRef={amountRef} type="number" min="0" step="0.01" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
          </div>
          <div>
            <Label>Date</Label>
            <DatePicker value={date} onChange={setDate} />
          </div>
          <div>
            <Label>Payment method</Label>
            <SelectMenu value={methodId} onChange={setMethodId} placeholder="—" options={methods.map((m) => [m.id, m.name])} />
          </div>
        </div>

        <div>
          <Label>Category</Label>
          <div className="flex flex-wrap gap-1.5">
            {categories.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setCategoryId(c.id)}
                className={
                  "rounded-full border px-3 py-1.5 text-xs font-medium transition-all " +
                  (categoryId === c.id ? "border-zinc-900 bg-zinc-900 text-white shadow-[0_1px_2px_rgba(24,24,27,0.2)]" : "border-[#e5e5e2] bg-white text-zinc-600 hover:border-zinc-400")
                }
              >
                {c.name}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <Label>{kind === "expense" ? "Supplier" : "Client"}</Label>
            <PartyInput
              value={partyName}
              onChange={setPartyName}
              parties={partyList}
              kindLabel={kind === "expense" ? "supplier" : "client"}
              placeholder={kind === "expense" ? "Type a supplier — or a new one" : "Type a client — or a new one"}
            />
          </div>
          <div>
            <Label>{kind === "expense" ? "Bill / invoice no." : "Voucher / invoice no."}</Label>
            <Input value={voucher} onChange={(e) => setVoucher(e.target.value)} placeholder="optional" />
          </div>
        </div>

        <div>
          <Label>Quotation (project)</Label>
          <QuoteInput
            value={quoteNo}
            onChange={setQuoteNo}
            quotes={db.quotes.filter((q) => q.status === "approved" || q.status === "completed")}
            clientName={(id) => db.parties.find((p) => p.id === id)?.name ?? ""}
            placeholder="Optional — type a quotation number"
          />
        </div>

        {isFuel && (
          <div className="grid grid-cols-2 gap-3 rounded-xl border border-[#e9e9e6] bg-[#fafaf9] p-3">
            <div>
              <Label>Vehicle</Label>
              <SelectMenu value={vehicleId} onChange={setVehicleId} placeholder="—" options={vehicles.map((v) => [v.id, v.label + " · " + v.plate])} />
            </div>
            <div>
              <Label>Liters (optional)</Label>
              <Input type="number" min="0" step="0.01" inputMode="decimal" value={liters} onChange={(e) => setLiters(e.target.value)} placeholder="for AED/L later" />
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div>
            <Label>Description</Label>
            <Input value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="What was this for?" />
          </div>
          <div>
            <Label>Job ref</Label>
            <Input value={jobRef} onChange={(e) => setJobRef(e.target.value)} placeholder="AY12017" />
          </div>
        </div>

        <div>
          <Label>Notes</Label>
          <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Reconciliation notes…" />
        </div>

        <div className="flex items-center justify-between border-t border-[#efefec] pt-3">
          <div className="flex items-center gap-3">
            <label className="flex cursor-pointer items-center gap-2 text-sm text-zinc-600">
              <input type="checkbox" checked={keepEntering} onChange={(e) => setKeepEntering(e.target.checked)} className="rounded" />
              Keep entering
            </label>
            {todayCount > 0 ? <span className="text-xs text-zinc-400">{todayCount} ent{todayCount === 1 ? "ry" : "ries"} today</span> : null}
          </div>
          <div className="flex gap-2">
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="primary" onClick={save}>
              Save {kind} (Enter)
            </Button>
          </div>
        </div>
      </div>
      <Toast message={toast} />
    </Modal>
  );
}
