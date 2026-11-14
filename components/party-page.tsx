"use client";
import React, { useMemo, useState } from "react";
import { Plus, Receipt, Truck, Users } from "lucide-react";
import { PageHeader, useQuickEntry } from "@/components/app-shell";
import { Button, Card, EmptyState, Input, Label, MicroLabel, Modal, SearchInput, SelectMenu, SlideOver, StatCard, Toast } from "@/components/ui";
import { useDb, useDbContext } from "@/lib/local-db";
import { upsertParty } from "@/lib/repo";
import { fmtAED, fmtDate, fmtDateShort, monthLabel, monthOf, todayISO } from "@/lib/format";
import type { Party, PartyKind, Transaction } from "@/lib/types";

type PartyConfig = {
  title: string;
  route: string;
  txKind: Transaction["kind"];
  noun: string;
  totalLabel: string;
  blurb: string;
};

const CONFIG: Record<PartyKind, PartyConfig> = {
  supplier: {
    title: "Suppliers",
    route: "/suppliers",
    txKind: "expense",
    noun: "supplier",
    totalLabel: "Total spent",
    blurb: "Everyone you buy from — materials, fuel and services, grouped per supplier.",
  },
  client: {
    title: "Clients",
    route: "/clients",
    txKind: "income",
    noun: "client",
    totalLabel: "Total received",
    blurb: "Everyone who pays you — income grouped per client, newest activity first.",
  },
};

type PartyStat = { total: number; count: number; last: string | null; thisMonth: number };

