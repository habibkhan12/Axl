"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { daysInMonth, fmtDate, monthLabel, MONTHS_SHORT, todayISO } from "@/lib/format";

const TRIGGER =
  "flex w-full items-center justify-between gap-2 rounded-lg border border-[#e5e5e2] bg-white px-3 py-2 text-sm text-zinc-800 shadow-[0_1px_2px_rgba(24,24,27,0.05)] transition-colors hover:border-zinc-300";

const NAV =
  "flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-zinc-400 transition-colors hover:bg-[#f4f4f2] hover:text-zinc-700";

const HEADER_BTN =
  "rounded-lg px-2 py-1 text-xs font-semibold text-zinc-700 transition-colors hover:bg-[#f4f4f2] hover:text-zinc-900";

const CELL =
  "rounded-lg text-xs font-medium transition-colors";

const PANEL =
  "z-[100] rounded-xl border border-[#e9e9e6] bg-white p-1.5 shadow-[0_2px_8px_rgba(24,24,27,0.08),0_12px_32px_-8px_rgba(24,24,27,0.18)]";

/**
 * Anchored popover rendered in a portal. Absolutely-positioned dropdowns get
 * clipped by scroll containers and `overflow-hidden` cards (which is what hid
 * half the month grid on the Transactions toolbar), so this one is fixed to the
 * trigger's measured rect and flips above it when there isn't room below.
 */
function Popover({
  anchor,
  open,
  onClose,
  width = 280,
  children,
}: {
  anchor: React.RefObject<HTMLElement | null>;
  open: boolean;
  onClose: () => void;
  width?: number;
  children: React.ReactNode;
}) {
  const panel = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    const place = () => {
      const r = anchor.current?.getBoundingClientRect();
      const el = panel.current;
      if (!r || !el) return;
      const h = el.offsetHeight;
      const left = Math.min(Math.max(8, r.left), Math.max(8, window.innerWidth - width - 8));
      let top = r.bottom + 6;
      if (top + h > window.innerHeight - 8) top = Math.max(8, r.top - h - 6);
      setPos({ top, left });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, anchor, width]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (panel.current?.contains(t)) return;
      if (anchor.current?.contains(t)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose, anchor]);

  if (!open) return null;
  return createPortal(
    <div
      ref={panel}
      role="dialog"
      style={{
        position: "fixed",
        top: pos?.top ?? -9999,
        left: pos?.left ?? -9999,
        width,
        visibility: pos ? "visible" : "hidden",
      }}
      className={PANEL}
    >
      {children}
    </div>,
    document.body
  );
}

/** ‹ 2026 › — the year stepper shared by the month and year views. */
function YearStepper({
  year,
  onShift,
  onPickYear,
}: {
  year: number;
  onShift: (delta: number) => void;
  onPickYear: () => void;
}) {
  return (
    <div className="mb-1 flex items-center justify-between">
      <button type="button" onClick={() => onShift(-1)} className={NAV} aria-label="Previous year">
        <ChevronLeft size={14} />
      </button>
      <button type="button" onClick={onPickYear} className={HEADER_BTN}>
        {year}
      </button>
      <button type="button" onClick={() => onShift(1)} className={NAV} aria-label="Next year">
        <ChevronRight size={14} />
      </button>
    </div>
  );
}

/** All twelve months — never clipped, three per row. */
function MonthGrid({
  year,
  selectedYm,
  onPick,
}: {
  year: number;
  selectedYm: string;
  onPick: (ym: string) => void;
}) {
  return (
    <div className="grid grid-cols-3 gap-1">
      {MONTHS_SHORT.map((m, i) => {
        const ym = year + "-" + String(i + 1).padStart(2, "0");
        const active = ym === selectedYm;
        return (
          <button
            key={m}
            type="button"
            onClick={() => onPick(ym)}
            className={
              CELL +
              " px-2 py-2 " +
              (active
                ? "bg-zinc-900 text-white shadow-[0_1px_2px_rgba(24,24,27,0.2)]"
                : "text-zinc-600 hover:bg-[#f4f4f2] hover:text-zinc-900")
            }
          >
            {m}
          </button>
        );
      })}
    </div>
  );
}

