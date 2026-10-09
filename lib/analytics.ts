// ─── Analytics engine — pure functions over transactions ────────────────────
import type { Database, Transaction, Kind } from "./types";
import { daysInMonth, toISO } from "./format";

export interface Totals {
  income: number;
  expense: number;
  net: number;
}

export function inRange(t: Transaction, from: string, to: string): boolean {
  return t.txn_date >= from && t.txn_date <= to;
}

export function totalsOf(rows: Transaction[]): Totals {
  let income = 0;
  let expense = 0;
  for (const t of rows) {
    if (t.kind === "income") income += t.amount;
    else expense += t.amount;
  }
  return { income, expense, net: income - expense };
}

export function rowsInRange(db: Database, from: string, to: string): Transaction[] {
  return db.transactions.filter((t) => inRange(t, from, to)).sort((a, b) => (a.txn_date < b.txn_date ? 1 : a.txn_date > b.txn_date ? -1 : a.created_at < b.created_at ? 1 : -1));
}

export interface DayPoint {
  date: string;
  income: number;
  expense: number;
}

export function dailySeries(rows: Transaction[], from: string, to: string): DayPoint[] {
  const map = new Map<string, DayPoint>();
  const start = new Date(from + "T00:00:00");
  const end = new Date(to + "T00:00:00");
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    map.set(iso, { date: iso, income: 0, expense: 0 });
  }
  for (const t of rows) {
    const point = map.get(t.txn_date);
    if (!point) continue;
    if (t.kind === "income") point.income += t.amount;
    else point.expense += t.amount;
  }
  return [...map.values()];
}

export interface NamedTotal {
  id: string;
  name: string;
  total: number;
  count: number;
  share: number; // 0..1 of expense (or of income for income rows)
}

export function byCategory(db: Database, rows: Transaction[], kind: Kind): NamedTotal[] {
  const acc = new Map<string, { total: number; count: number }>();
  let grand = 0;
  for (const t of rows) {
    if (t.kind !== kind) continue;
    const key = t.category_id ?? "_none";
    const entry = acc.get(key) ?? { total: 0, count: 0 };
    entry.total += t.amount;
    entry.count += 1;
    acc.set(key, entry);
    grand += t.amount;
  }
  const out: NamedTotal[] = [];
  for (const [id, { total, count }] of acc) {
    const name = id === "_none" ? "Uncategorized" : db.categories.find((c) => c.id === id)?.name ?? "Unknown";
    out.push({ id, name, total, count, share: grand > 0 ? total / grand : 0 });
  }
  out.sort((a, b) => b.total - a.total);
  return out;
}

export function byPaymentMethod(db: Database, rows: Transaction[], kind: Kind): NamedTotal[] {
  const acc = new Map<string, { total: number; count: number }>();
  let grand = 0;
  for (const t of rows) {
    if (t.kind !== kind) continue;
    const key = t.payment_method_id ?? "_none";
    const entry = acc.get(key) ?? { total: 0, count: 0 };
    entry.total += t.amount;
    entry.count += 1;
    acc.set(key, entry);
    grand += t.amount;
  }
  const out: NamedTotal[] = [];
  for (const [id, { total, count }] of acc) {
    const name = id === "_none" ? "(Unspecified)" : db.payment_methods.find((p) => p.id === id)?.name ?? "Unknown";
    out.push({ id, name, total, count, share: grand > 0 ? total / grand : 0 });
  }
  out.sort((a, b) => b.total - a.total);
  return out;
}

// ─── Fleet analytics (Fuel + Vehicles categories) ───────────────────────────

export interface VehicleStat {
  vehicleId: string;
  total: number;
  liters: number | null;
  count: number;
  byDay: Map<string, number>; // iso date -> amount
}

export function vehicleName(db: Database, id: string | null | undefined): string {
  if (!id) return "Unassigned";
  if (id === "_none") return "Unassigned";
  return db.vehicles.find((v) => v.id === id)?.label ?? "Unknown";
}

export function isVehicleExpense(db: Database, t: Transaction): boolean {
  const cat = db.categories.find((c) => c.id === t.category_id);
  return cat?.id === "c_fuel" || cat?.id === "c_vehicles";
}