export function PartyPage({ kind }: { kind: PartyKind }) {
  const cfg = CONFIG[kind];
  const { db, setDb } = useDb();
  const { canEdit, schemaIssues } = useDbContext();
  const { openQuickEntry } = useQuickEntry();
  const editable = canEdit(cfg.route);

  const [q, setQ] = useState("");
  const [adding, setAdding] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const parties = useMemo(
    () => db.parties.filter((p) => p.kind === kind && !p.archived).sort((a, b) => a.name.localeCompare(b.name)),
    [db.parties, kind]
  );

  const stats = useMemo(() => {
    const map = new Map<string, PartyStat>();
    const ym = todayISO().slice(0, 7);
    for (const p of parties) map.set(p.id, { total: 0, count: 0, last: null, thisMonth: 0 });
    for (const t of db.transactions) {
      if (t.kind !== cfg.txKind || !t.party_id) continue;
      const s = map.get(t.party_id);
      if (!s) continue;
      s.total += t.amount;
      s.count += 1;
      if (!s.last || t.txn_date > s.last) s.last = t.txn_date;
      if (monthOf(t.txn_date) === ym) s.thisMonth += t.amount;
    }
    return map;
  }, [parties, db.transactions, cfg.txKind]);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return parties
      .map((party) => ({ party, ...(stats.get(party.id) ?? { total: 0, count: 0, last: null, thisMonth: 0 }) }))
      .filter((r) => !needle || r.party.name.toLowerCase().includes(needle))
      .sort((a, b) => b.total - a.total || a.party.name.localeCompare(b.party.name));
  }, [parties, stats, q]);

  const grandTotal = rows.reduce((s, r) => s + r.total, 0);
  const thisMonthTotal = rows.reduce((s, r) => s + r.thisMonth, 0);
  const selected = selectedId ? parties.find((p) => p.id === selectedId) ?? null : null;
  const selectedTxns = useMemo(
    () =>
      selected
        ? db.transactions
            .filter((t) => t.party_id === selected.id && t.kind === cfg.txKind)
            .sort((a, b) => (a.txn_date < b.txn_date ? 1 : a.txn_date > b.txn_date ? -1 : 0))
        : [],
    [db.transactions, selected, cfg.txKind]
  );

  /** Start a new entry with this supplier/client already attached. */
  function addEntry(party: Party) {
    openQuickEntry(cfg.txKind, { id: party.id, name: party.name });
    setSelectedId(null);
  }

  function addParty(name: string, phone: string, email: string, notes: string) {
    const trimmed = name.trim().replace(/\s+/g, " ");
    if (!trimmed) return false;
    const clash = db.parties.some((p) => p.kind === kind && p.name.trim().toLowerCase() === trimmed.toLowerCase());
    if (clash) {
      setToast(`A ${cfg.noun} called “${trimmed}” already exists.`);
      return false;
    }
    setDb((prev) =>
      prev
        ? upsertParty(prev, {
            id: "pt_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
            kind,
            name: trimmed,
            phone: phone.trim() || null,
            email: email.trim() || null,
            notes: notes.trim() || null,
            created_at: new Date().toISOString(),
          })
        : prev
    );
    setToast(`${trimmed} added.`);
    return true;
  }

  const Icon = kind === "supplier" ? Truck : Users;

  return (
    <div>
      <PageHeader
        title={cfg.title}
        subtitle={cfg.blurb}
        actions={
          editable ? (
            <Button variant="primary" onClick={() => setAdding(true)}>
              <Plus size={13} /> Add {cfg.noun}
            </Button>
          ) : null
        }
      />

      {schemaIssues.length > 0 ? (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[12px] leading-relaxed text-amber-800">
          <p className="font-semibold">Database update needed before {cfg.title.toLowerCase()} can save</p>
          {schemaIssues.map((issue) => (
            <p key={issue} className="mt-1">{issue}</p>
          ))}
        </div>
      ) : null}

      <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          title={cfg.title}
          icon={<Icon size={15} />}
          value={String(rows.length)}
          sub={rows.length === 1 ? `1 ${cfg.noun}` : `${rows.length} ${cfg.noun}s`}
        />
        <StatCard title={cfg.totalLabel} value={fmtAED(grandTotal)} sub="All time" tone={kind === "supplier" ? "plain" : "ok"} />
        <StatCard title="This month" value={fmtAED(thisMonthTotal)} sub={monthLabel(todayISO().slice(0, 7))} />
        <StatCard
          title="With activity"
          value={String(rows.filter((r) => r.count > 0).length)}
          sub="Have linked entries"
        />
      </div>

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#eae4d9] bg-[#faf8f4] px-4 py-2.5">
          <MicroLabel>
            {cfg.title} — {rows.length}
          </MicroLabel>
          <div className="w-full sm:w-52">
            <SearchInput value={q} onChange={setQ} placeholder={`Search ${cfg.noun}s`} className="w-full" />
          </div>
        </div>

        {rows.length === 0 ? (
          <div className="p-6">
            <EmptyState
              icon={<Icon size={18} />}
              title={`No ${cfg.noun}s yet`}
              hint={
                editable
                  ? `Add one here, or type a new name on a${cfg.txKind === "expense" ? "n expense" : "n income"} entry — it is created automatically.`
                  : `Ask an admin to add ${cfg.noun}s.`
              }
            />
            {editable ? (
              <div className="mt-3 flex justify-center">
                <Button variant="primary" onClick={() => setAdding(true)}>
                  <Plus size={13} /> Add {cfg.noun}
                </Button>
              </div>
            ) : null}
          </div>
        ) : (
          <>
            <div className="hidden border-b border-[#eae4d9] px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-300 md:grid md:grid-cols-[minmax(0,2.2fr)_90px_140px_150px_110px_20px] md:items-center md:gap-3">
              <span>Name</span>
              <span className="text-right">Entries</span>
              <span className="text-right">This month</span>
              <span className="text-right">{cfg.totalLabel}</span>
              <span className="text-right">Last activity</span>
              <span />
            </div>
            <div>
              {rows.map((r) => (
                <button
                  key={r.party.id}
                  onClick={() => setSelectedId(r.party.id)}
                  className="group grid w-full grid-cols-1 items-center gap-1.5 border-b border-[#f0ece4] px-4 py-3 text-left transition-colors last:border-b-0 hover:bg-[#faf8f4] md:grid-cols-[minmax(0,2.2fr)_90px_140px_150px_110px_20px] md:gap-3"
                >
                  <span className="flex min-w-0 items-center gap-3">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[#eae4d9] bg-[#f4efe8] text-[11px] font-bold text-zinc-500">
                      {monogram(r.party.name)}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold text-zinc-900">{r.party.name}</span>
                      <span className="block truncate text-[11px] text-zinc-400">
                        {r.party.phone || r.party.email || (r.count === 0 ? "No entries linked yet" : "—")}
                      </span>
                    </span>
                  </span>
                  <span className="text-[12px] tabular-nums text-zinc-500 md:text-right">{r.count}</span>
                  <span className="text-[13px] font-semibold tabular-nums text-zinc-700 md:text-right">{fmtAED(r.thisMonth)}</span>
                  <span className="text-[13px] font-semibold tabular-nums text-zinc-900 md:text-right">{fmtAED(r.total)}</span>
                  <span className="text-[11px] text-zinc-400 md:text-right">{r.last ? fmtDate(r.last) : "—"}</span>
                  <svg className="hidden h-4 w-4 text-zinc-300 transition-colors group-hover:text-zinc-500 md:block" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m9 18 6-6-6-6" /></svg>
                </button>
              ))}
            </div>
          </>
        )}
      </Card>

      {adding ? (
        <AddPartyModal
          kind={kind}
          noun={cfg.noun}
          existing={parties}
          onClose={() => setAdding(false)}
          onAdd={(name, phone, email, notes) => {
            if (addParty(name, phone, email, notes)) setAdding(false);
          }}
        />
      ) : null}

      {selected ? (
        <PartyProfile
          party={selected}
          noun={cfg.noun}
          txKind={cfg.txKind}
          txns={selectedTxns}
          onClose={() => setSelectedId(null)}
          onAdd={editable ? () => addEntry(selected) : undefined}
        />
      ) : null}

      <Toast message={toast} />
    </div>
  );
}

