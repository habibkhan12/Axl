"use client";
import React, { useEffect, useMemo, useRef, useState } from "react";
import type { Database, Kind } from "@/lib/types";
import type { TransactionInput } from "@/lib/store";
import { addTransaction } from "@/lib/repo";
import { todayISO, fmtAED } from "@/lib/format";
import { Button, Input, Label, Modal, SelectMenu, Toast } from "@/components/ui";
import { DatePicker } from "@/components/date-picker";
import { useDbContext } from "@/lib/local-db";

export function QuickEntry({
  open,
  onClose,
  db,
  setDb,
  initialKind = "expense",
}: {
  open: boolean;
  onClose: () => void;
  db: Database;
  setDb: React.Dispatch<React.SetStateAction<Database | null>>;
  initialKind?: Kind;
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
  const [keepEntering, setKeepEntering] = useState(true);
  const [toast, setToast] = useState<string | null>(null);
  const [todayCount, setTodayCount] = useState(0);
  const amountRef = useRef<HTMLInputElement>(null);

  const categories = useMemo(() => db.categories.filter((c) => c.kind === kind && !c.archived), [db.categories, kind]);
  const methods = useMemo(() => db.payment_methods.filter((m) => !m.archived), [db.payment_methods]);
  const vehicles = useMemo(() => db.vehicles.filter((v) => !v.archived), [db.vehicles]);
  const isFuel = categoryId === "c_fuel" || categoryId === "c_vehicles";

  useEffect(() => {
    if (!open) return;
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
    const t = todayISO();
    setTodayCount(db.transactions.filter((x) => x.txn_date === t).length);
    setTimeout(() => amountRef.current?.focus(), 50);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    setCategoryId("");
  }, [kind]);

  function save() {
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) {
      setToast("Enter an amount first");
      return;
    }
    const input: TransactionInput = {
      kind,
      txn_date: date,
      amount: amt,
      party_id: null,
      category_id: categoryId || null,
      payment_method_id: methodId || null,
      vehicle_id: isFuel ? vehicleId || null : null,
      fuel_liters: isFuel && liters ? parseFloat(liters) : null,
      job_ref: jobRef || null,
      voucher_no: voucher || null,
      description: desc || null,
      notes: notes || null,
      // Cloud mode: must be the real auth profile id (FK to profiles).
      // Local mode: the seeded active user id.
      created_by: session?.user?.id ?? profile?.id ?? db.settings.active_user_id,
    };
    setDb((prev) => addTransaction(prev ?? db, input));
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
            onClick={() => setKind("income")}
            className={
              "rounded-xl border px-4 py-2.5 text-sm font-semibold transition-all " +
              (kind === "income" ? "border-emerald-500/40 bg-emerald-50 text-emerald-700 shadow-[0_1px_2px_rgba(5,150,105,0.12)]" : "border-[#e5e5e2] bg-white text-zinc-500 hover:border-zinc-300")
            }
          >
            Income
          </button>
          <button
            type="button"
            onClick={() => setKind("expense")}
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
          <div>
            <Label>Voucher</Label>
            <Input value={voucher} onChange={(e) => setVoucher(e.target.value)} placeholder="optional" />
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