/** Twelve years per page, so you can jump decades without arrow-mashing. */
function YearGrid({
  year,
  onPick,
  onShift,
}: {
  year: number;
  onPick: (y: number) => void;
  onShift: (delta: number) => void;
}) {
  const base = Math.floor(year / 12) * 12;
  const years = Array.from({ length: 12 }, (_, i) => base + i);
  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <button type="button" onClick={() => onShift(-12)} className={NAV} aria-label="Earlier years">
          <ChevronLeft size={14} />
        </button>
        <span className="text-xs font-semibold text-zinc-700">
          {base}–{base + 11}
        </span>
        <button type="button" onClick={() => onShift(12)} className={NAV} aria-label="Later years">
          <ChevronRight size={14} />
        </button>
      </div>
      <div className="grid grid-cols-3 gap-1">
        {years.map((y) => (
          <button
            key={y}
            type="button"
            onClick={() => onPick(y)}
            className={
              CELL +
              " px-2 py-2 tabular-nums " +
              (y === year
                ? "bg-zinc-900 text-white shadow-[0_1px_2px_rgba(24,24,27,0.2)]"
                : "text-zinc-600 hover:bg-[#f4f4f2] hover:text-zinc-900")
            }
          >
            {y}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Kravio month picker — month + year, all twelve months visible. */
export function MonthPicker({ value, onChange, className = "" }: { value: string; onChange: (ym: string) => void; className?: string }) {
  const today = todayISO();
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement | null>(null);
  const [view, setView] = useState<"months" | "years">("months");
  const [year, setYear] = useState(Number(value.slice(0, 4)));

  useEffect(() => setYear(Number(value.slice(0, 4))), [value]);

  return (
    <>
      <button type="button" ref={anchor} onClick={() => setOpen((o) => !o)} className={TRIGGER + " " + className}>
        <span className="truncate">{monthLabel(value)}</span>
        <CalendarDays size={14} className="shrink-0 text-zinc-400" />
      </button>
      <Popover anchor={anchor} open={open} onClose={() => setOpen(false)}>
        {view === "months" ? (
          <>
            <YearStepper year={year} onShift={(d) => setYear((y) => y + d)} onPickYear={() => setView("years")} />
            <MonthGrid
              year={year}
              selectedYm={value}
              onPick={(ym) => {
                onChange(ym);
                setOpen(false);
              }}
            />
          </>
        ) : (
          <YearGrid
            year={year}
            onShift={(d) => setYear((y) => y + d)}
            onPick={(y) => {
              setYear(y);
              setView("months");
            }}
          />
        )}
        <button
          type="button"
          onClick={() => {
            onChange(today.slice(0, 7));
            setOpen(false);
          }}
          className={
            "mt-1 w-full border-t border-[#efefec] px-2 pb-1 pt-2 text-xs font-medium transition-colors " +
            (value === today.slice(0, 7) ? "text-zinc-300" : "text-zinc-500 hover:text-zinc-900")
          }
        >
          This month
        </button>
      </Popover>
    </>
  );
}

/**
 * Kravio date picker — one popover with three views:
 *   days   → pick any date (prev/next month, click the title for months)
 *   months → pick a month for the browsed year
 *   years  → pick a year, twelve at a time
 */
export function DatePicker({ value, onChange, className = "" }: { value: string; onChange: (iso: string) => void; className?: string }) {
  const today = todayISO();
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement | null>(null);
  const [view, setView] = useState<"days" | "months" | "years">("days");
  const [cursor, setCursor] = useState({ y: Number(value.slice(0, 4)), m: Number(value.slice(5, 7)) });

  useEffect(() => setCursor({ y: Number(value.slice(0, 4)), m: Number(value.slice(5, 7)) }), [value]);

  const ym = cursor.y + "-" + String(cursor.m).padStart(2, "0");
  const dim = daysInMonth(ym);
  const firstDow = new Date(cursor.y, cursor.m - 1, 1).getDay();
  const days = Array.from({ length: dim }, (_, i) => i + 1);

  function shiftMonth(delta: number) {
    setCursor((v) => {
      const m = v.m + delta;
      return { y: v.y + Math.floor((m - 1) / 12), m: ((((m - 1) % 12) + 12) % 12) + 1 };
    });
  }

  function close() {
    setOpen(false);
    setView("days");
  }

  return (
    <>
      <button type="button" ref={anchor} onClick={() => setOpen((o) => !o)} className={TRIGGER + " " + className}>
        <span className="truncate">{fmtDate(value)}</span>
        <CalendarDays size={14} className="shrink-0 text-zinc-400" />
      </button>
      <Popover anchor={anchor} open={open} onClose={close} width={292}>
        {view === "days" ? (
          <>
            <div className="mb-1 flex items-center justify-between">
              <button type="button" onClick={() => shiftMonth(-1)} className={NAV} aria-label="Previous month">
                <ChevronLeft size={14} />
              </button>
              <button type="button" onClick={() => setView("months")} className={HEADER_BTN}>
                {monthLabel(ym)}
              </button>
              <button type="button" onClick={() => shiftMonth(1)} className={NAV} aria-label="Next month">
                <ChevronRight size={14} />
              </button>
            </div>
            <div className="mb-0.5 grid grid-cols-7 gap-0.5">
              {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((d) => (
                <span key={d} className="py-0.5 text-center text-[9px] font-semibold uppercase tracking-wider text-zinc-300">
                  {d}
                </span>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-0.5">
              {Array.from({ length: firstDow }, (_, i) => (
                <span key={"b" + i} />
              ))}
              {days.map((d) => {
                const iso = ym + "-" + String(d).padStart(2, "0");
                const selected = iso === value;
                const isToday = iso === today;
                return (
                  <button
                    key={d}
                    type="button"
                    onClick={() => {
                      onChange(iso);
                      close();
                    }}
                    className={
                      "flex h-8 items-center justify-center rounded-lg text-xs font-medium tabular-nums transition-colors " +
                      (selected
                        ? "bg-zinc-900 text-white shadow-[0_1px_2px_rgba(24,24,27,0.2)]"
                        : isToday
                          ? "bg-[#f4f4f2] text-zinc-900 ring-1 ring-zinc-300"
                          : "text-zinc-600 hover:bg-[#f4f4f2] hover:text-zinc-900")
                    }
                  >
                    {d}
                  </button>
                );
              })}
            </div>
          </>
        ) : view === "months" ? (
          <>
            <YearStepper
              year={cursor.y}
              onShift={(d) => setCursor((v) => ({ ...v, y: v.y + d }))}
              onPickYear={() => setView("years")}
            />
            <MonthGrid
              year={cursor.y}
              selectedYm={value.slice(0, 7)}
              onPick={(m) => {
                setCursor({ y: Number(m.slice(0, 4)), m: Number(m.slice(5, 7)) });
                setView("days");
              }}
            />
          </>
        ) : (
          <YearGrid
            year={cursor.y}
            onShift={(d) => setCursor((v) => ({ ...v, y: v.y + d }))}
            onPick={(y) => {
              setCursor((v) => ({ ...v, y }));
              setView("months");
            }}
          />
        )}
        <button
          type="button"
          onClick={() => {
            onChange(today);
            close();
          }}
          className={
            "mt-1 w-full border-t border-[#efefec] px-2 pb-1 pt-2 text-xs font-medium transition-colors " +
            (value === today ? "text-zinc-300" : "text-zinc-500 hover:text-zinc-900")
          }
        >
          Today
        </button>
      </Popover>
    </>
  );
}

/**
 * Ledger calendar: pick a specific day, or jump to any month/year with the
 * month + year views. "Whole month" clears back to the month filter.
 */
export function CalendarPicker({
  value,
  label,
  isMonth = false,
  onChange,
  onWholeMonth,
  className = "",
}: {
  value: string;
  label: string;
  /** true when the current filter is the whole month (no single day chosen). */
  isMonth?: boolean;
  onChange: (iso: string) => void;
  onWholeMonth: () => void;
  className?: string;
}) {
  const today = todayISO();
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement | null>(null);
  const [view, setView] = useState<"days" | "months" | "years">("days");
  const [cursor, setCursor] = useState({ y: Number(value.slice(0, 4)), m: Number(value.slice(5, 7)) });

  useEffect(() => setCursor({ y: Number(value.slice(0, 4)), m: Number(value.slice(5, 7)) }), [value]);

  const ym = cursor.y + "-" + String(cursor.m).padStart(2, "0");
  const dim = daysInMonth(ym);
  const firstDow = new Date(cursor.y, cursor.m - 1, 1).getDay();
  const days = Array.from({ length: dim }, (_, i) => i + 1);
  const monthOfValue = value.slice(0, 7);
  const showWholeMonth = !isMonth;

  function shiftMonth(delta: number) {
    setCursor((v) => {
      const m = v.m + delta;
      return { y: v.y + Math.floor((m - 1) / 12), m: ((((m - 1) % 12) + 12) % 12) + 1 };
    });
  }

  function close() {
    setOpen(false);
    setView("days");
  }

  return (
    <>
      <button type="button" ref={anchor} onClick={() => setOpen((o) => !o)} className={TRIGGER + " " + className}>
        <span className="truncate">{label}</span>
        <CalendarDays size={14} className="shrink-0 text-zinc-400" />
      </button>
      <Popover anchor={anchor} open={open} onClose={close} width={292}>
        {view === "days" ? (
          <>
            <div className="mb-1 flex items-center justify-between">
              <button type="button" onClick={() => shiftMonth(-1)} className={NAV} aria-label="Previous month">
                <ChevronLeft size={14} />
              </button>
              <button type="button" onClick={() => setView("months")} className={HEADER_BTN}>
                {monthLabel(ym)}
              </button>
              <button type="button" onClick={() => shiftMonth(1)} className={NAV} aria-label="Next month">
                <ChevronRight size={14} />
              </button>
            </div>
            <div className="mb-0.5 grid grid-cols-7 gap-0.5">
              {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((d) => (
                <span key={d} className="py-0.5 text-center text-[9px] font-semibold uppercase tracking-wider text-zinc-300">
                  {d}
                </span>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-0.5">
              {Array.from({ length: firstDow }, (_, i) => (
                <span key={"b" + i} />
              ))}
              {days.map((d) => {
                const iso = ym + "-" + String(d).padStart(2, "0");
                const selected = iso === value;
                const isToday = iso === today;
                return (
                  <button
                    key={d}
                    type="button"
                    onClick={() => {
                      onChange(iso);
                      close();
                    }}
                    className={
                      "flex h-8 items-center justify-center rounded-lg text-xs font-medium tabular-nums transition-colors " +
                      (selected
                        ? "bg-zinc-900 text-white shadow-[0_1px_2px_rgba(24,24,27,0.2)]"
                        : isToday
                          ? "bg-[#f4f4f2] text-zinc-900 ring-1 ring-zinc-300"
                          : "text-zinc-600 hover:bg-[#f4f4f2] hover:text-zinc-900")
                    }
                  >
                    {d}
                  </button>
                );
              })}
            </div>
          </>
        ) : view === "months" ? (
          <>
            <YearStepper
              year={cursor.y}
              onShift={(d) => setCursor((v) => ({ ...v, y: v.y + d }))}
              onPickYear={() => setView("years")}
            />
            <MonthGrid
              year={cursor.y}
              selectedYm={monthOfValue}
              onPick={(m) => {
                setCursor({ y: Number(m.slice(0, 4)), m: Number(m.slice(5, 7)) });
                setView("days");
              }}
            />
          </>
        ) : (
          <YearGrid
            year={cursor.y}
            onShift={(d) => setCursor((v) => ({ ...v, y: v.y + d }))}
            onPick={(y) => {
              setCursor((v) => ({ ...v, y }));
              setView("months");
            }}
          />
        )}
        <div className="mt-1 flex items-center justify-between gap-2 border-t border-[#efefec] px-1 pb-0.5 pt-1.5">
          {showWholeMonth ? (
            <button
              type="button"
              onClick={() => {
                onWholeMonth();
                close();
              }}
              className="rounded-lg px-2 py-1 text-xs font-medium text-zinc-500 transition-colors hover:bg-[#f4f4f2] hover:text-zinc-900"
            >
              Whole month
            </button>
          ) : (
            <span />
          )}
          <button
            type="button"
            onClick={() => {
              onChange(today);
              close();
            }}
            className={
              "rounded-lg px-2 py-1 text-xs font-medium transition-colors " +
              (value === today ? "text-zinc-300" : "text-zinc-500 hover:bg-[#f4f4f2] hover:text-zinc-900")
            }
          >
            Today
          </button>
        </div>
      </Popover>
    </>
  );
}
