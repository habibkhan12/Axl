"use client";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  Activity,
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  CalendarDays,
  Check,
  ChevronDown,
  Filter,
  Hash,
  Landmark,
  Receipt,
  Scale,
  SquarePen,
  Target,
  Trash2,
  TrendingUp,
} from "lucide-react";
import { useDb, useDbContext } from "@/lib/local-db";
import {
  activityRows,
  dailySeries,
  monthBounds,
  previousMonth,
  previousPeriod,
  pctDelta,
  projectedMonthEndIncome,
  rowsInRange,
  totalsOf,
  type ActivityWindow,
  type DayPoint,
} from "@/lib/analytics";
import { fmtAED, fmtDate, fmtDateShort, fmtTime, todayISO, daysInMonth } from "@/lib/format";
import { deleteTransaction } from "@/lib/repo";
import {
  Avatar,
  Button,
  Card,
  CardHeader,
  ConfirmDelete,
  DeltaPill,
  Dropdown,
  EmptyState,
  IconChip,
  KebabMenu,
  MenuItem,
  MicroLabel,
  Pill,
  SearchInput,
  Segmented,
  SortGlyph,
} from "@/components/ui";
import { Sparkline, TrendBars, type TrendMetric } from "@/components/charts";
import { PageHeader } from "@/components/app-shell";
import { DatePicker } from "@/components/date-picker";
import type { Transaction } from "@/lib/types";

type Preset = "thisMonth" | "lastMonth" | "last3" | "custom";

const PRESET_OPTIONS: [Preset, string][] = [
  ["thisMonth", "This month"],
  ["lastMonth", "Last month"],
  ["last3", "Last 3 months"],
];

const VS_LABELS: Record<Preset, string> = {
  thisMonth: "vs last month",
  lastMonth: "vs prior month",
  last3: "vs prior 3 months",
  custom: "vs previous period",
};

type SortKey = "date" | "amount" | "description";
type KindFilter = "all" | "income" | "expense";

