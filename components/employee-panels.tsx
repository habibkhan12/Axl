"use client";
import React, { useMemo, useState } from "react";
import { Clock, Palmtree, Plus, Receipt, Trash2, Wallet } from "lucide-react";
import { Button, Card, Input, Label, MicroLabel } from "@/components/ui";
import { DatePicker } from "@/components/date-picker";
import { useDb } from "@/lib/local-db";
import { removeById, uid, upsertById, upsertStaff } from "@/lib/repo";
import { fmtAED, fmtDate, monthLabel, monthOf, todayISO } from "@/lib/format";
import type { StaffFine, StaffLeave, StaffMember, StaffOvertime, StaffTransaction } from "@/lib/types";

/* ─────────────────────────────── overview ───────────────────────────────── */

export function EmployeeOverview({ person, editable }: { person: StaffMember; editable: boolean }) {
  const { db, setDb } = useDb();
  const [month, setMonth] = useState(monthOf(todayISO()));
  const year = todayISO().slice(0, 4);

  const leaveDays = leaveDaysInYear(db.staff_leaves.filter((l) => l.staff_id === person.id), year);
  const payments = db.staff_transactions.filter((t) => t.staff_id === person.id);
  const paid = payments.filter((p) => p.kind === "paid").reduce((s, p) => s + p.amount, 0);
  const received = payments.filter((p) => p.kind === "received").reduce((s, p) => s + p.amount, 0);

  // ── payroll for the selected month ────────────────────────────────────────
  const baseSalary = person.salary ?? 0;
  const rate = person.overtime_rate ?? 0;
  const overtimeHours = db.staff_overtime.filter((o) => o.staff_id === person.id && monthOf(o.work_date) === month).reduce((s, o) => s + o.hours, 0);
  const overtimePay = Math.round(overtimeHours * rate * 100) / 100;
  const fines = db.staff_fines.filter((f) => f.staff_id === person.id && monthOf(f.fine_date) === month);
  const finesTotal = Math.round(fines.reduce((s, f) => s + f.amount, 0) * 100) / 100;
  const paidMonth = payments.filter((p) => p.kind === "paid" && monthOf(p.txn_date) === month).reduce((s, p) => s + p.amount, 0);
  const receivedMonth = payments.filter((p) => p.kind === "received" && monthOf(p.txn_date) === month).reduce((s, p) => s + p.amount, 0);
  const earned = baseSalary + overtimePay - finesTotal;
  const payable = Math.round((earned - paidMonth + receivedMonth) * 100) / 100;

  const [salary, setSalary] = useState(person.salary != null ? String(person.salary) : "");
  const [saved, setSaved] = useState(false);
  const salaryChanged = (person.salary != null ? String(person.salary) : "") !== salary;

  function saveSalary() {
    const value = salary.trim() === "" ? null : Number(salary);
    if (value !== null && (!Number.isFinite(value) || value < 0)) return;
    setDb((prev) => (prev ? upsertStaff(prev, { ...person, salary: value }) : prev));
    setSaved(true);
    setTimeout(() => setSaved(false), 1600);
  }

  return (
    <div className="space-y-4">
      <div>
        <Label>Monthly salary</Label>
        <div className="flex items-center gap-2">
          <Input
            type="number"
            inputMode="decimal"
            min={0}
            step="0.01"
            value={salary}
            disabled={!editable}
            onChange={(e) => setSalary(e.target.value)}
            placeholder="e.g. 3500"
          />
          {editable ? (
            <Button variant="primary" disabled={!salaryChanged} onClick={saveSalary}>
              {saved ? "Saved" : "Save"}
            </Button>
          ) : null}
        </div>
        <p className="mt-1 text-[10px] text-zinc-400">{person.salary != null ? "Currently " + fmtAED(person.salary) + " per month" : "No salary set"}</p>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <MiniStat label="Overtime this month" value={fmtHours(overtimeHours)} sub={monthLabel(month)} icon={<Clock size={12} />} />
        <MiniStat label="Leave this year" value={leaveDays + (leaveDays === 1 ? " day" : " days")} sub={year} icon={<Palmtree size={12} />} />
        <MiniStat label="Paid to employee" value={fmtAED(paid)} sub="All time" icon={<Wallet size={12} />} />
        <MiniStat label="Received back" value={fmtAED(received)} sub="All time" icon={<Wallet size={12} />} />
      </div>

      <PayrollCard
        month={month}
        onMonth={setMonth}
        baseSalary={baseSalary}
        overtimeHours={overtimeHours}
        rate={rate}
        overtimePay={overtimePay}
        finesCount={fines.length}
        finesTotal={finesTotal}
        paidMonth={paidMonth}
        receivedMonth={receivedMonth}
        earned={earned}
        payable={payable}
      />

      <div className="rounded-xl border border-[#eae4d9] bg-white px-3 py-2.5">
        <MicroLabel>Balance held by employee (all time)</MicroLabel>
        <div className={"mt-1 text-[15px] font-semibold tabular-nums " + (paid - received > 0 ? "text-zinc-900" : "text-emerald-600")}>{fmtAED(paid - received)}</div>
        <p className="mt-0.5 text-[10px] text-zinc-400">Everything paid to them minus everything they have returned.</p>
      </div>
    </div>
  );
}

