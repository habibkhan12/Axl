"use client";
import React, { useEffect, useMemo, useState } from "react";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend, Bar, ReferenceLine, ComposedChart, Line } from "recharts";
import { fmtAED, fmtWeekday, todayISO } from "@/lib/format";
import type { DayPoint } from "@/lib/analytics";

/* ───────────────────────── TrendBars — Kravio bar chart ──────────────────── */
/* Light-gray rounded bars; the hovered / current day turns near-black, a      */
/* dashed reference line marks the period average, y-axis sits on the right.   */

export type TrendMetric = "profit" | "income" | "expense";

export function TrendBars({
  data,
  metric,
  target,
  periodDays,
  showProjection,
}: {
  data: DayPoint[];
  metric: TrendMetric;
  target?: number;
  /** Full length of the selected range, so the target-pace line is computed against the whole period even when the chart is clipped at today. */
  periodDays?: number;
  /** When on and the range runs past today: pace + projection dashed lines extend to the end of the range while actual bars/line stay at today. */
  showProjection?: boolean;
}) {
  const today = todayISO();
  const [active, setActive] = useState<number | null>(null);

  const rows = useMemo(
    () =>
      data.map((d) => ({
        date: d.date,
        value: metric === "profit" ? d.income - d.expense : metric === "income" ? d.income : d.expense,
      })),
    [data, metric]
  );

  // Target overlay (metric vs its period target): cumulative actual to today.
  // With the projection toggle on and the range running past today, the
  // target-pace line and an at-current-pace projection extend to the range end;
  // bars and the actual line never plot into the future.
  const showTarget = !!target && target > 0 && rows.length > 1;
  const todayIdx = rows.findIndex((r) => r.date === today);
  const runs: number[] = [];
  let run = 0;
  for (const r of rows) {
    run += r.value;
    runs.push(run);
  }
  const cumAtToday = todayIdx >= 0 ? runs[todayIdx] : runs[runs.length - 1];
  const avgPerDay = todayIdx > 0 ? cumAtToday / (todayIdx + 1) : cumAtToday;
  const pacePerDay = showTarget ? target! / (periodDays ?? rows.length) : 0;
  const projFuture = !!(showProjection && showTarget && todayIdx >= 0 && periodDays && periodDays > rows.length);

  // Future rows (day after today .. end of range): no bar, no actual line —
  // only the dashed pace / projection lines continue.
  const future: { date: string; value: number | null }[] = projFuture
    ? Array.from({ length: (periodDays ?? rows.length) - rows.length }, (_, k) => {
        const d = new Date(rows[rows.length - 1].date + "T00:00:00");
        d.setDate(d.getDate() + 1 + k);
        const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
        return { date: iso, value: null };
      })
    : [];

  const enriched = [...rows, ...future].map((r, i) => ({
    date: r.date,
    value: r.value,
    cum: i < rows.length ? runs[i] : null,
    pace: showTarget ? Math.round(pacePerDay * (i + 1)) : null,
    proj: projFuture && i >= todayIdx ? Math.round(cumAtToday + avgPerDay * (i - todayIdx)) : null,
  }));
  const projEndVal = projFuture ? cumAtToday + avgPerDay * ((periodDays ?? rows.length) - 1 - todayIdx) : null;
  const cumMax = Math.max(...runs, showTarget ? pacePerDay * (periodDays ?? rows.length) : 0, projEndVal ?? 0);

  // Default highlight: today when visible, otherwise the latest day.
  useEffect(() => {
    const i = rows.findIndex((r) => r.date === today);
    setActive(i >= 0 ? i : rows.length - 1);
  }, [rows, today]);

  if (rows.length === 0) return null;

  const maxV = Math.max(...rows.map((r) => r.value), 0);
  const minV = Math.min(...rows.map((r) => r.value), 0);
  const avg = rows.reduce((s, r) => s + r.value, 0) / rows.length;
  const few = rows.length <= 10;
  const interval = rows.length > 16 ? 4 : rows.length > 10 ? 2 : 0;

  return (
    <div className="h-full">
    <ResponsiveContainer width="100%" height="88%">
      <ComposedChart
        data={enriched}
        margin={{ top: 16, right: 4, bottom: 0, left: 4 }}
        onMouseMove={(s: unknown) => {
          const st = s as { activeTooltipIndex?: number };
          if (typeof st?.activeTooltipIndex === "number" && st.activeTooltipIndex >= 0) setActive(st.activeTooltipIndex);
        }}
      >
        <Tooltip cursor={{ fill: "rgba(24,24,27,0.045)" }} content={<TrendTip showCum={showTarget} />} />
        {!showTarget ? <ReferenceLine y={avg} stroke="#b1b1b7" strokeDasharray="5 5" /> : null}
        <XAxis
          dataKey="date"
          tickFormatter={(d: string) => (few ? fmtWeekday(d) : d.slice(8, 10))}
          tick={{ fontSize: 11, fill: "#a1a1aa" }}
          axisLine={false}
          tickLine={false}
          interval={interval}
        />
        <YAxis
          yAxisId="daily"
          orientation="right"
          width={46}
          domain={[minV < 0 ? Math.floor(minV * 1.15) : 0, Math.ceil(maxV * 1.15) || 1]}
          tick={{ fontSize: 11, fill: "#a1a1aa" }}
          axisLine={false}
          tickLine={false}
          tickFormatter={(v: number) => (Math.abs(v) >= 1000 ? (v / 1000).toFixed(Math.abs(v) >= 10000 ? 0 : 1) + "k" : String(v))}
        />
        {showTarget ? <YAxis yAxisId="cum" hide domain={[0, Math.ceil(cumMax * 1.08) || 1]} /> : null}
        <Bar yAxisId="daily" dataKey="value" radius={[5, 5, 2, 2]} maxBarSize={40}>
          {rows.map((r, i) => (
            <Cell key={i} fill={i === active ? "#1c1c21" : r.value === 0 ? "#f1f1ef" : "#e5e5e9"} />
          ))}
        </Bar>
        {showTarget ? (
          <>
            <Line yAxisId="cum" type="monotone" dataKey="cum" stroke="#18181b" strokeWidth={2} dot={false} isAnimationActive={false} connectNulls={false} />
            <Line yAxisId="cum" type="linear" dataKey="pace" stroke="#a1a1aa" strokeWidth={1.5} strokeDasharray="6 6" dot={false} isAnimationActive={false} />
            {projFuture ? (
              <Line yAxisId="cum" type="linear" dataKey="proj" stroke="#f59e0b" strokeWidth={2} strokeDasharray="4 4" dot={false} isAnimationActive={false} />
            ) : null}
          </>
        ) : null}
      </ComposedChart>
    </ResponsiveContainer>
    {showTarget ? (
      <div className="mt-1 flex h-[12%] flex-wrap items-center gap-x-4 gap-y-0.5 text-[10px] font-medium text-zinc-400">
        <span className="flex items-center gap-1.5"><span className="h-0.5 w-4 rounded bg-zinc-900" /> Actual to date</span>
        <span className="flex items-center gap-1.5"><span className="h-0 w-4 border-t border-dashed border-zinc-400" /> Target pace</span>
        {projFuture ? (
          <span className="flex items-center gap-1.5"><span className="h-0 w-4 border-t border-dashed border-amber-500" /> Projection at current pace</span>
        ) : null}
      </div>
    ) : null}
    </div>
  );
}

function TrendTip(props: { active?: boolean; showCum?: boolean; payload?: { payload?: { date: string; value: number | null; cum?: number | null; pace?: number | null; proj?: number | null } }[] }) {
  if (!props.active || !props.payload?.length) return null;
  const p = props.payload[0]?.payload;
  if (!p) return null;
  const head =
    p.value != null
      ? fmtWeekday(p.date) + " · " + fmtAED(p.value)
      : p.proj != null
        ? fmtWeekday(p.date) + " · projected pace"
        : fmtWeekday(p.date);
  return (
    <div className="rounded-lg bg-zinc-900 px-2.5 py-1.5 text-[11px] font-semibold text-white shadow-[0_4px_14px_rgba(24,24,27,0.3)]">
      {head}
      {props.showCum && (p.cum != null || p.pace != null || p.proj != null) ? (
        <div className="font-normal text-zinc-300">
          {p.cum != null ? "to date " + fmtAED(p.cum, { compact: true }) : p.proj != null ? "projected " + fmtAED(p.proj, { compact: true }) : "projected " + fmtAED(p.pace ?? 0, { compact: true })}
          {p.pace != null ? " · target " + fmtAED(p.pace, { compact: true }) : ""}
        </div>
      ) : null}
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
