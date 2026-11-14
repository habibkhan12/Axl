"use client";
import React, { useMemo } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
  CartesianGrid,
  LineChart,
  Line,
} from "recharts";
import { fmtAED, fmtNum, fmtWeekday, todayISO } from "@/lib/format";
import type { DayPoint } from "@/lib/analytics";

/* ──────────────────────────── Cash-flow trend ───────────────────────────── */
/* One plain line: the running total for the period, drawn from zero upward.  */
/* No bars, no second axis, no average/target clutter — just the balance curve */
/* with an optional dashed projection to the end of the selected range.        */

export type TrendMetric = "profit" | "income" | "expense";

export function TrendChart({
  data,
  metric,
  periodDays,
  showProjection,
}: {
  data: DayPoint[];
  metric: TrendMetric;
  /** Full length of the selected range, so the projection can run to its end. */
  periodDays?: number;
  /** Extend the running total to the end of the range at today's average pace. */
  showProjection?: boolean;
}) {
  const today = todayISO();

  const daily = useMemo(
    () =>
      data.map((d) => ({
        date: d.date,
        value: metric === "profit" ? d.income - d.expense : metric === "income" ? d.income : d.expense,
      })),
    [data, metric]
  );

  const chart = useMemo(() => {
    if (daily.length === 0) return [] as { date: string; total: number | null; proj: number | null }[];

    // Running total from the first day of the range — always starts at 0.
    let running = 0;
    const rows: { date: string; total: number | null; proj: number | null }[] = daily.map((d) => {
      running += d.value;
      return { date: d.date, total: running, proj: null };
    });

    const todayIdx = daily.findIndex((d) => d.date === today);
    const elapsed = todayIdx >= 0 ? todayIdx + 1 : daily.length;

    if (showProjection && periodDays && periodDays > daily.length && elapsed > 0) {
      const avgPerDay = (rows[elapsed - 1].total ?? 0) / elapsed;
      const last = rows[rows.length - 1];
      const lastTotal = last.total ?? 0;
      // Join the dashed line to the real one at the last recorded day.
      last.proj = lastTotal;
      const anchor = new Date(last.date + "T00:00:00");
      for (let k = 1; k <= periodDays - daily.length; k++) {
        const d = new Date(anchor);
        d.setDate(d.getDate() + k);
        const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
        rows.push({ date: iso, total: null, proj: Math.round(lastTotal + avgPerDay * k) });
      }
    }

    return rows;
  }, [daily, periodDays, showProjection, today]);

  if (chart.length === 0) return null;

  const values = chart.map((r) => r.total ?? r.proj ?? 0);
  const maxV = Math.max(...values, 0);
  const minV = Math.min(...values, 0);
  const showProjectionLine = chart.some((r) => r.proj != null);
  const dayCount = daily.length;
  const few = dayCount <= 10;
  const interval = dayCount > 16 ? 4 : dayCount > 10 ? 2 : 0;

  return (
    <div className="h-full">
      <ResponsiveContainer width="100%" height="88%">
        <LineChart data={chart} margin={{ top: 12, right: 4, bottom: 0, left: 4 }}>
          <CartesianGrid stroke="#f2f2f0" vertical={false} />
          <XAxis
            dataKey="date"
            tickFormatter={(d: string) => (few ? fmtWeekday(d) : d.slice(8, 10))}
            tick={{ fontSize: 11, fill: "#a1a1aa" }}
            axisLine={false}
            tickLine={false}
            interval={interval}
          />
          <YAxis
            orientation="right"
            width={78}
            // Zero is always the floor: the curve reads upward like a balance.
            domain={[minV < 0 ? Math.floor(minV * 1.1) : 0, Math.ceil(maxV * 1.1) || 1]}
            tick={{ fontSize: 11, fill: "#a1a1aa" }}
            axisLine={false}
            tickLine={false}
            tickFormatter={(v: number) => fmtNum(v)}
          />
          <Tooltip
            cursor={{ stroke: "#d4d4d0", strokeDasharray: "3 3" }}
            content={<TrendTip />}
          />
          <Line
            type="monotone"
            dataKey="total"
            stroke="#18181b"
            strokeWidth={2.2}
            dot={false}
            activeDot={{ r: 4, strokeWidth: 0, fill: "#18181b" }}
            isAnimationActive={false}
            connectNulls={false}
          />
          {showProjectionLine ? (
            <Line
              type="linear"
              dataKey="proj"
              stroke="#f59e0b"
              strokeWidth={2}
              strokeDasharray="5 5"
              dot={false}
              isAnimationActive={false}
              connectNulls={false}
            />
          ) : null}
        </LineChart>
      </ResponsiveContainer>
      <div className="mt-1 flex h-[12%] flex-wrap items-center gap-x-4 gap-y-0.5 text-[10px] font-medium text-zinc-400">
        <span className="flex items-center gap-1.5">
          <span className="h-0.5 w-4 rounded bg-zinc-900" /> Running total
        </span>
        {showProjectionLine ? (
          <span className="flex items-center gap-1.5">
            <span className="h-0 w-4 border-t border-dashed border-amber-500" /> Projection to period end
          </span>
        ) : null}
      </div>
    </div>
  );
}

