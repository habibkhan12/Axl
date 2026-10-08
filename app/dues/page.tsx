"use client";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ExternalLink, Landmark, Plus, RefreshCw } from "lucide-react";
import { PageHeader } from "@/components/app-shell";
import { Button, Card, ConfirmDelete, EmptyState, Input, Label, MicroLabel, Pill, Select, SlideOver, StatCard, Toast } from "@/components/ui";
import { useDbContext } from "@/lib/local-db";
import { DUES_PROVIDERS, duesProviderOf } from "@/lib/dues-providers";
import { appendNotif } from "@/lib/notifications";
import { fmtAED, fmtNum } from "@/lib/format";
import type { DuesAccount, DuesCheck, DuesCheckStatus } from "@/lib/types";

interface ApiShape {
  accounts: DuesAccount[];
  checks: Pick<DuesCheck, "id" | "account_id" | "checked_at" | "status" | "amount_due" | "message">[];
  canEdit: boolean;
}

interface Row {
  account: DuesAccount;
  latest: ApiShape["checks"][number] | null;
  previous: ApiShape["checks"][number] | null;
  history: ApiShape["checks"];
}

async function authedFetch(path: string, init?: RequestInit): Promise<{ ok: boolean; data: ApiShape & Record<string, unknown> }> {
  const { getSupabase } = await import("@/lib/supabase");
  const token = (await getSupabase().auth.getSession()).data.session?.access_token ?? "";
  const res = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + token, ...(init?.headers ?? {}) },
  });
  const data = (await res.json().catch(() => ({}))) as ApiShape & Record<string, unknown>;
  return { ok: res.ok, data };
}

function relTime(iso: string): string {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return mins + "m ago";
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return hrs + "h ago";
  return Math.round(hrs / 24) + "d ago";
}

function StatusBadge({ status }: { status: DuesCheckStatus | "never" }) {
  if (status === "never") return <Pill tone="zinc">Never checked</Pill>;
  if (status === "ok") return <Pill tone="emerald">Live</Pill>;
  if (status === "manual") return <Pill tone="amber">Manual check</Pill>;
  return <Pill tone="red">Error</Pill>;
}

/** Amount change between the last two checks, or null when not comparable. */
function changedOf(r: Row): number | null {
  if (!r.latest || !r.previous) return null;
  if (r.latest.amount_due == null || r.previous.amount_due == null) return null;
  if (r.latest.amount_due === r.previous.amount_due) return null;
  return r.latest.amount_due - r.previous.amount_due;
}