/* ───────────────────────────── Add dialog ───────────────────────────────── */

function AddPartyModal({
  kind,
  noun,
  existing,
  onClose,
  onAdd,
}: {
  kind: PartyKind;
  noun: string;
  existing: Party[];
  onClose: () => void;
  onAdd: (name: string, phone: string, email: string, notes: string) => void;
}) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [notes, setNotes] = useState("");
  const duplicate = !!name.trim() && existing.some((p) => p.name.trim().toLowerCase() === name.trim().toLowerCase());

  return (
    <Modal open onClose={onClose} title={`Add ${noun}`}>
      <div className="space-y-3">
        <div>
          <Label>Name</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={kind === "supplier" ? "e.g. Red Sea Aluminium & Glass Co." : "e.g. AXL Technical Services"} autoFocus />
          {duplicate ? <p className="mt-1 text-[11px] text-red-600">That {noun} already exists.</p> : null}
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <Label>Phone</Label>
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="optional" />
          </div>
          <div>
            <Label>Email</Label>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="optional" />
          </div>
        </div>
        <div>
          <Label>Notes</Label>
          <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="TRN, terms, contact person…" />
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!name.trim() || duplicate} onClick={() => onAdd(name, phone, email, notes)}>
            Add {noun}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/* ───────────────────────────── Profile drawer ───────────────────────────── */

