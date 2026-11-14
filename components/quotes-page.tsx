"use client";
import React, { useMemo, useState } from "react";
import { ArrowDownLeft, CheckCircle2, ChevronRight, Clock, FileSignature, Pencil, Plus, XCircle } from "lucide-react";
import { PageHeader, useQuickEntry } from "@/components/app-shell";
import { Button, Card, EmptyState, Input, Label, MicroLabel, Modal, Pill, SearchInput, SlideOver, StatCard, Toast } from "@/components/ui";
import { DatePicker } from "@/components/date-picker";
import { PartyInput } from "@/components/party-input";
import { useDb, useDbContext } from "@/lib/local-db";
import { ensureParty, isQuoteOpen, nextQuoteNo, uid, upsertQuote } from "@/lib/repo";
import { fmtAED, fmtDate, todayISO } from "@/lib/format";
import type { Party, Quote, QuoteStatus } from "@/lib/types";

const STATUS_ORDER: QuoteStatus[] = ["review", "approved", "completed", "rejected"];

const STATUS_META: Record<QuoteStatus, { label: string; tone: "amber" | "emerald" | "blue" | "red"; icon: React.ReactNode }> = {
  review: { label: "Under review", tone: "amber", icon: <Clock size={10} /> },
  approved: { label: "Approved", tone: "emerald", icon: <CheckCircle2 size={10} /> },
  completed: { label: "Completed", tone: "blue", icon: <CheckCircle2 size={10} /> },
  rejected: { label: "Rejected", tone: "red", icon: <XCircle size={10} /> },
};

export function StatusPill({ status }: { status: QuoteStatus }) {
  const meta = STATUS_META[status];
  return (
    <Pill tone={meta.tone}>
      {meta.icon} {meta.label}
    </Pill>
  );
}

