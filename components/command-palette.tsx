"use client";
/**
 * ⌘K command palette — universal search.
 *
 * Indexes EVERY detail across the platform: transactions (job ref, voucher,
 * description, notes, category, method, amount, date), fleet (label, plate,
 * owner, TC number, Salik mobile/account/tag), dues accounts (provider,
 * label, account numbers), parties, categories, payment methods, plus page
 * navigation and quick actions.
 *
 * Matching is semantic-ish: normalization (case/whitespace/diacritics),
 * token matching, prefix matching, ordered subsequence ("nsn rogue" →
 * "Nissan Rogue") and loose subsequence ("hlx" → "Hilux"), digit-aware for
 * phones/account numbers. Enter opens the entity's detail view directly.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeftRight, CarFront, CornerDownLeft, Landmark, Plus, Search } from "lucide-react";
import { useQuickEntry } from "@/components/app-shell";
import { IconChip } from "@/components/ui";
import { fmtAED, fmtDate } from "@/lib/format";
import { rankDocs, type SearchDoc } from "@/lib/fuzzy";
import { duesProviderOf } from "@/lib/dues-providers";
import type { Database } from "@/lib/types";

/** Shape of one account as the authed /api/dues/accounts endpoint returns it. */
interface DuesApiAccount {
  id: string;
  provider_key: string;
  label: string;
  fields: Record<string, string>;
  active?: boolean;
}

interface Row {
  key: string;
  header?: string;
  chip: React.ReactNode;
  title: string;
  sub: string;
  run: () => void;
}