/** Month-by-month payroll: salary + overtime − fines − what has already moved. */
function PayrollCard({
  month,
  onMonth,
  baseSalary,
  overtimeHours,
  rate,
  overtimePay,
  finesCount,
  finesTotal,
  paidMonth,
  receivedMonth,
  earned,
  payable,
}: {
  month: string;
  onMonth: (m: string) => void;
  baseSalary: number;
  overtimeHours: number;
  rate: number;
  overtimePay: number;
  finesCount: number;
  finesTotal: number;
  paidMonth: number;
  receivedMonth: number;
  earned: number;
  payable: number;
}) {
  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between gap-2 border-b border-[#eae4d9] bg-[#faf8f4] px-3 py-2">
        <MicroLabel>Payroll</MicroLabel>
        <input
          type="month"
          value={month}
          onChange={(e) => onMonth(e.target.value)}
          className="rounded-lg border border-[#e5e5e2] bg-white px-2 py-1 text-[11px] text-zinc-700 outline-none focus:border-zinc-400"
        />
      </div>
      <div className="divide-y divide-[#f1f1ef]">
        <PayrollRow label="Base salary" value={fmtAED(baseSalary)} />
        <PayrollRow label={"Overtime — " + fmtHours(overtimeHours) + (rate > 0 ? " × " + fmtAED(rate) + "/h" : " · no rate set")} value={"+" + fmtAED(overtimePay)} tone={overtimePay > 0 ? "emerald" : "plain"} />
        <PayrollRow label={"Fines" + (finesCount ? " (" + finesCount + ")" : "")} value={"−" + fmtAED(finesTotal)} tone={finesTotal > 0 ? "red" : "plain"} />
        <PayrollRow label="Subtotal earned" value={fmtAED(earned)} strong />
        <PayrollRow label="Already paid this month" value={"−" + fmtAED(paidMonth)} />
        <PayrollRow label="Received from employee" value={"+" + fmtAED(receivedMonth)} tone={receivedMonth > 0 ? "emerald" : "plain"} />
      </div>
      <div className="flex items-center justify-between gap-2 border-t border-[#eae4d9] bg-[#faf8f4] px-3 py-2.5">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Payable for {monthLabel(month)}</span>
        <span className={"text-[17px] font-bold tabular-nums " + (payable < 0 ? "text-red-600" : "text-zinc-900")}>{fmtAED(payable)}</span>
      </div>
    </Card>
  );
}

function PayrollRow({ label, value, tone = "plain", strong = false }: { label: string; value: string; tone?: "plain" | "emerald" | "red"; strong?: boolean }) {
  const color = tone === "emerald" ? "text-emerald-600" : tone === "red" ? "text-red-600" : "text-zinc-800";
  return (
    <div className="flex items-center justify-between gap-3 px-3 py-1.5">
      <span className={"min-w-0 truncate text-[11px] " + (strong ? "font-semibold text-zinc-700" : "text-zinc-500")}>{label}</span>
      <span className={"shrink-0 text-[12px] tabular-nums " + (strong ? "font-semibold text-zinc-900" : "font-medium " + color)}>{value}</span>
    </div>
  );
}