function TrendTip(props: { active?: boolean; payload?: { payload?: { date: string; total: number | null; proj: number | null } }[] }) {
  if (!props.active || !props.payload?.length) return null;
  const p = props.payload[0]?.payload;
  if (!p) return null;
  const amount = p.total ?? p.proj;
  if (amount == null) return null;
  return (
    <div className="rounded-lg bg-zinc-900 px-2.5 py-1.5 text-[11px] font-semibold text-white shadow-[0_4px_14px_rgba(24,24,27,0.3)]">
      {fmtWeekday(p.date)} · {fmtAED(amount)}
      {p.total == null ? <span className="ml-1 font-normal text-zinc-400">projected</span> : null}
    </div>
  );
}

/* ───────────────────────────── Sparkline (KPI cards) ─────────────────────── */

export function Sparkline({ points, color, id, className = "h-10 w-24" }: { points: number[]; color: string; id: string; className?: string }) {
  const rows = points.map((v, i) => ({ i, v }));
  if (rows.length < 2) return <div className={className} />;
  const gid = "spark-" + id;
  return (
    <div className={className + " min-w-0 overflow-hidden"}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={rows} margin={{ top: 3, right: 0, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.22} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <Area type="monotone" dataKey="v" stroke={color} strokeWidth={1.6} fill={"url(#" + gid + ")"} dot={false} isAnimationActive={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

/* ──────────────────────────────── Donut ──────────────────────────────────── */

const DONUT_COLORS = ["#18181b", "#ef4444", "#f59e0b", "#10b981", "#3b82f6", "#8b5cf6", "#ec4899", "#14b8a6", "#f97316", "#64748b", "#84cc16", "#a855f7", "#06b6d4", "#eab308"];

export function CategoryDonut({ data }: { data: { name: string; total: number }[] }) {
  if (data.length === 0) return <div className="flex h-64 items-center justify-center text-sm text-zinc-400">No expenses in this period</div>;
  return (
    <div className="h-64 w-full min-w-0 overflow-hidden">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie data={data} dataKey="total" nameKey="name" innerRadius="55%" outerRadius="80%" paddingAngle={2} strokeWidth={0}>
            {data.map((_, i) => (
              <Cell key={i} fill={DONUT_COLORS[i % DONUT_COLORS.length]} />
            ))}
          </Pie>
          <Tooltip
            formatter={(value, name) => [fmtAED(Number(value)), String(name)]}
            contentStyle={{ borderRadius: 12, border: "1px solid #e9e9e6", fontSize: 12, boxShadow: "0 8px 24px rgba(24,24,27,0.12)" }}
          />
          <Legend iconType="circle" wrapperStyle={{ fontSize: 11 }} />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}