/** Two-letter monogram for the provider chip (e.g. "Dubai Police — Traffic Fines" → "DP"). */
function monogram(name: string): string {
  const head = (name.split("—")[0] ?? name).replace(/\(.*?\)/g, "").trim() || name;
  const words = head.split(/\s+/).filter(Boolean);
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

export default function DuesPage() {
  const { canEdit, profile, role } = useDbContext();
  const editable = canEdit("/dues");

  const [data, setData] = useState<ApiShape | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [checking, setChecking] = useState<string | null>(null); // accountId | "all"
  const [modal, setModal] = useState<{ mode: "create" } | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<DuesAccount | null>(null);
  const [providerFilter, setProviderFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const load = useCallback(async () => {
    setLoading(true);
    const { ok, data: d } = await authedFetch("/api/dues/accounts");
    if (ok) {
      setData(d);
      setError(null);
    } else {
      setError(String((d as { error?: string }).error ?? "Could not load monitored accounts."));
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Deep link from the command palette: /dues#dues-<id> opens that account's
  // slide-over panel (same pattern as transactions and fleet).
  // hashchange-aware so Enter works when you're already on this page.
  useEffect(() => {
    const handle = () => {
      const hash = window.location.hash;
      if (!hash.startsWith("#dues-")) return;
      const id = decodeURIComponent(hash.slice(6));
      if (data?.accounts.some((x) => x.id === id)) {
        setSelectedId(id);
        // Clear the hash only once the panel is actually open — if data hasn't
        // loaded yet, leave it so the next effect run (after load) opens it.
        history.replaceState(null, "", window.location.pathname + window.location.search);
      }
    };
    handle();
    window.addEventListener("hashchange", handle);
    return () => window.removeEventListener("hashchange", handle);
  }, [data]);

  const rows: Row[] = useMemo(() => {
    if (!data) return [];
    const byAccount = new Map<string, ApiShape["checks"]>();
    for (const c of data.checks) {
      const list = byAccount.get(c.account_id) ?? [];
      list.push(c);
      byAccount.set(c.account_id, list);
    }
    return data.accounts
      .slice()
      .sort((a, b) => a.provider_key.localeCompare(b.provider_key) || a.label.localeCompare(b.label))
      .map((account) => {
        const history = (byAccount.get(account.id) ?? []).sort(
          (a, b) => new Date(b.checked_at).getTime() - new Date(a.checked_at).getTime()
        );
        return { account, latest: history[0] ?? null, previous: history[1] ?? null, history };          });
  }, [data]);

  async function check(accountId?: string) {
    setChecking(accountId ?? "all");
    const prev = new Map(rows.map((r) => [r.account.id, r.latest] as const));
    const { ok, data: d } = await authedFetch("/api/dues/check", {
      method: "POST",
      body: JSON.stringify({ accountId }),
    });
    if (!ok) {
      setToast(String((d as { error?: string }).error ?? "Check failed."));
    } else {
      const results = (d as { results?: { accountId: string; outcome: { status: string; amount_due?: number | null } }[] }).results ?? [];
      // Surface NEW / CHANGED dues into the notification feed.
      const who = profile?.name ?? "Scheduler";
      for (const r of results) {
        const before = prev.get(r.accountId);
        const amount = r.outcome.amount_due ?? null;
        if (r.outcome.status === "ok" && amount != null) {
          const beforeAmt = before?.amount_due ?? null;
          if (beforeAmt == null || beforeAmt === 0) appendNotif("dues", "New due detected — " + fmtAED(amount), who);
          else if (beforeAmt !== amount) appendNotif("dues", "Due changed — " + fmtAED(beforeAmt) + " → " + fmtAED(amount), who);
        }
      }
      setToast("Check complete — " + results.length + " account(s).");
    }
    await load();
    setChecking(null);
  }

  async function removeAccount(id: string) {
    const { ok, data: d } = await authedFetch("/api/dues/accounts?id=" + encodeURIComponent(id), { method: "DELETE" });
    setToast(ok ? "Account removed." : String((d as { error?: string }).error ?? "Delete failed."));
    setDeleting(null);
    await load();
  }

  // ── Summary stats over the latest checks ─────────────────────────────────
  const summary = useMemo(() => {
    let totalDue = 0;
    let dueCount = 0;
    let clearCount = 0;
    let settledCount = 0;
    let settledAmt = 0;
    let manualCount = 0;
    let errorCount = 0;
    let neverCount = 0;
    for (const r of rows) {
      const amt = r.latest?.amount_due ?? null;
      const status = r.latest?.status;
      if (!r.latest) neverCount++;
      else if (status === "error") errorCount++;
      else if (status === "manual") manualCount++;
      else if (status === "ok") {
        if (amt != null && amt > 0) {
          dueCount++;
          totalDue += amt;
        } else {
          clearCount++;
          const prevAmt = r.previous?.amount_due ?? null;
          if (prevAmt != null && prevAmt > 0) {
            settledCount++;
            settledAmt += prevAmt;
          }
        }
      }
    }
    return { totalDue, dueCount, clearCount, settledCount, settledAmt, manualCount, errorCount, neverCount };
  }, [rows]);

  // Net movement in the outstanding total vs the previous round of checks —
  // only accounts that have both a current and a previous successful check count.
  const netDelta = useMemo(() => {
    let now = 0;
    let before = 0;
    let pairs = 0;
    for (const r of rows) {
      if (r.latest?.status === "ok" && r.previous?.status === "ok" && r.latest.amount_due != null && r.previous.amount_due != null) {
        now += r.latest.amount_due;
        before += r.previous.amount_due;
        pairs++;
      }
    }
    return pairs > 0 ? now - before : null;
  }, [rows]);

  const lastCheckAt = useMemo(() => {
    let at: string | null = null;
    for (const r of rows) if (r.latest && (!at || r.latest.checked_at > at)) at = r.latest.checked_at;
    return at;
  }, [rows]);

  // Filters: by provider type and by latest-check status.
  const providerCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) m.set(r.account.provider_key, (m.get(r.account.provider_key) ?? 0) + 1);
    return m;
  }, [rows]);

  const statusOf = (r: Row): string => (r.latest ? r.latest.status : "never");
  const statusCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) m.set(statusOf(r), (m.get(statusOf(r)) ?? 0) + 1);
    return m;
  }, [rows]);

  const visibleRows = useMemo(() => {
    let out = rows;
    if (providerFilter !== "all") out = out.filter((r) => r.account.provider_key === providerFilter);
    if (statusFilter !== "all") out = out.filter((r) => statusOf(r) === statusFilter);
    return out;
  }, [rows, providerFilter, statusFilter]);

  const canSee = role === "owner" || role === "editor" || (data?.accounts.length ?? 0) > 0;

  const pendingCount = summary.manualCount + summary.errorCount + summary.neverCount;

  return (
    <div>
      <PageHeader
        title="Dues & fines"
        subtitle="Monitored government portals — new fines and pending dues surface here with a direct payment link."
        actions={
          <>
            {editable ? (
              <>
                <Button onClick={() => void check()} disabled={checking != null || rows.length === 0}>
                  <RefreshCw size={14} className={checking === "all" ? "animate-spin" : ""} /> {checking === "all" ? "Checking…" : "Check all"}
                </Button>
                <Button variant="primary" onClick={() => setModal({ mode: "create" })}>
                  <Plus size={14} /> Add account
                </Button>
              </>
            ) : null}
          </>
        }
      />

      {/* Summary band — same StatCard components as Fleet & Dashboard */}
      {rows.length > 0 ? (
        <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            title="Total outstanding"
            icon={<Landmark size={15} />}
            value={fmtNum(summary.totalDue)}
            sub={
              summary.totalDue > 0
                ? summary.dueCount + " account" + (summary.dueCount === 1 ? "" : "s") + " with dues" + (lastCheckAt ? " · " + relTime(lastCheckAt) : "")
                : "All clear — nothing outstanding" + (lastCheckAt ? " · " + relTime(lastCheckAt) : "")
            }
            tone={summary.totalDue > 0 ? "bad" : "ok"}
          />
          <StatCard
            title="With dues"
            value={String(summary.dueCount)}
            sub={netDelta != null && netDelta !== 0 ? (netDelta > 0 ? "↑ " : "↓ ") + fmtNum(Math.abs(netDelta)) + " since last check" : "Need payment"}
            tone={summary.dueCount > 0 ? "warn" : "plain"}
          />
          <StatCard
            title="Pending check"
            value={pendingCount === 0 ? "All checked" : String(pendingCount)}
            sub="Manual · errors · never"
            tone={pendingCount === 0 ? "ok" : "plain"}
          />
          <StatCard
            title="Clear & settled"
            value={summary.clearCount + summary.settledCount > 0 ? String(summary.clearCount + summary.settledCount) : "—"}
            sub={summary.settledCount > 0 ? fmtNum(summary.settledAmt) + " cleared since last check" : "Nothing owed"}
            tone="ok"
          />
        </div>
      ) : null}

      {/* Filters: provider type + status */}
      {rows.length > 0 ? (
        <div className="mb-4 flex flex-wrap items-center gap-1.5">
          <FilterPill
            active={providerFilter === "all"}
            label={"All (" + rows.length + ")"}
            onClick={() => setProviderFilter("all")}
          />
          {DUES_PROVIDERS.filter((p) => providerCounts.get(p.key)).map((p) => (
            <FilterPill
              key={p.key}
              active={providerFilter === p.key}
              label={(p.key === "dubai_police" ? "Fines" : p.key === "salik" ? "Salik" : p.key === "du" ? "du" : p.key === "eand" ? "e&" : p.key === "etihad_we" ? "EtihadWE" : p.key === "ajman_sewerage" ? "Sewerage" : p.name) + " (" + providerCounts.get(p.key) + ")"}
              onClick={() => setProviderFilter(providerFilter === p.key ? "all" : p.key)}
            />
          ))}
          <span className="mx-1 h-5 w-px bg-[#e5e5e2]" />
          <FilterPill active={statusFilter === "all"} label="Any status" onClick={() => setStatusFilter("all")} />
          <FilterPill active={statusFilter === "ok"} label={"Live (" + (statusCounts.get("ok") ?? 0) + ")"} onClick={() => setStatusFilter(statusFilter === "ok" ? "all" : "ok")} />
          <FilterPill active={statusFilter === "manual"} label={"Manual (" + (statusCounts.get("manual") ?? 0) + ")"} onClick={() => setStatusFilter(statusFilter === "manual" ? "all" : "manual")} />
          <FilterPill active={statusFilter === "error"} label={"Errors (" + (statusCounts.get("error") ?? 0) + ")"} onClick={() => setStatusFilter(statusFilter === "error" ? "all" : "error")} />
          <FilterPill active={statusFilter === "never"} label={"Never (" + (statusCounts.get("never") ?? 0) + ")"} onClick={() => setStatusFilter(statusFilter === "never" ? "all" : "never")} />
          <span className="ml-auto pl-2 text-[11px] font-medium text-zinc-400">
            Showing {visibleRows.length} of {rows.length}
          </span>
        </div>
      ) : null}

      {error ? (
        <Card className="mb-4 border-red-200 bg-red-50/60 p-4 text-sm text-red-700">{error}</Card>
      ) : null}

      {loading ? (
        <div className="py-16 text-center text-sm text-zinc-400">Loading monitored accounts…</div>
      ) : !canSee ? (
        <EmptyState icon={<Landmark size={20} />} title="No dues access" hint="You do not have any monitored accounts to view." />
      ) : rows.length === 0 ? (
        <Card className="p-8">
          <EmptyState
            icon={<Landmark size={20} />}
            title="No monitored accounts yet"
            hint={editable ? "Add a Salik, Dubai Police, du, e&, EtihadWE or Ajman Sewerage account to start tracking fines and pending dues." : "Ask an admin to add monitored accounts."}
          />
          {editable ? (
            <div className="mt-4 flex justify-center">
              <Button variant="primary" onClick={() => setModal({ mode: "create" })}>
                <Plus size={14} /> Add your first account
              </Button>
            </div>
          ) : null}
        </Card>
      ) : (
        <Card className="overflow-hidden">
          {/* Card header strip */}
          <div className="flex items-center justify-between gap-2 border-b border-[#eae4d9] bg-[#faf8f4] px-4 py-2.5">
            <MicroLabel>Monitored accounts</MicroLabel>
            <span className="text-[11px] font-medium text-zinc-400">
              {visibleRows.length} of {rows.length}
            </span>
          </div>

          {visibleRows.length === 0 ? (
            <div className="p-6">
              <EmptyState icon={<Landmark size={20} />} title="No accounts match the filters" hint="Try a different provider or status." />
              <div className="mt-3 flex justify-center">
                <Button
                  onClick={() => {
                    setProviderFilter("all");
                    setStatusFilter("all");
                  }}
                >
                  Clear filters
                </Button>
              </div>
            </div>
          ) : (
            <>
              {/* Column captions (md+) — same strip geometry as Fleet */}
              <div className="hidden border-b border-[#eae4d9] px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-300 md:grid md:grid-cols-[minmax(0,2.4fr)_190px_minmax(0,1fr)_130px_20px] md:items-center md:gap-3">
                <span>Account</span>
                <span>Status</span>
                <span>Balance</span>
                <span className="text-right">Last check</span>
                <span />
              </div>

              <div>
                {visibleRows.map((row) => {
                  const provider = duesProviderOf(row.account.provider_key);
                  const amount = row.latest?.amount_due ?? null;
                  const changed = changedOf(row);
                  const status = (row.latest?.status ?? "never") as DuesCheckStatus | "never";
                  return (
                    <button
                      key={row.account.id}
                      id={"dues-card-" + row.account.id}
                      onClick={() => setSelectedId(row.account.id)}
                      className="group grid w-full grid-cols-1 items-center gap-2 border-b border-[#f0ece4] px-4 py-3 text-left transition-colors last:border-b-0 hover:bg-[#faf8f4] md:grid-cols-[minmax(0,2.4fr)_190px_minmax(0,1fr)_130px_20px] md:gap-3"
                    >
                      {/* Account */}
                      <span className="flex min-w-0 items-center gap-3">
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[#eae4d9] bg-[#f4efe8] text-[11px] font-bold text-zinc-500">
                          {monogram(provider?.name ?? row.account.provider_key)}
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-semibold text-zinc-900">{row.account.label}</span>
                          <span className="block truncate text-[11px] text-zinc-400">{provider?.name ?? row.account.provider_key}</span>
                        </span>
                      </span>

                      {/* Status */}
                      <span title={row.latest?.message ?? undefined}>
                        <span className="flex flex-wrap items-center gap-1.5">
                          <StatusBadge status={status} />
                          {!row.account.active ? <Pill tone="zinc">Paused</Pill> : null}
                        </span>
                        {status === "error" && row.latest?.message ? (
                          <span className="mt-1 line-clamp-2 block text-[11px] leading-snug text-red-500">{row.latest.message}</span>
                        ) : null}
                      </span>

                      {/* Balance */}
                      <span className="flex items-baseline gap-2">
                        {amount != null ? (
                          amount > 0 ? (
                            <span className="text-[15px] font-semibold tabular-nums tracking-tight text-red-600">{fmtNum(amount)}</span>
                          ) : (
                            <span className="text-[15px] font-semibold text-emerald-600">Clear</span>
                          )
                        ) : (
                          <span className="text-[13px] text-zinc-300">—</span>
                        )}
                        {changed != null ? (
                          <Pill tone={changed > 0 ? "red" : "emerald"}>
                            {changed > 0 ? "↑" : "↓"} {fmtNum(Math.abs(changed))}
                          </Pill>
                        ) : null}
                      </span>

                      {/* Last check */}
                      <span className="text-right text-[11px] text-zinc-400">{row.latest ? relTime(row.latest.checked_at) : "Not checked yet"}</span>

                      {/* Chevron */}
                      <svg className="hidden h-4 w-4 text-zinc-300 transition-colors group-hover:text-zinc-500 md:block" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m9 18 6-6-6-6" /></svg>
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </Card>
      )}

      {/* Create-account slide-over (same panel pattern as editing) */}
      {modal ? <AccountPanel mode="create" account={null} onClose={() => setModal(null)} onSaved={() => { setModal(null); void load(); }} setToast={setToast} /> : null}

      {/* Account slide-over panel — inline edit + Save changes */}
      {selectedId ? (
        <AccountPanel
          mode="edit"
          account={rows.find((r) => r.account.id === selectedId)?.account ?? null}
          latest={rows.find((r) => r.account.id === selectedId)?.latest ?? null}
          onClose={() => setSelectedId(null)}
          onSaved={() => void load()}
          setToast={setToast}
          onDelete={(a) => setDeleting(a)}
          editable={editable}
          checking={checking}
          onCheck={(id) => void check(id)}
        />
      ) : null}

      <ConfirmDelete
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={() => deleting && void removeAccount(deleting.id)}
        label={'monitored account "' + (deleting?.label ?? "") + '"'}
      />

      <Toast message={toast} />
    </div>
  );
}

function FilterPill({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={
        "rounded-full border px-3 py-1.5 text-[12px] font-medium transition-colors " +
        (active
          ? "border-zinc-900 bg-zinc-900 text-white"
          : "border-[#e5e5e2] bg-white text-zinc-600 hover:border-zinc-300 hover:text-zinc-900")
      }
    >
      {label}
    </button>
  );
}

// ─────────────────────────── Account slide-over panel ─────────────────────

function AccountPanel({
  mode,
  account,
  latest,
  onClose,
  onSaved,
  setToast,
  onDelete,
  editable = false,
  checking = null,
  onCheck,
}: {
  mode: "create" | "edit";
  account: DuesAccount | null;
  latest?: ApiShape["checks"][number] | null;
  onClose: () => void;
  onSaved: () => void;
  setToast: (m: string) => void;
  onDelete?: (a: DuesAccount) => void;
  editable?: boolean;
  checking?: string | "all" | null;
  onCheck?: (id: string) => void;
}) {
  const [providerKey, setProviderKey] = useState(account?.provider_key ?? DUES_PROVIDERS[0].key);
  const [label, setLabel] = useState(account?.label ?? "");
  const [fields, setFields] = useState<Record<string, string>>(account?.fields ?? {});
  const [active, setActive] = useState(account?.active ?? true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const provider = duesProviderOf(providerKey)!;
  const setField = (k: string, v: string) => setFields((f) => ({ ...f, [k]: v }));

  useEffect(() => {
    setProviderKey(account?.provider_key ?? DUES_PROVIDERS[0].key);
    setLabel(account?.label ?? "");
    setFields(account?.fields ?? {});
    setActive(account?.active ?? true);
    setErr(null);
  }, [account]);

  function switchProvider(key: string) {
    setProviderKey(key);
    setFields({});
  }

  async function save() {
    setSaving(true);
    setErr(null);
    const body = mode === "create" ? { provider_key: providerKey, label, fields, active } : { id: account!.id, label, fields, active };
    const { ok, data } = await authedFetch("/api/dues/accounts", {
      method: mode === "create" ? "POST" : "PATCH",
      body: JSON.stringify(body),
    });
    setSaving(false);
    if (!ok) {
      setErr(String((data as { error?: string }).error ?? "Save failed."));
      return;
    }
    setToast(mode === "create" ? "Monitored account added." : "Account updated.");
    if (mode === "edit") onSaved();
    onClose();
  }

  return (
    <SlideOver
      open
      onClose={onClose}
      title={mode === "create" ? "Add monitored account" : "Edit monitored account"}
      subtitle={mode === "edit" && account ? (latest?.checked_at ? "Last checked " + relTime(latest.checked_at) : "Not checked yet") : undefined}
      footer={
        <>
          {mode === "edit" && editable && onDelete && account ? (
            <Button variant="danger" className="mr-auto" onClick={() => onDelete(account)}>
              Remove
            </Button>
          ) : null}
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={() => void save()} disabled={saving || !label.trim()}>
            {saving ? "Saving…" : mode === "create" ? "Add account" : "Save changes"}
          </Button>
        </>
      }
    >
      <div className="space-y-4 p-5">
        {mode === "edit" && account ? (
          <div className="rounded-xl border border-[#e9e9e6] bg-[#fbfbfa] p-3.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">Latest check</span>
              <StatusBadge status={(latest?.status ?? "never") as DuesCheckStatus | "never"} />
            </div>
            <div className="mt-2 flex items-baseline gap-2">
              {latest?.amount_due != null ? (
                latest.amount_due > 0 ? (
                  <span className="text-[20px] font-bold tabular-nums tracking-tight text-red-600">{fmtNum(latest.amount_due)}</span>
                ) : (
                  <span className="text-[20px] font-bold text-emerald-600">Clear</span>
                )
              ) : (
                <span className="text-[16px] text-zinc-300">—</span>
              )}
              {latest?.checked_at ? <span className="text-[11px] text-zinc-400">· {relTime(latest.checked_at)}</span> : null}
            </div>
            {latest?.message ? <div className="mt-2 text-[11px] leading-snug text-zinc-500">{latest.message}</div> : null}
            <div className="mt-3 flex flex-wrap gap-2">
              {provider?.paymentUrl ? (
                <a
                  href={provider.paymentUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-zinc-900 px-3 text-[12px] font-medium text-white transition-colors hover:bg-zinc-700"
                >
                  Pay here <ExternalLink size={11} />
                </a>
              ) : null}
              {editable && provider?.checkable && onCheck ? (
                <Button onClick={() => onCheck(account.id)} disabled={checking != null}>
                  <RefreshCw size={13} className={checking === account.id ? "animate-spin" : ""} /> Check now
                </Button>
              ) : null}
            </div>
          </div>
        ) : null}

        <div>
          <Label>Portal</Label>
          {mode === "create" ? (
            <Select value={providerKey} onChange={(e) => switchProvider(e.target.value)}>
              {DUES_PROVIDERS.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.name}
                </option>
              ))}
            </Select>
          ) : (
            <div className="rounded-xl border border-[#e9e9e6] bg-[#f7f7f5] px-3 py-2 text-sm text-zinc-700">{provider.name}</div>
          )}
          <p className="mt-1.5 text-[11px] leading-snug text-zinc-400">{provider.blurb}</p>
        </div>

        <div>
          <Label>Name this account</Label>
          <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder='e.g. "Hilux — Dubai plate" or "Office du line"' />
        </div>

        <div>
          <Label>Portal details the checker uses</Label>
          {provider.fields.length === 0 ? (
            <p className="rounded-xl border border-dashed border-[#e5e5e2] px-3 py-3 text-[12px] text-zinc-400">
              No details needed — this portal is link-only. Your team opens it and pays manually.
            </p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {provider.fields.map((spec) => (
                <div key={spec.key} className={spec.type === "select" ? "" : "sm:col-span-1"}>
                  <Label>
                    {spec.label}
                    {spec.required ? " *" : ""}
                  </Label>
                  {spec.type === "select" ? (
                    <Select value={fields[spec.key] ?? ""} onChange={(e) => setField(spec.key, e.target.value)}>
                      <option value="">—</option>
                      {(spec.options ?? []).map((o) => (
                        <option key={o} value={o}>
                          {o}
                        </option>
                      ))}
                    </Select>
                  ) : (
                    <Input
                      type={spec.type === "email" ? "email" : spec.type === "tel" ? "tel" : "text"}
                      value={fields[spec.key] ?? ""}
                      onChange={(e) => setField(spec.key, e.target.value)}
                      placeholder={spec.placeholder}
                      inputMode={spec.type === "tel" || spec.key.includes("number") || spec.key.includes("account") ? "numeric" : undefined}
                    />
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <label className="flex cursor-pointer items-center gap-2 text-sm text-zinc-600">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className="h-4 w-4 rounded border-[#d4d4d0] accent-zinc-900" />
          Active — include in scheduled checks
        </label>

        {err ? <p className="rounded-lg bg-red-50 px-3 py-2 text-[12px] text-red-700">{err}</p> : null}
      </div>
    </SlideOver>
  );
}