export function CommandPalette({ open, onClose, db }: { open: boolean; onClose: () => void; db: Database }) {
  const router = useRouter();
  const { openQuickEntry } = useQuickEntry();
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Dues accounts live server-side (Supabase) — fetch them when the palette
  // opens so the universal search covers every monitored account too.
  const [duesAccounts, setDuesAccounts] = useState<DuesApiAccount[]>([]);
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      try {
        const { getSupabase } = await import("@/lib/supabase");
        const token = (await getSupabase().auth.getSession()).data.session?.access_token ?? "";
        const res = await fetch("/api/dues/accounts", { headers: { Authorization: "Bearer " + token } });
        if (!res.ok) return;
        const json = await res.json();
        if (!cancelled) setDuesAccounts(json.accounts ?? []);
      } catch {
        /* search stays transaction/fleet-only when dues are unreachable */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (open) {
      setQ("");
      setSel(0);
      setTimeout(() => inputRef.current?.focus(), 20);
    }
  }, [open]);

  const rows = useMemo<Row[]>(() => {
    // ── Static docs: actions, navigation ────────────────────────────────────
    const nav = (href: string): (() => void) => () => { router.push(href); onClose(); };
    const staticDocs: SearchDoc[] = [
      {
        key: "a-income", group: "Actions", title: "New income entry", sub: "Opens Quick Entry",
        fields: ["new income entry", "income", "add money in", "receive"],
        run: () => { openQuickEntry("income"); onClose(); },
      },
      {
        key: "a-expense", group: "Actions", title: "New expense entry", sub: "Opens Quick Entry",
        fields: ["new expense entry", "expense", "add bill", "pay", "record payment"],
        run: () => { openQuickEntry("expense"); onClose(); },
      },
      { key: "a-dash", group: "Go to", title: "Dashboard", sub: "Overview of your books", fields: ["dashboard", "home", "overview", "books"], run: nav("/"), },
      { key: "a-txn", group: "Go to", title: "Transactions", sub: "Browse and edit entries", fields: ["transactions", "entries", "ledger", "incomes", "expenses"], run: nav("/transactions"), },
      { key: "a-fleet", group: "Go to", title: "Fleet", sub: "Vehicle expenses, registry and Salik details", fields: ["fleet", "cars", "vehicles", "salik registration"], run: nav("/fleet"), },
      { key: "a-dues", group: "Go to", title: "Dues & fines", sub: "Monitored portals, fines and pending bills", fields: ["dues", "fines", "bills", "salik balance", "traffic", "payments due"], run: nav("/dues"), },
      { key: "a-set", group: "Go to", title: "Settings", sub: "Configuration, users and data tools", fields: ["settings", "users", "targets", "categories", "payment methods", "data tools"], run: nav("/settings"), },
    ];

    const nameOfCat = (id: string | null | undefined) => db.categories.find((c) => c.id === id)?.name ?? "";
    const nameOfMethod = (id: string | null | undefined) => db.payment_methods.find((m) => m.id === id)?.name ?? "";
    const nameOfParty = (id: string | null | undefined) => db.parties.find((p) => p.id === id)?.name ?? "";
    const nameOfVehicle = (id: string | null | undefined) => db.vehicles.find((v) => v.id === id)?.label ?? "";

    // ── Transactions ────────────────────────────────────────────────────────
    const txnDocs: SearchDoc[] = db.transactions.map((t) => {
      const cat = nameOfCat(t.category_id);
      const method = nameOfMethod(t.payment_method_id);
      const party = nameOfParty(t.party_id);
      const vehicle = nameOfVehicle(t.vehicle_id);
      const title = t.description || cat || (t.kind === "income" ? "Income" : "Expense");
      return {
        key: "t-" + t.id,
        group: "Transactions",
        title,
        sub: (t.job_ref ? t.job_ref + " · " : "") + fmtDate(t.txn_date) + " · " + fmtAED(t.amount),
        fields: [title, cat, method, party, vehicle, t.job_ref ?? "", t.voucher_no ?? "", t.notes ?? "", String(t.amount), t.txn_date, fmtDate(t.txn_date)],
        digits: [t.job_ref ?? "", t.voucher_no ?? "", String(Math.round(t.amount))],
        keywords: [t.kind === "income" ? "income in" : "expense out"],
        run: () => { router.push("/transactions#txn-" + encodeURIComponent(t.id)); onClose(); },
      };
    });

    // ── Fleet: cars with every registry + Salik detail ──────────────────────
    const carDocs: SearchDoc[] = db.vehicles.map((v) => ({
      key: "v-" + v.id,
      group: "Fleet",
      title: v.label,
      sub: [v.plate, v.owner_name, v.tc_number ? "TC " + v.tc_number : null].filter(Boolean).join(" · "),
      fields: [v.label, v.plate, v.owner_name ?? "", v.tc_number ?? "", v.salik_mobile ?? "", v.salik_account ?? "", v.salik_tag ?? "", v.salik_code ?? ""],
      digits: [v.plate, v.tc_number ?? "", v.salik_mobile ?? "", v.salik_account ?? "", v.salik_tag ?? ""],
      keywords: ["car", "vehicle", "salik", "fines", "registration"],
      run: () => { router.push("/fleet#car-" + encodeURIComponent(v.id)); onClose(); },
    }));

    // ── Dues accounts (label + provider + stored field values) ──────────────
    // From the authed API when available; falls back to any locally stored copy.
    const localDues = (db as unknown as { dues_accounts?: DuesApiAccount[] }).dues_accounts ?? [];
    const duesSrc = duesAccounts.length > 0 ? duesAccounts : localDues;
    const duesDocs: SearchDoc[] = duesSrc.map((a) => ({
      key: "d-" + a.id,
      group: "Dues & fines",
      title: a.label,
      sub: duesProviderOf(a.provider_key)?.name ?? a.provider_key,
      fields: [a.label, duesProviderOf(a.provider_key)?.name ?? a.provider_key, ...Object.values(a.fields ?? {})],
      digits: Object.values(a.fields ?? {}),
      keywords: ["due", "fine", "bill", "monitor", "portal"],
      run: () => { router.push("/dues#dues-" + encodeURIComponent(a.id)); onClose(); },
    }));

    // Categories & payment methods & parties → jump to settings ref editors / transactions filtered
    const refDocs: SearchDoc[] = [
      ...db.categories.map((c) => {
        const best = db.transactions
          .filter((t) => t.category_id === c.id)
          .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))[0];
        return {
          key: "c-" + c.id,
          group: "Categories",
          title: c.name,
          sub: (c.kind === "income" ? "Income" : "Expense") + " category",
          fields: [c.name],
          keywords: ["category"],
          // Open the category's latest entry in its slide-over panel.
          run: () => {
            if (best) router.push("/transactions#txn-" + encodeURIComponent(best.id));
            else router.push("/transactions");
            onClose();
          },
        };
      }),
      ...db.payment_methods.map((m) => {
        const best = db.transactions
          .filter((t) => t.payment_method_id === m.id)
          .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))[0];
        return {
          key: "m-" + m.id,
          group: "Payment methods",
          title: m.name,
          sub: "Bank / method",
          fields: [m.name],
          keywords: ["bank", "account", "card", "method"],
          // Open the method's latest entry in its slide-over panel.
          run: () => {
            if (best) router.push("/transactions#txn-" + encodeURIComponent(best.id));
            else router.push("/transactions");
            onClose();
          },
        };
      }),
      ...db.parties.map((p) => ({
        key: "p-" + p.id,
        group: "Parties",
        title: p.name,
        sub: p.type === "both" ? "Client & supplier" : p.type === "client" ? "Client" : "Supplier",
        fields: [p.name, p.phone ?? ""],
        digits: [p.phone ?? ""],
        keywords: ["party", "client", "supplier", "customer"],
        // Open the party's most recent transaction directly in its slide-over
        // panel — a party with no entries yet just lands on the ledger.
        run: () => {
          const best = db.transactions
            .filter((t) => t.party_id === p.id || (t.notes ?? "").includes(p.name) || (t.description ?? "").includes(p.name))
            .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))[0];
          if (best) router.push("/transactions#txn-" + encodeURIComponent(best.id));
          else router.push("/transactions");
          onClose();
        },
      })),
    ];

    const allDocs = [...staticDocs, ...txnDocs, ...carDocs, ...duesDocs, ...refDocs];

    if (q.trim().length < 2) {
      // Empty query: recent transactions + top actions
      const recent: SearchDoc[] = [...db.transactions]
        .sort((a, b) => ((a.created_at < b.created_at ? 1 : -1)))
        .slice(0, 5)
        .map((t) => txnDocs.find((d) => d.key === "t-" + t.id)!)
        .filter(Boolean);
      return withHeaders([...staticDocs.filter((d) => d.key.startsWith("a-") && d.key !== "a-dash"), ...recent.map((d) => ({ ...d, group: "Recent transactions" }))]);
    }

    const ranked = rankDocs(allDocs, q, 24);
    return withHeaders(ranked.map(({ doc }) => doc));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, db, duesAccounts, openQuickEntry, onClose, router]);

  if (!open) return null;

  function withHeaders(docs: SearchDoc[]): Row[] {
    const out: Row[] = [];
    const seen = new Set<string>();
    for (const d of docs) {
      let header = d.group;
      if (seen.has(header)) header = "";
      else seen.add(header);
      out.push({
        key: d.key,
        header: header || undefined,
        chip: chipFor(d),
        title: d.title,
        sub: d.sub ?? "",
        run: d.run,
      });
    }
    return out;
  }

  function chipFor(d: SearchDoc): React.ReactNode {
    if (d.key.startsWith("a-income")) return <IconChip tone="emerald"><Plus size={13} /></IconChip>;
    if (d.key.startsWith("a-expense")) return <IconChip tone="red"><Plus size={13} /></IconChip>;
    if (d.key.startsWith("a-")) return <IconChip><Search size={13} /></IconChip>;
    if (d.key.startsWith("t-")) return <IconChip tone="zinc"><ArrowLeftRight size={13} /></IconChip>;
    if (d.key.startsWith("v-")) return <IconChip tone="red"><CarFront size={13} /></IconChip>;
    if (d.key.startsWith("d-")) return <IconChip tone="amber"><Landmark size={13} /></IconChip>;
    return <IconChip tone="blue"><Search size={13} /></IconChip>;
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSel((s) => Math.min(s + 1, rows.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSel((s) => Math.max(s - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      rows[sel]?.run();
    } else if (e.key === "Escape") {
      onClose();
    }
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center bg-zinc-900/25 p-4 pt-[12vh] backdrop-blur-[2px]" onMouseDown={onClose}>
      <div
        className="w-full max-w-xl overflow-hidden rounded-2xl border border-[#e9e9e6] bg-white shadow-[0_24px_70px_-12px_rgba(24,24,27,0.35)]"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2.5 border-b border-[#efefec] px-4">
          <Search size={15} className="shrink-0 text-zinc-400" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setSel(0);
            }}
            onKeyDown={onKeyDown}
            placeholder="Search everything — entries, cars, Salik, dues, bills…"
            className="w-full bg-transparent py-3.5 text-sm text-zinc-800 outline-none placeholder:text-zinc-300"
          />
          <kbd className="shrink-0 rounded-md border border-[#e5e5e2] bg-[#f7f7f5] px-1.5 py-0.5 text-[10px] font-medium text-zinc-400">esc</kbd>
        </div>
        <div className="max-h-[46vh] overflow-y-auto p-2">
          {rows.length === 0 ? (
            <p className="px-3 py-10 text-center text-sm text-zinc-400">Nothing matches “{q.trim()}”</p>
          ) : (
            rows.map((r, i) => (
              <div key={r.key}>
                {r.header ? <div className="px-2.5 pb-1 pt-2.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-400">{r.header}</div> : null}
                <button
                  onMouseEnter={() => setSel(i)}
                  onClick={r.run}
                  className={"flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left transition-colors " + (i === sel ? "bg-[#f4f4f2]" : "")}
                >
                  {r.chip}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium text-zinc-800">{r.title}</span>
                    <span className="block truncate text-[11px] text-zinc-400">{r.sub}</span>
                  </span>
                  {i === sel ? <CornerDownLeft size={13} className="shrink-0 text-zinc-300" /> : null}
                </button>
              </div>
            ))
          )}
        </div>
        <div className="flex items-center gap-4 border-t border-[#efefec] px-4 py-2 text-[10px] text-zinc-400">
          <span>↑↓ navigate</span>
          <span>↵ open</span>
          <span>esc close</span>
          <span className="ml-auto hidden sm:inline">Fuzzy — try “hlx”, “nsn rogue”, “506863454”</span>
        </div>
      </div>
    </div>
  );
}