export default function DashboardPage() {
  const { db, setDb } = useDb();
  const { profile, canWrite, canEdit, canView } = useDbContext();
  // Dashboard edit actions create/edit transactions — needs transactions edit access.
  const canEditTxn = canWrite && canEdit("/transactions");
  const router = useRouter();

  // ── Range selector ──
  const [preset, setPreset] = useState<Preset>("thisMonth");
  const [customFrom, setCustomFrom] = useState(todayISO().slice(0, 8) + "01");
  const [customTo, setCustomTo] = useState(todayISO());

  // ── Chart metric ──
  const [metric, setMetric] = useState<TrendMetric>("profit");
  const [showProj, setShowProj] = useState(true);

  // ── Rail ──
  const [win, setWin] = useState<ActivityWindow>("today");
  const [aq, setAq] = useState("");

  // ── Table ──
  const [tq, setTq] = useState("");
  const [kindFilter, setKindFilter] = useState<KindFilter>("all");
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({ key: "date", dir: "desc" });
  const [deleting, setDeleting] = useState<Transaction | null>(null);

  // ── Dues (same session-authed API the Dues page uses) ──
  const duesVisible = canView("/dues");
  const [duesData, setDuesData] = useState<{ accounts: { id: string; label: string; provider_key: string }[]; checks: { account_id: string; checked_at: string; status: string; amount_due: number | null; message: string | null }[] } | null>(null);
  useEffect(() => {
    if (!duesVisible) return;
    let cancelled = false;
    (async () => {
      try {
        const { getSupabase } = await import("@/lib/supabase");
        const token = (await getSupabase().auth.getSession()).data.session?.access_token ?? "";
        const res = await fetch("/api/dues/accounts", { headers: { Authorization: "Bearer " + token } });
        if (!res.ok) return;
        const json = await res.json();
        if (!cancelled) setDuesData({ accounts: json.accounts ?? [], checks: json.checks ?? [] });
      } catch {
        /* dues block is best-effort */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [duesVisible]);

  const duesSummary = useMemo(() => {
    if (!duesData) return null;
    const latestBy = new Map<string, { status: string; amount_due: number | null }>();
    for (const c of duesData.checks) if (!latestBy.has(c.account_id)) latestBy.set(c.account_id, c);
    const items = duesData.accounts
      .map((a) => ({ account: a, latest: latestBy.get(a.id) ?? null }))
      .sort((x, y) => (y.latest?.amount_due ?? 0) - (x.latest?.amount_due ?? 0));
    const totalDue = items.reduce((s, i) => s + (i.latest?.status === "ok" && i.latest.amount_due ? i.latest.amount_due : 0), 0);
    const dueCount = items.filter((i) => i.latest?.status === "ok" && (i.latest.amount_due ?? 0) > 0).length;
    const clearCount = items.filter((i) => i.latest?.status === "ok" && (i.latest.amount_due ?? 0) === 0).length;
    const pendingCount = items.filter((i) => !i.latest || i.latest.status !== "ok").length;
    return { items, totalDue, dueCount, clearCount, pendingCount };
  }, [duesData]);

  // ── Selected range + rows ──
  const nowYm = todayISO().slice(0, 7);
  const { from, to } = useMemo(() => {
    if (preset === "thisMonth") return monthBounds(nowYm);
    if (preset === "lastMonth") return monthBounds(previousMonth(nowYm));
    if (preset === "last3") {
      const ym = previousMonth(nowYm);
      const startYm = previousMonth(previousMonth(nowYm));
      return { from: monthBounds(startYm).from, to: monthBounds(ym).to };
    }
    return { from: customFrom, to: customTo };
  }, [preset, nowYm, customFrom, customTo]);

  const rows = useMemo(() => rowsInRange(db, from, to), [db, from, to]);
  const totals = totalsOf(rows);

  const today = todayISO();

  // The chart only covers the part of the range that has actually happened:
  // e.g. "This month" stops at today rather than running to the 31st.
  const chartTo = useMemo(() => (to > today ? today : to), [to, today]);
  const series = useMemo(() => dailySeries(rows, from, chartTo), [rows, from, chartTo]);
  // Full length of the selected range (e.g. 31 days for "This month") — the
  // target-pace line is computed against the whole period, not elapsed days.
  const periodDays = useMemo(() => {
    const DAY = 86400000;
    const s = Date.parse(from + "T00:00:00");
    const e = Date.parse(to + "T00:00:00");
    return Math.max(1, Math.round((e - s) / DAY) + 1);
  }, [from, to]);

  const prev = useMemo(() => {
    // "This month" is month-to-date — compare against the same day-span of last
    // calendar month so the delta is meaningful (not MTD vs a full month).
    if (preset === "thisMonth") {
      const lastYm = previousMonth(nowYm);
      const lb = monthBounds(lastYm);
      const dayIdx = Math.max(1, Number(today.slice(8, 10)));
      const dayOfTo = Math.min(dayIdx, daysInMonth(lastYm));
      return { from: lb.from, to: lb.from.slice(0, 8) + String(dayOfTo).padStart(2, "0") };
    }
    return previousPeriod(from, to);
  }, [preset, nowYm, from, to, today]);
  const prevRows = useMemo(() => rowsInRange(db, prev.from, prev.to), [db, prev]);
  const prevTotals = useMemo(() => totalsOf(prevRows), [prevRows]);
  const prevSeries = useMemo(() => dailySeries(prevRows, prev.from, prev.to), [prevRows, prev]);

  const sumOf = (pts: DayPoint[], m: TrendMetric) =>
    pts.reduce((s, d) => s + (m === "profit" ? d.income - d.expense : m === "income" ? d.income : d.expense), 0);
  const trendTotal = sumOf(series, metric);
  const trendDelta = pctDelta(trendTotal, sumOf(prevSeries, metric));
  const marginPct = totals.income > 0 ? Math.round((totals.net / totals.income) * 100) : null;

  // End-of-range projection at current pace: avg/day so far × full period days.
  // Only meaningful when the selected range still has future days left.
  const projEnd = useMemo(() => {
    if (!(to > today) || series.length === 0 || periodDays <= series.length) return null;
    return (trendTotal / series.length) * periodDays;
  }, [to, today, series, trendTotal, periodDays]);

  // Sparklines show the shape of the selected period up to today (no flat zero tail).
  const sparkOf = (m: TrendMetric) => series.filter((d) => d.date <= today).map((d) => (m === "profit" ? d.income - d.expense : m === "income" ? d.income : d.expense));

  const proj = projectedMonthEndIncome(db.transactions, nowYm, db.settings.monthly_income_target);
  const targetPct = proj.target > 0 ? Math.min(1, proj.soFar / proj.target) : 0;

  // ── Rail feed ──
  const todayCount = useMemo(() => activityRows(db, "today").length, [db]);
  const activity = useMemo(() => {
    const needle = aq.trim().toLowerCase();
    const cat = (id: string | null | undefined) => db.categories.find((c) => c.id === id)?.name ?? "";
    const method = (id: string | null | undefined) => db.payment_methods.find((m) => m.id === id)?.name ?? "";
    const list = activityRows(db, win);
    if (!needle) return list.slice(0, 20);
    return list
      .filter((t) =>
        [t.description, t.notes, t.job_ref, cat(t.category_id), method(t.payment_method_id), String(t.amount)]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(needle)
      )
      .slice(0, 20);
  }, [db, win, aq]);

  // ── Table rows ──
  const nameOf = {
    category: (id: string | null | undefined) => db.categories.find((c) => c.id === id)?.name ?? "",
    method: (id: string | null | undefined) => db.payment_methods.find((m) => m.id === id)?.name ?? "",
    user: (id: string) => db.users.find((u) => u.id === id)?.name ?? "—",
  };

  const filtered = useMemo(() => {
    const needle = tq.trim().toLowerCase();
    let list = rows;
    if (kindFilter !== "all") list = list.filter((t) => t.kind === kindFilter);
    if (needle) {
      list = list.filter((t) =>
        [t.job_ref, t.description, t.notes, nameOf.category(t.category_id), nameOf.method(t.payment_method_id), String(t.amount)]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(needle)
      );
    }
    const dir = sort.dir === "asc" ? 1 : -1;
    return [...list].sort((a, b) => {
      if (sort.key === "date") return a.txn_date < b.txn_date ? -dir : a.txn_date > b.txn_date ? dir : 0;
      if (sort.key === "amount") return (a.amount - b.amount) * dir;
      const an = (a.description || "").toLowerCase();
      const bn = (b.description || "").toLowerCase();
      return an < bn ? -dir : an > bn ? dir : 0;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, tq, kindFilter, sort, db]);

  const toggleSort = (key: SortKey) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: key === "description" ? "asc" : "desc" }));

  const tableRows = filtered.slice(0, 10);
  const showDues = duesVisible && duesSummary !== null && duesSummary.items.length > 0;

  const hour = new Date().getHours();
  const daypart = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const firstName = (profile?.name || "there").split(" ")[0];
  const rangeLabel = preset === "custom" ? fmtDateShort(from) + " – " + fmtDateShort(to) : PRESET_OPTIONS.find(([v]) => v === preset)?.[1] ?? "";

  return (
    <div>
      <PageHeader
        title={daypart + ", " + firstName + " 👋"}
        subtitle={fmtDate(todayISO()) + " — here's the latest from your books."}
        actions={
          <Dropdown
            align="right"
            widthClass="w-64"
            trigger={(open) => (
              <span className="inline-flex items-center gap-2 rounded-lg border border-[#e5e5e2] bg-white px-3 py-2 text-sm font-medium text-zinc-700 shadow-[0_1px_2px_rgba(24,24,27,0.05)] transition-colors hover:border-zinc-300">
                <CalendarDays size={14} className="text-zinc-400" />
                {rangeLabel}
                <ChevronDown size={14} className={"text-zinc-400 transition-transform " + (open ? "rotate-180" : "")} />
              </span>
            )}
          >
            {(close) => (
              <div>
                {PRESET_OPTIONS.map(([value, label]) => (
                  <MenuItem
                    key={value}
                    onClick={() => {
                      setPreset(value);
                      close();
                    }}
                  >
                    <span className="flex w-full items-center justify-between">
                      {label}
                      {preset === value ? <Check size={13} className="text-zinc-900" /> : null}
                    </span>
                  </MenuItem>
                ))}
                <div className="my-1 border-t border-[#efefec]" />
                <div className="px-2.5 pb-2 pt-1">
                  <MicroLabel className="mb-1.5">Custom range</MicroLabel>
                  <div className="space-y-1.5">
                    <DatePicker value={customFrom} onChange={setCustomFrom} />
                    <div className="flex items-center gap-1.5">
                      <span className="h-px flex-1 bg-[#efefec]" />
                      <span className="text-xs text-zinc-300">to</span>
                      <span className="h-px flex-1 bg-[#efefec]" />
                    </div>
                    <DatePicker value={customTo} onChange={setCustomTo} />
                  </div>
                  <Button
                    variant="primary"
                    className="mt-2 w-full"
                    onClick={() => {
                      setPreset("custom");
                      close();
                    }}
                  >
                    Apply
                  </Button>
                </div>
              </div>
            )}
          </Dropdown>
        }
      />

      {/* ── Main grid: left stack + Latest-updates rail ── */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_312px]">
        <div className="min-w-0 space-y-4">
          {/* KPI trio */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <KpiCard
              title="Total income"
              icon={<ArrowDownLeft size={15} />}
              value={fmtAED(totals.income, { compact: true })}
              delta={pctDelta(totals.income, prevTotals.income)}
              vsLabel={VS_LABELS[preset]}
              spark={sparkOf("income")}
              sparkColor="#10b981"
              sparkId="kpi-income"
            />
            <KpiCard
              title="Total spent"
              icon={<ArrowUpRight size={15} />}
              value={fmtAED(totals.expense, { compact: true })}
              delta={pctDelta(totals.expense, prevTotals.expense)}
              vsLabel={VS_LABELS[preset]}
              invert
              spark={sparkOf("expense")}
              sparkColor="#ef4444"
              sparkId="kpi-expense"
            />
            <KpiCard
              title="Net profit"
              icon={<Scale size={15} />}
              value={fmtAED(totals.net, { compact: true })}
              delta={pctDelta(totals.net, prevTotals.net)}
              vsLabel={VS_LABELS[preset]}
              spark={sparkOf("profit")}
              sparkColor="#18181b"
              sparkId="kpi-profit"
              sub={marginPct === null ? undefined : "Margin " + marginPct + "% of income"}
            />
          </div>

          {/* Cash-flow trend */}
          <Card className="p-5">
            <CardHeader
              icon={<TrendingUp size={13} />}
              title="Cash-flow trend"
              right={
                <div className="flex items-center gap-2">
                  {projEnd !== null ? (
                    <button
                      onClick={() => setShowProj((v) => !v)}
                      className={
                        "hidden sm:flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors " +
                        (showProj
                          ? "border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100"
                          : "border-zinc-200 text-zinc-400 hover:bg-zinc-50 hover:text-zinc-600")
                      }
                      title="Show projection to the end of the selected range on the chart"
                    >
                      <TrendingUp size={12} />
                      Projection
                    </button>
                  ) : null}
                  <Segmented
                    size="sm"
                    value={metric}
                    onChange={setMetric}
                    options={[
                      ["profit", "Profit"],
                      ["income", "Income"],
                      ["expense", "Expense"],
                    ]}
                  />
                </div>
              }
            />
            <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
              <span className="text-[30px] font-bold leading-none tracking-tight tabular-nums text-zinc-900">{fmtAED(trendTotal, { compact: true })}</span>
              <DeltaPill value={trendDelta} suffix={VS_LABELS[preset]} invert={metric === "expense"} />
              {projEnd !== null && showProj ? (
                <span className="text-[11px] font-medium text-amber-600" title={"Avg " + fmtAED(trendTotal / series.length) + "/day × " + periodDays + " days"}>
                  → projected period-end {fmtAED(projEnd, { compact: true })}
                </span>
              ) : null}
              <span className="text-[11px] text-zinc-400">avg {fmtAED(series.length ? trendTotal / series.length : 0, { compact: true })}/day</span>
            </div>
            <div className="mt-4 h-64 min-w-0 overflow-hidden">
              <TrendBars
                data={series}
                metric={metric}
                periodDays={periodDays}
                showProjection={showProj}
                target={metric === "income" ? db.settings.monthly_income_target : metric === "expense" ? db.settings.monthly_expense_target ?? 0 : db.settings.monthly_profit_target ?? 0}
              />
            </div>
          </Card>

          {/* Target pacing + dues, side by side */}
          <div className={"grid grid-cols-1 gap-4" + (showDues ? " md:grid-cols-2" : "")}>
            <Card className="p-5">
              <CardHeader
                tone="amber"
                icon={<Target size={13} />}
                title="Income target"
                right={proj.target > 0 ? <Pill tone={proj.onTrack ? "emerald" : "amber"}>{proj.onTrack ? "On track" : "Behind"}</Pill> : undefined}
              />
              {proj.target > 0 ? (
                <>
                  <div className="flex items-baseline gap-2">
                    <span className="text-[24px] font-bold leading-none tracking-tight tabular-nums text-zinc-900">{fmtAED(proj.soFar, { compact: true })}</span>
                    <span className="text-[11px] text-zinc-400">of {fmtAED(proj.target, { compact: true })}</span>
                  </div>
                  <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-[#f1f1ef]">
                    <div className="h-full rounded-full transition-all" style={{ width: Math.max(2, Math.round(targetPct * 100)) + "%", background: proj.onTrack ? "#10b981" : "#f59e0b" }} />
                  </div>
                  <div className="mt-2.5 flex items-center justify-between text-[11px] text-zinc-500">
                    <span>
                      Projected <span className="font-semibold text-zinc-900">{fmtAED(proj.projected, { compact: true })}</span>
                    </span>
                    <span className="font-semibold tabular-nums text-zinc-700">{Math.round(targetPct * 100)}%</span>
                  </div>
                  <div className="mt-0.5 text-[11px] text-zinc-400">
                    Needs {fmtAED(proj.neededPerDay, { compact: true })}/day · {proj.daysLeft} {proj.daysLeft === 1 ? "day" : "days"} left
                  </div>
                </>
              ) : (
                <p className="mt-2 text-[12px] leading-relaxed text-zinc-400">
                  No income target set. Add one in{" "}
                  <button onClick={() => router.push("/settings")} className="font-medium text-zinc-600 underline underline-offset-2 hover:text-zinc-900">
                    Settings → General
                  </button>{" "}
                  to track pacing here.
                </p>
              )}
            </Card>

            {showDues && duesSummary ? (
              <Card className="p-5">
                <CardHeader
                  tone="red"
                  icon={<Landmark size={13} />}
                  title="Dues &amp; fines"
                  right={<Pill tone={duesSummary.totalDue > 0 ? "red" : "emerald"}>{duesSummary.totalDue > 0 ? "Outstanding" : "All clear"}</Pill>}
                />
                <div className={"text-[24px] font-bold leading-none tracking-tight tabular-nums " + (duesSummary.totalDue > 0 ? "text-red-600" : "text-zinc-900")}>
                  {fmtAED(duesSummary.totalDue)}
                </div>
                <div className="mt-2.5 flex flex-wrap gap-x-3 gap-y-1 text-[11px] font-medium">
                  {duesSummary.dueCount > 0 ? <span className="text-amber-700">{duesSummary.dueCount} with dues</span> : null}
                  {duesSummary.clearCount > 0 ? <span className="text-emerald-700">{duesSummary.clearCount} clear</span> : null}
                  {duesSummary.pendingCount > 0 ? <span className="text-zinc-500">{duesSummary.pendingCount} pending check</span> : null}
                  {duesSummary.dueCount + duesSummary.clearCount + duesSummary.pendingCount === 0 ? <span className="text-zinc-400">No monitored accounts yet</span> : null}
                </div>
                <button
                  onClick={() => router.push("/dues")}
                  className="mt-3 inline-flex items-center gap-1 text-[12px] font-medium text-zinc-500 transition-colors hover:text-zinc-900"
                >
                  Open Dues &amp; fines <ArrowRight size={12} />
                </button>
              </Card>
            ) : null}
          </div>
        </div>

        {/* Latest updates rail */}
        <div className="min-w-0">
          <Card className="flex h-full max-h-[640px] flex-col p-5 lg:max-h-none">
            <CardHeader
              icon={<Activity size={13} />}
              title="Latest updates"
              right={
                <Segmented
                  size="sm"
                  value={win}
                  onChange={setWin}
                  options={[
                    ["today", "Today"],
                    ["yesterday", "Yesterday"],
                    ["week", "Week"],
                  ]}
                />
              }
            />
            <SearchInput value={aq} onChange={setAq} placeholder="Search activities" className="mb-3" />
            <MicroLabel className="mb-2.5">
              {todayCount} new {todayCount === 1 ? "entry" : "entries"} today
            </MicroLabel>
            {activity.length === 0 ? (
              <EmptyState icon={<Receipt size={18} />} title={"Nothing " + (win === "week" ? "this week" : win)} hint="New entries will appear here as they're added." />
            ) : (
              <ol className="app-scroll relative min-h-0 flex-1 space-y-3.5 overflow-y-auto pr-1 before:absolute before:bottom-2 before:left-[13px] before:top-2 before:w-px before:bg-[#efefec]">
                {activity.map((t) => (
                  <li key={t.id} className="relative flex cursor-pointer items-start gap-3" onClick={() => router.push("/transactions#txn-" + t.id)}>
                    <span className="relative z-10 shrink-0 rounded-full ring-4 ring-white">
                      <IconChip tone={t.kind === "income" ? "emerald" : "red"} className="h-7 w-7">
                        {t.kind === "income" ? <ArrowDownLeft size={13} /> : <ArrowUpRight size={13} />}
                      </IconChip>
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="truncate text-[13px] font-medium text-zinc-800">{t.description || nameOf.category(t.category_id) || (t.kind === "income" ? "Income" : "Expense")}</div>
                          <div className="truncate text-[11px] text-zinc-400">
                            {fmtAED(t.amount)} · {nameOf.method(t.payment_method_id) || "—"}
                            {t.job_ref ? " · " + t.job_ref : ""}
                          </div>
                        </div>
                        <span className="shrink-0 pt-0.5 text-[11px] tabular-nums text-zinc-400">{fmtTime(t.created_at)}</span>
                      </div>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </Card>
        </div>
      </div>

      {/* ── Transactions table ── */}
      <Card className="mt-4 overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-5 py-4">
          <div className="flex min-w-0 items-center gap-2.5">
            <IconChip tone="zinc">
              <Receipt size={13} />
            </IconChip>
            <h3 className="text-sm font-semibold text-zinc-900">Transactions</h3>
            <Pill tone="zinc">{filtered.length}</Pill>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <SearchInput value={tq} onChange={setTq} placeholder="Search entries" className="w-40 sm:w-52" />
            <Dropdown
              align="right"
              widthClass="w-44"
              trigger={(open) => (
                <span className="inline-flex items-center gap-1.5 rounded-lg border border-[#e5e5e2] bg-white px-3 py-2 text-[13px] font-medium text-zinc-600 shadow-[0_1px_2px_rgba(24,24,27,0.05)] transition-colors hover:border-zinc-300">
                  <Filter size={13} className="text-zinc-400" />
                  {kindFilter === "all" ? "All" : kindFilter === "income" ? "Income" : "Expenses"}
                  <ChevronDown size={13} className={"text-zinc-400 transition-transform " + (open ? "rotate-180" : "")} />
                </span>
              )}
            >
              {(close) => (
                <>
                  {(
                    [
                      ["all", "All entries"],
                      ["income", "Income only"],
                      ["expense", "Expenses only"],
                    ] as [KindFilter, string][]
                  ).map(([value, label]) => (
                    <MenuItem
                      key={value}
                      onClick={() => {
                        setKindFilter(value);
                        close();
                      }}
                    >
                      <span className="flex w-full items-center justify-between">
                        {label}
                        {kindFilter === value ? <Check size={13} className="text-zinc-900" /> : null}
                      </span>
                    </MenuItem>
                  ))}
                </>
              )}
            </Dropdown>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[680px] text-sm">
            <thead>
              <tr className="border-y border-[#f0ece4] bg-[#faf8f4] text-[11px] uppercase tracking-wider text-zinc-400">
                <th className="py-2.5 pl-5 pr-4 text-left font-semibold">
                  <button type="button" onClick={() => toggleSort("date")} className="inline-flex items-center gap-1 uppercase tracking-wider transition-colors hover:text-zinc-600">
                    Date <SortGlyph active={sort.key === "date"} />
                  </button>
                </th>
                <th className="px-4 py-2.5 text-left font-semibold">
                  <button type="button" onClick={() => toggleSort("description")} className="inline-flex items-center gap-1 uppercase tracking-wider transition-colors hover:text-zinc-600">
                    Description <SortGlyph active={sort.key === "description"} />
                  </button>
                </th>
                <th className="hidden px-4 py-2.5 text-left font-semibold md:table-cell">Category</th>
                <th className="hidden px-4 py-2.5 text-left font-semibold lg:table-cell">Method</th>
                <th className="hidden px-4 py-2.5 text-left font-semibold xl:table-cell">Recorded by</th>
                <th className="px-4 py-2.5 text-left font-semibold">Status</th>
                <th className="px-4 py-2.5 text-right font-semibold">
                  <button type="button" onClick={() => toggleSort("amount")} className="ml-auto inline-flex items-center gap-1 uppercase tracking-wider transition-colors hover:text-zinc-600">
                    Amount <SortGlyph active={sort.key === "amount"} />
                  </button>
                </th>
                <th className={"py-2.5 pr-5 text-right font-semibold " + (canEditTxn ? "w-10" : "")}>{/* kebab column */}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#f1f1ef]">
              {tableRows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-5">
                    <EmptyState icon={<Receipt size={18} />} title="No matching entries" hint={tq ? "Try a different search term." : "Nothing recorded in this period yet."} />
                  </td>
                </tr>
              ) : (
                tableRows.map((t) => (
                  <tr
                    key={t.id}
                    onClick={() => router.push("/transactions#txn-" + t.id)}
                    className="group cursor-pointer transition-colors hover:bg-[#faf8f4]"
                  >
                    <td className="py-3 pl-5 pr-4 align-middle text-[13px] tabular-nums text-zinc-500" title={fmtDate(t.txn_date)}>
                      {fmtDateShort(t.txn_date)}
                    </td>
                    <td className="max-w-[240px] px-4 py-3 align-middle">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-[13px] font-medium text-zinc-800">{t.description || nameOf.category(t.category_id) || "—"}</span>
                        {t.job_ref ? (
                          <span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-[#f7f7f5] px-1.5 py-0.5 text-[10px] font-semibold text-zinc-500">
                            <Hash size={9} />
                            {t.job_ref}
                          </span>
                        ) : null}
                      </div>
                    </td>
                    <td className="hidden max-w-[140px] truncate px-4 py-3 align-middle text-[13px] text-zinc-500 md:table-cell">{nameOf.category(t.category_id) || "Uncategorized"}</td>
                    <td className="hidden px-4 py-3 align-middle text-[13px] text-zinc-500 lg:table-cell">{nameOf.method(t.payment_method_id) || "—"}</td>
                    <td className="hidden px-4 py-3 align-middle lg:table-cell">
                      <span className="flex items-center gap-2">
                        <Avatar name={nameOf.user(t.created_by)} size="sm" />
                        <span className="max-w-[110px] truncate text-[13px] text-zinc-500">{nameOf.user(t.created_by)}</span>
                      </span>
                    </td>
                    <td className="px-4 py-3 align-middle">
                      <span className={"inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium " + (t.kind === "income" ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-600")}>
                        <span className={"h-1.5 w-1.5 rounded-full " + (t.kind === "income" ? "bg-emerald-500" : "bg-red-500")} />
                        {t.kind === "income" ? "Income" : "Expense"}
                      </span>
                    </td>
                    <td className={"px-4 py-3 text-right align-middle text-[13px] font-semibold tabular-nums " + (t.kind === "income" ? "text-emerald-600" : "text-zinc-900")}>
                      {t.kind === "income" ? "+" : "−"}
                      {fmtAED(t.amount)}
                    </td>
                    <td className="py-3 pl-2 pr-5 text-right align-middle" onClick={(e) => e.stopPropagation()}>
                      {canEditTxn ? (
                        <div className="opacity-0 transition-opacity group-hover:opacity-100">
                          <KebabMenu
                            items={[
                              { label: "Edit entry", icon: <SquarePen size={13} />, onSelect: () => router.push("/transactions#edit-" + t.id) },
                              { label: "Delete", icon: <Trash2 size={13} />, danger: true, onSelect: () => setDeleting(t) },
                            ]}
                          />
                        </div>
                      ) : null}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {filtered.length > tableRows.length ? (
          <div className="flex items-center justify-between border-t border-[#f0ece4] px-5 py-3 text-[12px] text-zinc-400">
            <span>
              Showing {tableRows.length} of {filtered.length} entries
            </span>
            <button onClick={() => router.push("/transactions")} className="inline-flex items-center gap-1 font-medium text-zinc-600 transition-colors hover:text-zinc-900">
              View all in Transactions <ArrowRight size={12} />
            </button>
          </div>
        ) : null}
      </Card>

      <ConfirmDelete
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        label={deleting ? deleting.description || deleting.job_ref || "this entry" : ""}
        onConfirm={() => {
          if (deleting) setDb((prev) => (prev ? deleteTransaction(prev, deleting.id) : prev));
          setDeleting(null);
        }}
      />
    </div>
  );
}

/* ───────────────────────────── Helper components ─────────────────────────── */

/** Kravio KPI card: label + tiny icon, big value, delta pill + sparkline. */
function KpiCard({
  title,
  icon,
  value,
  delta,
  vsLabel,
  invert = false,
  spark,
  sparkColor,
  sparkId,
  sub,
}: {
  title: string;
  icon: ReactNode;
  value: string;
  delta: number | null;
  vsLabel: string;
  invert?: boolean;
  spark: number[];
  sparkColor: string;
  sparkId: string;
  sub?: string;
}) {
  return (
    <Card className="flex flex-col p-4">
      <div className="flex items-start justify-between gap-2">
        <span className="text-[12px] font-medium text-zinc-500">{title}</span>
        <span className="shrink-0 text-zinc-300">{icon}</span>
      </div>
      <div className="mt-2 text-[26px] font-bold leading-none tracking-tight tabular-nums text-zinc-900">{value}</div>
      <div className="mt-2.5 flex items-end justify-between gap-2">
        <div className="min-w-0">
          <DeltaPill value={delta} suffix={vsLabel} invert={invert} />
          {sub ? <div className="mt-1 text-[10px] text-zinc-400">{sub}</div> : null}
        </div>
        <Sparkline points={spark} color={sparkColor} id={sparkId} className="h-9 w-20 shrink-0" />
      </div>
    </Card>
  );
}
