"use client";
import { useEffect, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { Dropdown } from "@/components/ui";
import { daysInMonth, fmtDateShort, monthLabel, MONTHS_SHORT, todayISO } from "@/lib/format";

const TRIGGER =
  "flex w-full items-center justify-between gap-2 rounded-lg border border-[#e5e5e2] bg-white px-3 py-2 text-sm text-zinc-800 shadow-[0_1px_2px_rgba(24,24,27,0.05)] transition-colors hover:border-zinc-300";

function Stepper({ label, onPrev, onNext }: { label: string; onPrev: () => void; onNext: () => void }) {
  return (
    <div className="mb-1 flex items-center justify-between">
      <button type="button" onClick={onPrev} className="flex h-7 w-7 items-center justify-center rounded-lg text-zinc-400 transition-colors hover:bg-[#f4f4f2] hover:text-zinc-700" aria-label="Previous">
        <ChevronLeft size={14} />
      </button>
      <span className="text-xs font-semibold text-zinc-700">{label}</span>
      <button type="button" onClick={onNext} className="flex h-7 w-7 items-center justify-center rounded-lg text-zinc-400 transition-colors hover:bg-[#f4f4f2] hover:text-zinc-700" aria-label="Next">
        <ChevronRight size={14} />
      </button>
    </div>
  );
}

/** Kravio month picker — replaces the native <input type="month"> picker. */
export function MonthPicker({ value, onChange, className = "" }: { value: string; onChange: (ym: string) => void; className?: string }) {
  const today = todayISO();
  const [browseYear, setBrowseYear] = useState(Number(value.slice(0, 4)));
  useEffect(() => setBrowseYear(Number(value.slice(0, 4))), [value]);

  return (
    <Dropdown
      widthClass="w-64"
      trigger={() => (
        <span className={TRIGGER + " " + className}>
          <span className="truncate">{monthLabel(value)}</span>
          <CalendarDays size={14} className="shrink-0 text-zinc-400" />
        </span>
      )}
    >
      {(close) => (
        <div className="p-1">
          <Stepper label={String(browseYear)} onPrev={() => setBrowseYear((y) => y - 1)} onNext={() => setBrowseYear((y) => y + 1)} />
          <div className="grid grid-cols-3 gap-1">
            {MONTHS_SHORT.map((m, i) => {
              const ym = browseYear + "-" + String(i + 1).padStart(2, "0");
              const active = ym === value;
              return (
                <button
                  key={m}
                  type="button"
                  onClick={() => {
                    onChange(ym);
                    close();
                  }}
                  className={
                    "rounded-lg px-2 py-1.5 text-xs font-medium transition-colors " +
                    (active ? "bg-zinc-900 text-white shadow-[0_1px_2px_rgba(24,24,27,0.2)]" : "text-zinc-600 hover:bg-[#f4f4f2] hover:text-zinc-900")
                  }
                >
                  {m}
                </button>
              );
            })}
          </div>
          <button
            type="button"
            onClick={() => {
              onChange(today.slice(0, 7));
              close();
            }}
            className={"mt-1 w-full border-t border-[#efefec] px-2 pb-1 pt-2 text-xs font-medium transition-colors " + (value === today.slice(0, 7) ? "text-zinc-300" : "text-zinc-500 hover:text-zinc-900")}
          >
            This month
          </button>
        </div>
      )}
    </Dropdown>
  );
}

/** Kravio date picker — replaces the native <input type="date"> picker. */
export function DatePicker({ value, onChange, className = "" }: { value: string; onChange: (iso: string) => void; className?: string }) {
  const today = todayISO();
  const [view, setView] = useState({ y: Number(value.slice(0, 4)), m: Number(value.slice(5, 7)) });
  useEffect(() => setView({ y: Number(value.slice(0, 4)), m: Number(value.slice(5, 7)) }), [value]);

  const ym = view.y + "-" + String(view.m).padStart(2, "0");
  const dim = daysInMonth(ym);
  const firstDow = new Date(view.y, view.m - 1, 1).getDay();
  const days = Array.from({ length: dim }, (_, i) => i + 1);
  const ymToday = today.slice(0, 7);

  function shift(delta: number) {
    setView((v) => {
      const m = v.m + delta;
      return { y: v.y + Math.floor((m - 1) / 12), m: (((m - 1) % 12) + 12) % 12 + 1 };
    });
  }

  return (
    <Dropdown
      widthClass="w-64"
      trigger={() => (
        <span className={TRIGGER + " " + className}>
          <span className="truncate">{fmtDateShort(value) + " " + value.slice(0, 4)}</span>
          <CalendarDays size={14} className="shrink-0 text-zinc-400" />
        </span>
      )}
    >
      {(close) => (
        <div className="p-1">
          <Stepper label={monthLabel(ym)} onPrev={() => shift(-1)} onNext={() => shift(1)} />
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
                    "flex h-7 items-center justify-center rounded-lg text-xs font-medium tabular-nums transition-colors " +
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
          <button
            type="button"
            onClick={() => {
              onChange(today);
              close();
            }}
            className={"mt-1 w-full border-t border-[#efefec] px-2 pb-1 pt-2 text-xs font-medium transition-colors " + (ym === ymToday && value === today ? "text-zinc-300" : "text-zinc-500 hover:text-zinc-900")}
          >
            Today
          </button>
        </div>
      )}
    </Dropdown>
  );
}