export function QuotesPage() {
  const { db, setDb } = useDb();
  const { canEdit } = useDbContext();
  const editable = canEdit("/quotes");
  const { openQuickEntry } = useQuickEntry();

  const [status, setStatus] = useState<"all" | QuoteStatus>("all");
  const [q, setQ] = useState("");
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Quote | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const clientName = (id: string | null | undefined) => db.parties.find((p) => p.id === id)?.name ?? "—";
  const collectedOf = (quoteId: string) =>
    db.transactions.filter((t) => t.quote_id === quoteId && t.kind === "income").reduce((s, t) => s + t.amount, 0);
  const spentOf = (quoteId: string) => db.transactions.filter((t) => t.quote_id === quoteId && t.kind === "expense").reduce((s, t) => s + t.amount, 0);

  const quotes = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return db.quotes
      .filter((x) => (status === "all" ? true : x.status === status))
      .filter((x) => !needle || x.quote_no.toLowerCase().includes(needle) || clientName(x.client_id).toLowerCase().includes(needle))
      .sort((a, b) => (a.quote_no < b.quote_no ? 1 : -1));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db.quotes, db.parties, status, q]);

  const selected = selectedId ? db.quotes.find((x) => x.id === selectedId) ?? null : null;

  const live = db.quotes.filter((x) => x.status !== "rejected");
  const quotedTotal = live.reduce((s, x) => s + x.amount, 0);
  const approvedTotal = db.quotes.filter((x) => isQuoteOpen(x)).reduce((s, x) => s + x.amount, 0);
  const collectedTotal = db.transactions.filter((t) => t.kind === "income" && t.quote_id && db.quotes.some((x) => x.id === t.quote_id)).reduce((s, t) => s + t.amount, 0);
  const pendingTotal = Math.max(0, approvedTotal - collectedTotal);

  function setStatusOf(quote: Quote, next: QuoteStatus) {
    setDb((prev) => (prev ? upsertQuote(prev, { ...quote, status: next }) : prev));
    setToast(`“${quote.quote_no}” is now ${STATUS_META[next].label.toLowerCase()}.`);
  }

  function saveQuote(input: { id: string | null; quote_no: string; clientName: string; amount: number; status: QuoteStatus; date: string; notes: string }) {
    const quoteNo = input.quote_no.trim();
    if (!quoteNo) return false;
    const clash = db.quotes.find((x) => x.quote_no.trim().toLowerCase() === quoteNo.toLowerCase() && x.id !== input.id);
    if (clash) {
      setToast(`Quotation ${quoteNo} already exists.`);
      return false;
    }
    setDb((prev) => {
      if (!prev) return prev;
      const base = prev;
      const existing = input.id ? base.quotes.find((x) => x.id === input.id) ?? null : null;
      const { db: withParty, party } = ensureParty(base, "client", input.clientName);
      if (!party) return base;
      const row: Quote = {
        id: input.id ?? uid("q"),
        quote_no: quoteNo,
        client_id: party.id,
        amount: Math.round(input.amount * 100) / 100,
        status: input.status,
        quote_date: input.date || null,
        notes: input.notes.trim() || null,
        created_at: existing?.created_at ?? new Date().toISOString(),
      };
      // ensureParty may have created the client — write both in one update.
      return upsertQuote(withParty, row);
    });
    setToast(`Quotation ${quoteNo} saved.`);
    return true;
  }

  return (
    <div>
      <PageHeader
        title="Quotations"
        subtitle="Every quote as a project — its client, value, status, and the money coming in and going out against it."
        actions={
          editable ? (
            <Button variant="primary" onClick={() => setCreating(true)}>
              <Plus size={13} /> New Quote
            </Button>
          ) : null
        }
      />

      <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard title="Quoted" icon={<FileSignature size={15} />} value={fmtAED(quotedTotal)} sub={`${live.length} live quote${live.length === 1 ? "" : "s"}`} />
        <StatCard title="Approved" value={fmtAED(approvedTotal)} sub="Open projects" tone={approvedTotal > 0 ? "ok" : "plain"} />
        <StatCard title="Collected" icon={<ArrowDownLeft size={15} />} value={fmtAED(collectedTotal)} sub="Income tagged to quotes" />
        <StatCard title="Pending" icon={<Clock size={15} />} value={fmtAED(pendingTotal)} sub="Still to collect" tone={pendingTotal > 0 ? "warn" : "plain"} />
      </div>

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#eae4d9] bg-[#faf8f4] px-4 py-2.5">
          <MicroLabel>Quotations — {quotes.length}</MicroLabel>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex flex-wrap gap-1">
              {(["all", ...STATUS_ORDER] as ("all" | QuoteStatus)[]).map((s) => (
                <button
                  key={s}
                  onClick={() => setStatus(s)}
                  className={
                    "rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors " +
                    (status === s ? "border-zinc-900 bg-zinc-900 text-white" : "border-[#e5e5e2] bg-white text-zinc-500 hover:border-zinc-400")
                  }
                >
                  {s === "all" ? "All" : STATUS_META[s].label}
                </button>
              ))}
            </div>
            <div className="w-full sm:w-48">
              <SearchInput value={q} onChange={setQ} placeholder="Quote no. or client" className="w-full" />
            </div>
          </div>
        </div>

        {quotes.length === 0 ? (
          <div className="p-6">
            <EmptyState
              icon={<FileSignature size={18} />}
              title={db.quotes.length === 0 ? "No quotations yet" : "Nothing in this state"}
              hint={
                db.quotes.length === 0
                  ? editable
                    ? "Create a quote, then tag income and expenses to it."
                    : "Ask an admin to add quotations."
                  : "Try a different filter, or clear the search."
              }
            />
            {editable && db.quotes.length === 0 ? (
              <div className="mt-3 flex justify-center">
                <Button variant="primary" onClick={() => setCreating(true)}>
                  <Plus size={13} /> New Quote
                </Button>
              </div>
            ) : null}
          </div>
        ) : (
          <div>
            {quotes.map((quote) => {
              const collected = collectedOf(quote.id);
              const pending = Math.max(0, quote.amount - collected);
              const pct = quote.amount > 0 ? Math.min(100, Math.round((collected / quote.amount) * 100)) : 0;
              return (
                <button
                  key={quote.id}
                  onClick={() => setSelectedId(quote.id)}
                  className="group flex w-full items-center gap-3 border-b border-[#f0ece4] px-4 py-3 text-left transition-colors last:border-b-0 hover:bg-[#faf8f4]"
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[#eae4d9] bg-[#f4efe8] text-zinc-400">
                    <FileSignature size={14} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-sm font-semibold text-zinc-900">{quote.quote_no}</span>
                      <StatusPill status={quote.status} />
                    </span>
                    <span className="block truncate text-[11px] text-zinc-400">
                      {clientName(quote.client_id)}
                      {quote.quote_date ? " · " + fmtDate(quote.quote_date) : ""}
                    </span>
                  </span>
                  <span className="hidden w-40 shrink-0 sm:block">
                    <span className="block h-1.5 overflow-hidden rounded-full bg-[#f1ece3]">
                      <span className="block h-full rounded-full bg-emerald-500" style={{ width: pct + "%" }} />
                    </span>
                    <span className="mt-1 block text-[10px] tabular-nums text-zinc-400">
                      {fmtAED(collected)} of {fmtAED(quote.amount)}
                    </span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span className="block text-[13px] font-semibold tabular-nums text-zinc-900">{fmtAED(quote.amount)}</span>
                    <span className={"block text-[10px] tabular-nums " + (pending > 0 ? "text-amber-600" : "text-emerald-600")}>
                      {isQuoteOpen(quote) ? (pending > 0 ? fmtAED(pending) + " pending" : "Fully collected") : "—"}
                    </span>
                  </span>
                  <ChevronRight size={16} className="hidden shrink-0 text-zinc-300 group-hover:text-zinc-500 sm:block" />
                </button>
              );
            })}
          </div>
        )}
      </Card>

      {creating || editing ? (
        <QuoteModal
          existing={editing}
          suggestedNo={nextQuoteNo(db)}
          clients={db.parties.filter((p) => p.kind === "client")}
          clientName={clientName}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          onSave={(input) => {
            if (saveQuote(input)) {
              setCreating(false);
              setEditing(null);
            }
          }}
        />
      ) : null}

      {selected ? (
        <QuoteDrawer
          quote={selected}
          clientName={clientName(selected.client_id)}
          collected={collectedOf(selected.id)}
          spent={spentOf(selected.id)}
          entries={db.transactions.filter((t) => t.quote_id === selected.id).sort((a, b) => (a.txn_date < b.txn_date ? 1 : -1))}
          editable={editable}
          onClose={() => setSelectedId(null)}
          onEdit={() => setEditing(selected)}
          onStatus={(next) => setStatusOf(selected, next)}
          onAdd={(kind) => {
            const party = db.parties.find((p) => p.id === selected.client_id);
            openQuickEntry(kind, party ? { id: party.id, name: party.name } : null, { id: selected.id, quote_no: selected.quote_no });
          }}
        />
      ) : null}

      <Toast message={toast} />
    </div>
  );
}