function MiniStat({ label, value, sub, icon }: { label: string; value: string; sub: string; icon: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-[#eae4d9] bg-white px-3 py-2">
      <div className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-zinc-400">
        {icon} <span className="truncate">{label}</span>
      </div>
      <div className="mt-1 text-[15px] font-semibold tabular-nums text-zinc-900">{value}</div>
      <div className="text-[10px] text-zinc-400">{sub}</div>
    </div>
  );
}

/* ─────────────────────────────── overtime ───────────────────────────────── */

export function OvertimePanel({ person, editable }: { person: StaffMember; editable: boolean }) {
  const { db, setDb } = useDb();
  const [month, setMonth] = useState(monthOf(todayISO()));
  const [date, setDate] = useState(todayISO());
  const [hours, setHours] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  const mine = useMemo(
    () => db.staff_overtime.filter((o) => o.staff_id === person.id).sort((a, b) => (a.work_date < b.work_date ? 1 : -1)),
    [db.staff_overtime, person.id]
  );
  const inMonth = mine.filter((o) => monthOf(o.work_date) === month);
  const total = inMonth.reduce((s, o) => s + o.hours, 0);

  // Hourly rate lives on the employee record so payroll can reuse it.
  const [rate, setRate] = useState(person.overtime_rate != null ? String(person.overtime_rate) : "");
  const [rateSaved, setRateSaved] = useState(false);
  const rateValue = person.overtime_rate ?? null;
  const rateChanged = (rateValue != null ? String(rateValue) : "") !== rate;
  const overtimePay = Math.round(total * (Number(rate) || 0) * 100) / 100;

  function saveRate() {
    const value = rate.trim() === "" ? null : Number(rate);
    if (value !== null && (!Number.isFinite(value) || value < 0)) return;
    setDb((prev) => (prev ? upsertStaff(prev, { ...person, overtime_rate: value }) : prev));
    setRateSaved(true);
    setTimeout(() => setRateSaved(false), 1600);
  }

  function add() {
    const h = Number(hours);
    if (!date) return setError("Pick the day the overtime was worked.");
    if (!Number.isFinite(h) || h <= 0) return setError("Enter how many hours (for example 1.5).");
    if (h > 24) return setError("That is more than a day — check the hours.");
    setError(null);
    const row: StaffOvertime = { id: uid("ot"), staff_id: person.id, work_date: date, hours: h, note: note.trim() || null, created_at: new Date().toISOString() };
    setDb((prev) => (prev ? { ...prev, staff_overtime: upsertById(prev.staff_overtime, row) } : prev));
    setHours("");
    setNote("");
  }

  function remove(id: string) {
    if (!window.confirm("Delete this overtime entry?")) return;
    setDb((prev) => (prev ? { ...prev, staff_overtime: removeById(prev.staff_overtime, id) } : prev));
  }

  return (
    <div className="space-y-3">
      <Card className="p-3">
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex-1">
            <Label>Month</Label>
            <input
              type="month"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              className="w-full rounded-lg border border-[#e5e5e2] bg-white px-2 py-2 text-[12px] text-zinc-700 outline-none focus:border-zinc-400"
            />
          </div>
          <div className="rounded-lg border border-[#eae4d9] bg-[#faf8f4] px-3 py-2 text-right">
            <div className="text-[9px] font-medium uppercase tracking-wide text-zinc-400">Total hours</div>
            <div className="text-[15px] font-semibold tabular-nums text-zinc-900">{fmtHours(total)}</div>
          </div>
        </div>
        <div className="mt-3 flex items-end gap-2 border-t border-[#f1ece4] pt-3">
          <div className="flex-1">
            <Label>Hourly overtime rate (AED)</Label>
            <Input
              type="number"
              min={0}
              step="0.01"
              inputMode="decimal"
              value={rate}
              disabled={!editable}
              onChange={(e) => setRate(e.target.value)}
              placeholder="e.g. 25"
            />
          </div>
          <div className="rounded-lg border border-[#eae4d9] bg-[#faf8f4] px-3 py-2 text-right">
            <div className="text-[9px] font-medium uppercase tracking-wide text-zinc-400">Overtime pay</div>
            <div className="text-[15px] font-semibold tabular-nums text-emerald-600">{fmtAED(overtimePay)}</div>
          </div>
        </div>
        <p className="mt-1 text-[10px] text-zinc-400">
          {editable && rateChanged ? "Press Save to keep this rate." : rateValue != null ? fmtHours(total) + " × " + fmtAED(rateValue) + " per hour this month." : "Set a rate to turn hours into money."}
        </p>
        {editable ? (
          <Button className="mt-2" variant="primary" disabled={!rateChanged} onClick={saveRate}>
            {rateSaved ? "Saved" : "Save rate"}
          </Button>
        ) : null}
      </Card>

      {editable ? (
        <Card className="space-y-2 p-3">
          <MicroLabel>Add overtime for a day</MicroLabel>
          <div>
            <Label>Date</Label>
            <DatePicker value={date} onChange={setDate} />
          </div>
          <div className="flex gap-2">
            <div className="flex-1">
              <Label>Hours</Label>
              <Input type="number" min={0.25} step="0.25" inputMode="decimal" value={hours} onChange={(e) => setHours(e.target.value)} placeholder="2" />
            </div>
            <div className="flex-[2]">
              <Label>Note</Label>
              <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Site work, loading…" />
            </div>
          </div>
          {error ? <p className="text-[11px] text-red-600">{error}</p> : null}
          <Button variant="primary" onClick={add}>
            <Plus size={13} /> Add overtime
          </Button>
        </Card>
      ) : null}

      <div>
        <MicroLabel className="mb-1.5">{monthLabel(month)} — {inMonth.length} {inMonth.length === 1 ? "entry" : "entries"}</MicroLabel>
        {inMonth.length === 0 ? (
          <div className="rounded-xl border border-dashed border-[#e5e5e2] px-3 py-4 text-center text-[12px] text-zinc-400">No overtime recorded in this month.</div>
        ) : (
          <div className="divide-y divide-[#f1f1ef] rounded-xl border border-[#eae4d9]">
            {inMonth.map((o) => (
              <div key={o.id} className="flex items-center gap-2 px-3 py-2">
                <span className="w-16 shrink-0 text-[11px] text-zinc-500">{fmtDate(o.work_date)}</span>
                <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-zinc-800">{fmtHours(o.hours)}</span>
                {o.note ? <span className="hidden min-w-0 flex-1 truncate text-[11px] text-zinc-400 sm:block">{o.note}</span> : null}
                {editable ? (
                  <button onClick={() => remove(o.id)} className="shrink-0 rounded-md p-1 text-zinc-300 hover:bg-red-50 hover:text-red-600" aria-label="Delete entry">
                    <Trash2 size={12} />
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </div>

      {mine.length > inMonth.length ? (
        <p className="text-[10px] text-zinc-400">
          {mine.length} {mine.length === 1 ? "entry" : "entries"} in total across all months.
        </p>
      ) : null}
    </div>
  );
}

/* ───────────────────────────────── leave ────────────────────────────────── */

export function LeavePanel({ person, editable }: { person: StaffMember; editable: boolean }) {
  const { db, setDb } = useDb();
  const [from, setFrom] = useState(todayISO());
  const [to, setTo] = useState(todayISO());
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  const mine = useMemo(
    () => db.staff_leaves.filter((l) => l.staff_id === person.id).sort((a, b) => (a.from_date < b.from_date ? 1 : -1)),
    [db.staff_leaves, person.id]
  );
  const year = todayISO().slice(0, 4);
  const yearDays = leaveDaysInYear(mine, year);

  function add() {
    if (!from || !to) return setError("Pick both the first and last day.");
    if (to < from) return setError("The last day cannot be before the first day.");
    const days = daysBetween(from, to);
    if (days > 366) return setError("That leave is longer than a year — check the dates.");
    setError(null);
    const row: StaffLeave = { id: uid("lv"), staff_id: person.id, from_date: from, to_date: to, note: note.trim() || null, created_at: new Date().toISOString() };
    setDb((prev) => (prev ? { ...prev, staff_leaves: upsertById(prev.staff_leaves, row) } : prev));
    setNote("");
  }

  function remove(id: string) {
    if (!window.confirm("Delete this leave entry?")) return;
    setDb((prev) => (prev ? { ...prev, staff_leaves: removeById(prev.staff_leaves, id) } : prev));
  }

  return (
    <div className="space-y-3">
      {editable ? (
        <Card className="space-y-2 p-3">
          <MicroLabel>Register leave</MicroLabel>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label>From</Label>
              <DatePicker value={from} onChange={setFrom} />
            </div>
            <div>
              <Label>To</Label>
              <DatePicker value={to} onChange={setTo} />
            </div>
          </div>
          <div>
            <Label>Note</Label>
            <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Annual leave, sick, travel home…" />
          </div>
          {error ? <p className="text-[11px] text-red-600">{error}</p> : null}
          <Button variant="primary" onClick={add}>
            <Plus size={13} /> Add leave
          </Button>
        </Card>
      ) : null}

      <div>
        <div className="mb-1.5 flex items-center justify-between">
          <MicroLabel>Leave history — {mine.length}</MicroLabel>
          <span className="text-[10px] text-zinc-400">{yearDays} day{yearDays === 1 ? "" : "s"} in {year}</span>
        </div>
        {mine.length === 0 ? (
          <div className="rounded-xl border border-dashed border-[#e5e5e2] px-3 py-4 text-center text-[12px] text-zinc-400">No leave registered yet.</div>
        ) : (
          <div className="divide-y divide-[#f1f1ef] rounded-xl border border-[#eae4d9]">
            {mine.map((l) => (
              <div key={l.id} className="flex items-center gap-2 px-3 py-2">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12px] font-medium text-zinc-800">
                    {fmtDate(l.from_date)} → {fmtDate(l.to_date)}
                  </span>
                  <span className="block truncate text-[10px] text-zinc-400">
                    {daysBetween(l.from_date, l.to_date)} day{daysBetween(l.from_date, l.to_date) === 1 ? "" : "s"}
                    {l.note ? " · " + l.note : ""}
                  </span>
                </span>
                {editable ? (
                  <button onClick={() => remove(l.id)} className="shrink-0 rounded-md p-1 text-zinc-300 hover:bg-red-50 hover:text-red-600" aria-label="Delete leave">
                    <Trash2 size={12} />
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ───────────────────────────────── fines ────────────────────────────────── */

export function FinesPanel({ person, editable }: { person: StaffMember; editable: boolean }) {
  const { db, setDb } = useDb();
  const [reason, setReason] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(todayISO());
  const [error, setError] = useState<string | null>(null);

  const mine = useMemo(
    () => db.staff_fines.filter((f) => f.staff_id === person.id).sort((a, b) => (a.fine_date < b.fine_date ? 1 : -1)),
    [db.staff_fines, person.id]
  );
  const month = monthOf(todayISO());
  const monthTotal = mine.filter((f) => monthOf(f.fine_date) === month).reduce((s, f) => s + f.amount, 0);
  const allTotal = mine.reduce((s, f) => s + f.amount, 0);

  function add() {
    const value = Number(amount);
    if (!reason.trim()) return setError("Say what the fine is for.");
    if (!Number.isFinite(value) || value <= 0) return setError("Enter the amount to charge.");
    if (!date) return setError("Pick the date of the fine.");
    setError(null);
    const row: StaffFine = {
      id: uid("fine"),
      staff_id: person.id,
      reason: reason.trim(),
      amount: Math.round(value * 100) / 100,
      fine_date: date,
      created_at: new Date().toISOString(),
    };
    setDb((prev) => (prev ? { ...prev, staff_fines: upsertById(prev.staff_fines, row) } : prev));
    setReason("");
    setAmount("");
  }

  function remove(id: string) {
    if (!window.confirm("Delete this fine?")) return;
    setDb((prev) => (prev ? { ...prev, staff_fines: removeById(prev.staff_fines, id) } : prev));
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-xl border border-[#eae4d9] bg-white px-3 py-2">
          <div className="text-[9px] font-medium uppercase tracking-wide text-zinc-400">This month</div>
          <div className="mt-0.5 text-[15px] font-semibold tabular-nums text-red-600">{fmtAED(monthTotal)}</div>
        </div>
        <div className="rounded-xl border border-[#eae4d9] bg-white px-3 py-2">
          <div className="text-[9px] font-medium uppercase tracking-wide text-zinc-400">All time</div>
          <div className="mt-0.5 text-[15px] font-semibold tabular-nums text-zinc-800">{fmtAED(allTotal)}</div>
        </div>
      </div>

      {editable ? (
        <Card className="space-y-2 p-3">
          <MicroLabel>Charge a fine</MicroLabel>
          <div>
            <Label>Reason</Label>
            <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Late arrival, damaged tools, lost uniform…" />
          </div>
          <div className="flex gap-2">
            <div className="flex-1">
              <Label>Amount (AED)</Label>
              <Input type="number" min={0} step="0.01" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="100" />
            </div>
            <div className="flex-1">
              <Label>Date</Label>
              <DatePicker value={date} onChange={setDate} />
            </div>
          </div>
          {error ? <p className="text-[11px] text-red-600">{error}</p> : null}
          <Button variant="primary" onClick={add}>
            <Plus size={13} /> Add fine
          </Button>
        </Card>
      ) : null}

      <div>
        <MicroLabel className="mb-1.5">Fines — {mine.length}</MicroLabel>
        {mine.length === 0 ? (
          <div className="rounded-xl border border-dashed border-[#e5e5e2] px-3 py-4 text-center text-[12px] text-zinc-400">No fines charged to this employee.</div>
        ) : (
          <div className="divide-y divide-[#f1f1ef] rounded-xl border border-[#eae4d9]">
            {mine.map((f) => (
              <div key={f.id} className="flex items-center gap-2 px-3 py-2">
                <span className="w-16 shrink-0 text-[11px] text-zinc-500">{fmtDate(f.fine_date)}</span>
                <span className="flex min-w-0 flex-1 items-center gap-1.5">
                  <Receipt size={11} className="shrink-0 text-zinc-300" />
                  <span className="min-w-0 truncate text-[12px] text-zinc-700">{f.reason}</span>
                </span>
                <span className="shrink-0 text-[12px] font-semibold tabular-nums text-red-600">−{fmtAED(f.amount)}</span>
                {editable ? (
                  <button onClick={() => remove(f.id)} className="shrink-0 rounded-md p-1 text-zinc-300 hover:bg-red-50 hover:text-red-600" aria-label="Delete fine">
                    <Trash2 size={12} />
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </div>

      <p className="text-[10px] leading-relaxed text-zinc-300">Fines dated in a month are deducted from that month&apos;s salary on the Overview payroll.</p>
    </div>
  );
}

/* ─────────────────────────────── payments ───────────────────────────────── */

export function PaymentsPanel({ person, editable }: { person: StaffMember; editable: boolean }) {
  const { db, setDb } = useDb();
  const [kind, setKind] = useState<"paid" | "received">("paid");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(todayISO());
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  const mine = useMemo(
    () => db.staff_transactions.filter((t) => t.staff_id === person.id).sort((a, b) => (a.txn_date < b.txn_date ? 1 : -1)),
    [db.staff_transactions, person.id]
  );
  const paid = mine.filter((t) => t.kind === "paid").reduce((s, t) => s + t.amount, 0);
  const received = mine.filter((t) => t.kind === "received").reduce((s, t) => s + t.amount, 0);

  function add() {
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0) return setError("Enter an amount above zero.");
    if (!date) return setError("Pick the date.");
    setError(null);
    const row: StaffTransaction = {
      id: uid("pay"),
      staff_id: person.id,
      kind,
      amount: Math.round(value * 100) / 100,
      txn_date: date,
      note: note.trim() || null,
      created_at: new Date().toISOString(),
    };
    setDb((prev) => (prev ? { ...prev, staff_transactions: upsertById(prev.staff_transactions, row) } : prev));
    setAmount("");
    setNote("");
  }

  function remove(id: string) {
    if (!window.confirm("Delete this transaction?")) return;
    setDb((prev) => (prev ? { ...prev, staff_transactions: removeById(prev.staff_transactions, id) } : prev));
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-xl border border-[#eae4d9] bg-white px-2.5 py-2">
          <div className="text-[9px] font-medium uppercase tracking-wide text-zinc-400">Paid out</div>
          <div className="mt-0.5 text-[13px] font-semibold tabular-nums text-zinc-900">{fmtAED(paid)}</div>
        </div>
        <div className="rounded-xl border border-[#eae4d9] bg-white px-2.5 py-2">
          <div className="text-[9px] font-medium uppercase tracking-wide text-zinc-400">Received</div>
          <div className="mt-0.5 text-[13px] font-semibold tabular-nums text-emerald-700">{fmtAED(received)}</div>
        </div>
        <div className="rounded-xl border border-[#eae4d9] bg-[#faf8f4] px-2.5 py-2">
          <div className="text-[9px] font-medium uppercase tracking-wide text-zinc-400">Held</div>
          <div className="mt-0.5 text-[13px] font-semibold tabular-nums text-zinc-900">{fmtAED(paid - received)}</div>
        </div>
      </div>

      {editable ? (
        <Card className="space-y-2 p-3">
          <MicroLabel>Record a transaction</MicroLabel>
          <div className="grid grid-cols-2 gap-1 rounded-lg border border-[#e5e5e2] p-1">
            <button
              onClick={() => setKind("paid")}
              className={"rounded-md px-2 py-1.5 text-[11px] font-medium transition-colors " + (kind === "paid" ? "bg-zinc-900 text-white" : "text-zinc-500 hover:text-zinc-800")}
            >
              We gave money
            </button>
            <button
              onClick={() => setKind("received")}
              className={"rounded-md px-2 py-1.5 text-[11px] font-medium transition-colors " + (kind === "received" ? "bg-zinc-900 text-white" : "text-zinc-500 hover:text-zinc-800")}
            >
              We received money
            </button>
          </div>
          <div>
            <Label>Amount</Label>
            <Input type="number" inputMode="decimal" min={0} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="500" />
          </div>
          <div>
            <Label>Date</Label>
            <DatePicker value={date} onChange={setDate} />
          </div>
          <div>
            <Label>Note</Label>
            <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Salary advance, cash returned…" />
          </div>
          {error ? <p className="text-[11px] text-red-600">{error}</p> : null}
          <Button variant="primary" onClick={add}>
            <Plus size={13} /> Save transaction
          </Button>
        </Card>
      ) : null}

      <div>
        <MicroLabel className="mb-1.5">History — {mine.length}</MicroLabel>
        {mine.length === 0 ? (
          <div className="rounded-xl border border-dashed border-[#e5e5e2] px-3 py-4 text-center text-[12px] text-zinc-400">No transactions with this employee yet.</div>
        ) : (
          <div className="divide-y divide-[#f1f1ef] rounded-xl border border-[#eae4d9]">
            {mine.map((t) => (
              <div key={t.id} className="flex items-center gap-2 px-3 py-2">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12px] font-medium text-zinc-800">
                    {t.kind === "paid" ? "Gave" : "Received"} {fmtAED(t.amount)}
                  </span>
                  <span className="block truncate text-[10px] text-zinc-400">
                    {fmtDate(t.txn_date)}
                    {t.note ? " · " + t.note : ""}
                  </span>
                </span>
                <span className={"shrink-0 text-[12px] font-semibold tabular-nums " + (t.kind === "paid" ? "text-zinc-800" : "text-emerald-600")}>
                  {t.kind === "paid" ? "−" : "+"}
                  {fmtAED(t.amount)}
                </span>
                {editable ? (
                  <button onClick={() => remove(t.id)} className="shrink-0 rounded-md p-1 text-zinc-300 hover:bg-red-50 hover:text-red-600" aria-label="Delete transaction">
                    <Trash2 size={12} />
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ──────────────────────────────── helpers ───────────────────────────────── */

export function daysBetween(from: string, to: string): number {
  const a = new Date(from + "T00:00:00").getTime();
  const b = new Date(to + "T00:00:00").getTime();
  return Math.max(0, Math.round((b - a) / 86400000) + 1);
}

function leaveDaysInYear(leaves: StaffLeave[], year: string): number {
  return leaves.reduce((sum, l) => sum + (l.from_date.slice(0, 4) === year ? daysBetween(l.from_date, l.to_date) : 0), 0);
}

function fmtHours(h: number): string {
  const rounded = Math.round(h * 100) / 100;
  return rounded + (rounded === 1 ? " hour" : " hours");
}