function PartyProfile({
  party,
  noun,
  txKind,
  txns,
  onClose,
  onAdd,
}: {
  party: Party;
  noun: string;
  txKind: Transaction["kind"];
  txns: Transaction[];
  onClose: () => void;
  onAdd?: () => void;
}) {
  const { db } = useDb();
  const [month, setMonth] = useState("all");
  const [q, setQ] = useState("");

  const months = useMemo(() => {
    const set = new Set(txns.map((t) => monthOf(t.txn_date)));
    return [...set].sort((a, b) => (a < b ? 1 : -1));
  }, [txns]);

  const total = txns.reduce((s, t) => s + t.amount, 0);
  const ym = todayISO().slice(0, 7);
  const thisMonth = txns.filter((t) => monthOf(t.txn_date) === ym).reduce((s, t) => s + t.amount, 0);
  const average = txns.length ? total / txns.length : 0;

  const monthly = useMemo(() => {
    const map = new Map<string, { count: number; total: number }>();
    for (const t of txns) {
      const m = monthOf(t.txn_date);
      const row = map.get(m) ?? { count: 0, total: 0 };
      row.count += 1;
      row.total += t.amount;
      map.set(m, row);
    }
    return [...map.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1));
  }, [txns]);

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return txns.filter((t) => {
      if (month !== "all" && monthOf(t.txn_date) !== month) return false;
      if (!needle) return true;
      return [t.description, t.notes, t.job_ref, t.voucher_no, String(t.amount)]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(needle);
    });
  }, [txns, month, q]);

  const nameOf = {
    category: (id: string | null | undefined) => db.categories.find((c) => c.id === id)?.name ?? "—",
    method: (id: string | null | undefined) => db.payment_methods.find((m) => m.id === id)?.name ?? "—",
  };

  return (
    <SlideOver
      open
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Close</Button>
          {onAdd ? (
            <Button variant="primary" onClick={onAdd}>
              <Plus size={13} /> Add {txKind === "expense" ? "expense" : "income"}
            </Button>
          ) : null}
        </>
      }
      title={
      <span className="flex items-center gap-2.5">
        <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-[#eae4d9] bg-[#f4efe8] text-[11px] font-bold text-zinc-500">{monogram(party.name)}</span>
        <span className="min-w-0 flex-col">
          <span className="block truncate text-sm font-semibold text-zinc-900">{party.name}</span>
          <span className="block truncate text-[11px] text-zinc-400">{party.phone || party.email || noun}</span>
        </span>
      </span>
          }
    >
      <div className="space-y-5 p-5">
        <div className="grid grid-cols-3 divide-x divide-[#f0ece4]">
          <div className="pr-4">
            <MicroLabel>{txKind === "expense" ? "Total spent" : "Total received"}</MicroLabel>
            <div className="mt-1 text-[18px] font-bold tabular-nums text-zinc-900">{fmtAED(total)}</div>
          </div>
          <div className="px-4">
            <MicroLabel>This month</MicroLabel>
            <div className="mt-1 text-[18px] font-bold tabular-nums text-zinc-900">{fmtAED(thisMonth)}</div>
          </div>
          <div className="pl-4">
            <MicroLabel>Entries</MicroLabel>
            <div className="mt-1 text-[18px] font-bold tabular-nums text-zinc-900">{txns.length}</div>
            <div className="text-[10px] text-zinc-400">avg {fmtAED(average)}</div>
          </div>
        </div>

        {party.notes ? (
          <p className="rounded-xl border border-[#e9e9e6] bg-[#fbfbfa] px-3 py-2 text-[12px] leading-snug text-zinc-600">{party.notes}</p>
        ) : null}

        <div>
          <MicroLabel className="mb-2">Monthly {txKind === "expense" ? "spend" : "income"}</MicroLabel>
          {monthly.length === 0 ? (
            <div className="rounded-xl border border-dashed border-[#e5e5e2] px-3 py-3 text-[12px] text-zinc-400">
              <p>No entries linked to this {noun} yet.</p>
              {onAdd ? (
                <button onClick={onAdd} className="mt-2 inline-flex items-center gap-1 rounded-lg bg-zinc-900 px-2.5 py-1.5 text-[11px] font-medium text-white transition-colors hover:bg-zinc-700">
                  <Plus size={11} /> Add transaction
                </button>
              ) : null}
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl border border-[#eae4d9]">
              {monthly.map(([m, row]) => (
                <div key={m} className="flex items-center justify-between border-b border-[#f1f1ef] px-3 py-2 text-[12px] last:border-0">
                  <span className="font-medium text-zinc-700">{monthLabel(m)}</span>
                  <span className="flex items-center gap-3">
                    <span className="text-[11px] text-zinc-400">{row.count} {row.count === 1 ? "entry" : "entries"}</span>
                    <span className="font-semibold tabular-nums text-zinc-900">{fmtAED(row.total)}</span>
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between gap-2">
            <MicroLabel>History</MicroLabel>
            <span className="text-[11px] text-zinc-400">{visible.length} of {txns.length}</span>
          </div>
          <div className="mb-2 grid grid-cols-1 gap-2 sm:grid-cols-[150px_minmax(0,1fr)]">
            <SelectMenu
              value={month}
              onChange={setMonth}
              placeholder="All months"
              options={[["all", "All months"], ...months.map((m) => [m, monthLabel(m)] as [string, string])]}
            />
            <SearchInput value={q} onChange={setQ} placeholder="Search entries" className="w-full" />
          </div>
          {visible.length === 0 ? (
            <p className="rounded-xl border border-dashed border-[#e5e5e2] px-3 py-4 text-center text-[12px] text-zinc-400">Nothing matches these filters.</p>
          ) : (
            <div className="overflow-hidden rounded-xl border border-[#eae4d9]">
              {visible.map((t) => (
                <div key={t.id} className="flex items-center gap-3 border-b border-[#f1f1ef] px-3 py-2 last:border-0">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[12px] font-medium text-zinc-800">{t.description || nameOf.category(t.category_id)}</div>
                    <div className="truncate text-[10px] text-zinc-400">
                      {fmtDateShort(t.txn_date)} · {nameOf.category(t.category_id)}
                      {nameOf.method(t.payment_method_id) !== "—" ? " · " + nameOf.method(t.payment_method_id) : ""}
                      {t.job_ref ? " · " + t.job_ref : ""}
                      {t.voucher_no ? " · V" + t.voucher_no : ""}
                    </div>
                  </div>
                  <span className={"shrink-0 text-[12px] font-semibold tabular-nums " + (txKind === "expense" ? "text-zinc-900" : "text-emerald-600")}>
                    {txKind === "expense" ? "−" : "+"}{fmtAED(t.amount)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center gap-1.5 text-[10px] text-zinc-300">
          <Receipt size={11} /> Linked by {noun} on entry
        </div>
      </div>
    </SlideOver>
  );
}

function monogram(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}