export function vehicleStats(db: Database, from: string, to: string): VehicleStat[] {
  const map = new Map<string, VehicleStat>();
  for (const t of db.transactions) {
    if (t.kind !== "expense") continue;
    if (!inRange(t, from, to)) continue;
    if (!isVehicleExpense(db, t)) continue;
    const vid = t.vehicle_id ?? "_none";
    const stat = map.get(vid) ?? { vehicleId: vid, total: 0, liters: null, count: 0, byDay: new Map() };
    stat.total += t.amount;
    stat.count += 1;
    if (t.fuel_liters != null) stat.liters = (stat.liters ?? 0) + t.fuel_liters;
    stat.byDay.set(t.txn_date, (stat.byDay.get(t.txn_date) ?? 0) + t.amount);
    map.set(vid, stat);
  }
  return [...map.values()].sort((a, b) => b.total - a.total);
}

// ─── Period helpers ──────────────────────────────────────────────────────────

export function monthBounds(ym: string): { from: string; to: string } {
  const [y, m] = ym.split("-").map(Number);
  const last = daysInMonth(ym);
  const pad = (n: number) => String(n).padStart(2, "0");
  return { from: `${y}-${pad(m)}-01`, to: `${y}-${pad(m)}-${pad(last)}` };
}

export function previousMonth(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(y, m - 2, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export interface Projection {
  soFar: number;
  projected: number;
  target: number;
  onTrack: boolean;
  neededPerDay: number;
  daysLeft: number;
  dayOfMonth: number;
  totalDays: number;
}

export function projectedMonthEndIncome(rows: Transaction[], ym: string, target: number): Projection {
  const { from, to } = monthBounds(ym);
  const nowISO = toISO(new Date());
  const effectiveToday = nowISO < from ? from : nowISO > to ? to : nowISO;
  const dayOfMonth = Math.max(1, Number(effectiveToday.slice(8, 10)));
  const totalDays = daysInMonth(ym);
  let soFar = 0;
  for (const t of rows) {
    if (t.kind === "income" && t.txn_date >= from && t.txn_date <= effectiveToday) soFar += t.amount;
  }
  const projected = dayOfMonth > 0 ? (soFar / dayOfMonth) * totalDays : 0;
  const daysLeft = Math.max(0, totalDays - dayOfMonth);
  const neededPerDay = daysLeft > 0 ? Math.max(0, (target - soFar) / daysLeft) : Math.max(0, target - soFar);
  return {
    soFar,
    projected,
    target,
    onTrack: projected >= target,
    neededPerDay,
    daysLeft,
    dayOfMonth,
    totalDays,
  };
}

// ─── Kravio dashboard helpers ───────────────────────────────────────────────

/** The period of equal length immediately before [from, to]. */
export function previousPeriod(from: string, to: string): { from: string; to: string } {
  const DAY = 86400000;
  const start = Date.parse(from + "T00:00:00");
  const end = Date.parse(to + "T00:00:00");
  const len = Math.max(1, Math.round((end - start) / DAY) + 1);
  const prevEnd = start - DAY;
  return { from: toISO(new Date(prevEnd - (len - 1) * DAY)), to: toISO(new Date(prevEnd)) };
}

/** Percent change current vs previous; null when the baseline is zero. */
export function pctDelta(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

export type ActivityWindow = "today" | "yesterday" | "week";

/** Transactions for the Latest-activity rail, newest first. */
export function activityRows(db: Database, win: ActivityWindow): Transaction[] {
  const today = toISO(new Date());
  const yesterday = toISO(new Date(Date.now() - 86400000));
  const weekAgo = toISO(new Date(Date.now() - 6 * 86400000));
  const inWin = (t: Transaction) =>
    win === "today"
      ? t.txn_date === today
      : win === "yesterday"
        ? t.txn_date === yesterday
        : t.txn_date >= weekAgo && t.txn_date <= today;
  return db.transactions
    .filter(inWin)
    .sort((a, b) => (a.txn_date < b.txn_date ? 1 : a.txn_date > b.txn_date ? -1 : a.created_at < b.created_at ? 1 : -1));
}