/* ───────────────────────────── create / edit ────────────────────────────── */

function QuoteModal({
  existing,
  suggestedNo,
  clients,
  clientName,
  onClose,
  onSave,
}: {
  existing: Quote | null;
  suggestedNo: string;
  clients: Party[];
  clientName: (id: string | null | undefined) => string;
  onClose: () => void;
  onSave: (input: { id: string | null; quote_no: string; clientName: string; amount: number; status: QuoteStatus; date: string; notes: string }) => void;
}) {
  const [quoteNo, setQuoteNo] = useState(existing?.quote_no ?? suggestedNo);
  const [client, setClient] = useState(existing ? clientName(existing.client_id) : "");
  const [amount, setAmount] = useState(existing ? String(existing.amount) : "");
  const [status, setStatus] = useState<QuoteStatus>(existing?.status ?? "review");
  const [date, setDate] = useState(existing?.quote_date ?? todayISO());
  const [notes, setNotes] = useState(existing?.notes ?? "");
  const [error, setError] = useState<string | null>(null);

  function submit() {
    const value = Number(amount);
    if (!quoteNo.trim()) return setError("Enter the quotation number.");
    if (!client.trim()) return setError("Enter the client — a new one is created if needed.");
    if (!Number.isFinite(value) || value <= 0) return setError("Enter the quotation value.");
    setError(null);
    onSave({ id: existing?.id ?? null, quote_no: quoteNo, clientName: client, amount: value, status, date, notes });
  }

  return (
    <Modal open onClose={onClose} title={existing ? "Edit quotation " + existing.quote_no : "New quotation"}>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Quotation number</Label>
            <Input value={quoteNo} onChange={(e) => setQuoteNo(e.target.value)} placeholder="Q-001" autoFocus />
          </div>
          <div>
            <Label>Quote date</Label>
            <DatePicker value={date} onChange={setDate} />
          </div>
        </div>

        <div>
          <Label>Client</Label>
          <PartyInput value={client} onChange={setClient} parties={clients} kindLabel="client" placeholder="Type a client — or a new one" />
        </div>

        <div>
          <Label>Quotation value (AED)</Label>
          <Input type="number" min={0} step="0.01" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="25000" />
        </div>

        <div>
          <Label>Status</Label>
          <div className="grid grid-cols-2 gap-1.5">
            {STATUS_ORDER.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setStatus(s)}
                className={
                  "rounded-lg border px-2 py-1.5 text-[11px] font-medium transition-colors " +
                  (status === s ? "border-zinc-900 bg-zinc-900 text-white" : "border-[#e5e5e2] bg-white text-zinc-500 hover:border-zinc-400")
                }
              >
                {STATUS_META[s].label}
              </button>
            ))}
          </div>
          <p className="mt-1 text-[10px] text-zinc-400">
            {status === "review"
              ? "Under review — income and expenses cannot be tagged until it is approved."
              : status === "rejected"
                ? "Rejected quotes are kept out of the totals."
                : "Approved quotes can take income and expenses."}
          </p>
        </div>

        <div>
          <Label>Notes</Label>
          <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Scope, terms, anything worth remembering…" />
        </div>

        {error ? <p className="text-[11px] text-red-600">{error}</p> : null}

        <div className="flex justify-end gap-2 border-t border-[#efefec] pt-3">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={submit}>
            {existing ? "Save changes" : "Create quote"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/* ──────────────────────────────── project ───────────────────────────────── */

function QuoteDrawer({
  quote,
  clientName,
  collected,
  spent,
  entries,
  editable,
  onClose,
  onEdit,
  onStatus,
  onAdd,
}: {
  quote: Quote;
  clientName: string;
  collected: number;
  spent: number;
  entries: { id: string; kind: "income" | "expense"; txn_date: string; amount: number; description?: string | null }[];
  editable: boolean;
  onClose: () => void;
  onEdit: () => void;
  onStatus: (next: QuoteStatus) => void;
  onAdd: (kind: "income" | "expense") => void;
}) {
  const pending = Math.max(0, quote.amount - collected);
  const pct = quote.amount > 0 ? Math.min(100, Math.round((collected / quote.amount) * 100)) : 0;
  const open = isQuoteOpen(quote);
  const income = entries.filter((e) => e.kind === "income");
  const expenses = entries.filter((e) => e.kind === "expense");

  return (
    <SlideOver
      open
      onClose={onClose}
      title={
        <span className="flex min-w-0 items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-[#eae4d9] bg-[#f4efe8] text-zinc-400">
            <FileSignature size={14} />
          </span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold text-zinc-900">{quote.quote_no}</span>
            <span className="block truncate text-[11px] text-zinc-400">{clientName}</span>
          </span>
        </span>
      }
      subtitle={quote.quote_date ? "Quoted " + fmtDate(quote.quote_date) : undefined}
      footer={
        <>
          <Button onClick={onClose}>Close</Button>
          {editable ? (
            <>
              <Button onClick={onEdit}>
                <Pencil size={12} /> Edit
              </Button>
              <Button variant="primary" disabled={!open} onClick={() => onAdd("income")}>
                <ArrowDownLeft size={12} /> Add income
              </Button>
            </>
          ) : null}
        </>
      }
    >
      <div className="space-y-4 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <StatusPill status={quote.status} />
          {editable ? (
            <div className="flex flex-wrap gap-1">
              {STATUS_ORDER.filter((s) => s !== quote.status).map((s) => (
                <button
                  key={s}
                  onClick={() => onStatus(s)}
                  className="rounded-full border border-[#e5e5e2] bg-white px-2 py-0.5 text-[10px] font-medium text-zinc-500 transition-colors hover:border-zinc-400 hover:text-zinc-800"
                >
                  Mark {STATUS_META[s].label.toLowerCase()}
                </button>
              ))}
            </div>
          ) : null}
        </div>

        <div className="grid grid-cols-2 gap-2">
          <MiniStat label="Quote value" value={fmtAED(quote.amount)} />
          <MiniStat label="Collected" value={fmtAED(collected)} tone="emerald" />
          <MiniStat label="Expenses" value={fmtAED(spent)} />
          <MiniStat label="Pending" value={fmtAED(pending)} tone={pending > 0 ? "amber" : "emerald"} />
        </div>

        <div>
          <div className="mb-1 flex items-center justify-between text-[10px] text-zinc-400">
            <span>{pct}% collected</span>
            <span>{fmtAED(collected)} / {fmtAED(quote.amount)}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-[#f1ece3]">
            <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: pct + "%" }} />
          </div>
        </div>

        {!open ? (
          <p className="rounded-xl border border-[#e9e9e6] bg-[#fbfbfa] px-3 py-2 text-[11px] leading-snug text-zinc-500">
            {quote.status === "review"
              ? "This quote is still under review. Approve it to start tagging income and expenses."
              : "This quote was rejected, so it takes no entries."}
          </p>
        ) : null}

        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <MicroLabel>Income — {income.length}</MicroLabel>
            {editable && open ? (
              <button onClick={() => onAdd("income")} className="inline-flex items-center gap-1 text-[10px] font-medium text-emerald-700 hover:underline">
                <Plus size={10} /> Add income
              </button>
            ) : null}
          </div>
          {income.length === 0 ? (
            <div className="rounded-xl border border-dashed border-[#e5e5e2] px-3 py-3 text-center text-[11px] text-zinc-400">No income tagged to this quote yet.</div>
          ) : (
            <div className="divide-y divide-[#f1f1ef] rounded-xl border border-[#eae4d9]">
              {income.map((e) => (
                <div key={e.id} className="flex items-center gap-2 px-3 py-2">
                  <span className="w-16 shrink-0 text-[11px] text-zinc-500">{fmtDate(e.txn_date)}</span>
                  <span className="min-w-0 flex-1 truncate text-[12px] text-zinc-700">{e.description || "Income"}</span>
                  <span className="shrink-0 text-[12px] font-semibold tabular-nums text-emerald-600">+{fmtAED(e.amount)}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <MicroLabel>Expenses — {expenses.length}</MicroLabel>
            {editable && open ? (
              <button onClick={() => onAdd("expense")} className="inline-flex items-center gap-1 text-[10px] font-medium text-zinc-600 hover:underline">
                <Plus size={10} /> Add expense
              </button>
            ) : null}
          </div>
          {expenses.length === 0 ? (
            <div className="rounded-xl border border-dashed border-[#e5e5e2] px-3 py-3 text-center text-[11px] text-zinc-400">No expenses tagged to this quote yet.</div>
          ) : (
            <div className="divide-y divide-[#f1f1ef] rounded-xl border border-[#eae4d9]">
              {expenses.map((e) => (
                <div key={e.id} className="flex items-center gap-2 px-3 py-2">
                  <span className="w-16 shrink-0 text-[11px] text-zinc-500">{fmtDate(e.txn_date)}</span>
                  <span className="min-w-0 flex-1 truncate text-[12px] text-zinc-700">{e.description || "Expense"}</span>
                  <span className="shrink-0 text-[12px] font-semibold tabular-nums text-zinc-800">−{fmtAED(e.amount)}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {quote.notes ? <p className="rounded-xl border border-[#e9e9e6] bg-[#fbfbfa] px-3 py-2 text-[12px] leading-snug text-zinc-600">{quote.notes}</p> : null}

        <p className="text-[10px] leading-relaxed text-zinc-300">
          Tag a quote on any income or expense by typing its number in the entry form — only approved and completed quotes can take entries.
        </p>
      </div>
    </SlideOver>
  );
}

function MiniStat({ label, value, tone = "plain" }: { label: string; value: string; tone?: "plain" | "emerald" | "amber" }) {
  const color = tone === "emerald" ? "text-emerald-600" : tone === "amber" ? "text-amber-600" : "text-zinc-900";
  return (
    <div className="rounded-xl border border-[#eae4d9] bg-white px-3 py-2">
      <div className="text-[9px] font-medium uppercase tracking-wide text-zinc-400">{label}</div>
      <div className={"mt-0.5 text-[15px] font-semibold tabular-nums " + color}>{value}</div>
    </div>
  );
}

export { STATUS_META, STATUS_ORDER };
