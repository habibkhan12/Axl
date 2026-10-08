"use client";
import React, { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, MoreHorizontal, Search, ArrowUpRight, ArrowDownRight, ArrowUpDown } from "lucide-react";

/* ---------------------------------- tokens --------------------------------- */

/** Shared card surface: white, rounded-2xl, warm hairline border, flat (no shadow). */
export const CARD =
  "rounded-2xl border border-[#eae4d9] bg-white";

/* ---------------------------------- Card ----------------------------------- */

export function Card({ children, className = "", id }: { children: React.ReactNode; className?: string; id?: string }) {
  return <div id={id} className={CARD + " " + className}>{children}</div>;
}

/** Card header row: tiny tinted icon chip + title on the left, controls on the right. */
export function CardHeader({ icon, title, right, tone = "zinc" }: { icon?: React.ReactNode; title: string; right?: React.ReactNode; tone?: ChipTone }) {
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
      <div className="flex min-w-0 items-center gap-2.5">
        {icon ? <IconChip tone={tone}>{icon}</IconChip> : null}
        <h3 className="text-sm font-semibold text-zinc-900">{title}</h3>
      </div>
      {right ? <div className="flex max-w-full flex-wrap items-center gap-2">{right}</div> : null}
    </div>
  );
}

/** Micro uppercase section label (used inside cards). */
export function MicroLabel({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={"text-[11px] font-semibold uppercase tracking-wider text-zinc-400 " + className}>{children}</div>;
}

/**
 * Shared summary/stat card — same typography as the dashboard KPI cards so
 * every page's summary band looks identical. Label + icon row, big value, sub.
 */
export function StatCard({
  title,
  icon,
  value,
  sub,
  tone = "plain",
}: {
  title: string;
  icon?: React.ReactNode;
  value: string;
  sub?: string;
  tone?: "plain" | "ok" | "warn" | "bad";
}) {
  const valueTone =
    tone === "bad" ? "text-red-600" : tone === "warn" ? "text-amber-600" : tone === "ok" ? "text-emerald-600" : "text-zinc-900";
  const iconTone = tone === "warn" ? "text-amber-500" : tone === "ok" ? "text-emerald-500" : tone === "bad" ? "text-red-400" : "text-zinc-300";
  return (
    <Card className="flex flex-col p-4">
      <div className="flex items-start justify-between gap-2">
        <span className="text-[12px] font-medium text-zinc-500">{title}</span>
        {icon ? <span className={"shrink-0 " + iconTone}>{icon}</span> : null}
      </div>
      <div className={"mt-2 text-[26px] font-bold leading-none tracking-tight tabular-nums " + valueTone}>{value}</div>
      {sub ? <div className="mt-2 truncate text-[11px] text-zinc-400">{sub}</div> : null}
    </Card>
  );
}

/** Soft pill badge with a colored dot. */
export function Pill({ tone = "zinc", children, className = "" }: { tone?: "emerald" | "red" | "amber" | "zinc" | "blue"; children: React.ReactNode; className?: string }) {
  const tones: Record<string, string> = {
    emerald: "bg-emerald-50 text-emerald-700",
    red: "bg-red-50 text-red-600",
    amber: "bg-amber-50 text-amber-700",
    blue: "bg-blue-50 text-blue-700",
    zinc: "bg-zinc-100 text-zinc-600",
  };
  return (
    <span className={"inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium " + tones[tone] + " " + className}>
      {children}
    </span>
  );
}

/** Segmented pill control (rounded-full track, dark active pill). */
export function Segmented<T extends string>({ value, onChange, options, size = "md" }: {
  value: T;
  onChange: (v: T) => void;
  options: [T, string][];
  size?: "sm" | "md";
}) {
  const pad = size === "sm" ? "px-3 py-1 text-xs" : "px-3.5 py-1.5 text-xs";
  return (
    <div className="inline-flex items-center gap-0.5 rounded-full border border-[#e9e9e6] bg-[#f4f4f2] p-1">
      {options.map(([opt, label]) => (
        <button
          key={opt}
          type="button"
          onClick={() => onChange(opt)}
          className={
            pad + " rounded-full font-medium transition-all " +
            (value === opt
              ? "bg-zinc-900 text-white shadow-[0_1px_2px_rgba(24,24,27,0.2)]"
              : "text-zinc-500 hover:text-zinc-900")
          }
        >
          {label}
        </button>
      ))}
    </div>
  );
}

/* --------------------------------- Button ---------------------------------- */

export function Button({
  children,
  onClick,
  variant = "default",
  type = "button",
  disabled = false,
  className = "",
}: {
  children: React.ReactNode;
  onClick?: () => void;
  variant?: "default" | "primary" | "danger" | "ghost";
  type?: "button" | "submit";
  disabled?: boolean;
  className?: string;
}) {
  const base = "inline-flex items-center justify-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-medium transition-all disabled:opacity-45 disabled:cursor-not-allowed";
  const styles: Record<string, string> = {
    default: "border border-[#e5e5e2] bg-white text-zinc-700 shadow-[0_1px_2px_rgba(24,24,27,0.05)] hover:bg-zinc-50 hover:text-zinc-900",
    primary: "bg-zinc-900 text-white shadow-[0_1px_2px_rgba(24,24,27,0.2)] hover:bg-zinc-700",
    danger: "border border-red-200 bg-white text-red-600 hover:bg-red-50",
    ghost: "text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900",
  };
  return (
    <button type={type} onClick={onClick} disabled={disabled} className={base + " " + styles[variant] + " " + className}>
      {children}
    </button>
  );
}

/* ---------------------------------- Inputs --------------------------------- */

export function Input({ innerRef, ...props }: React.InputHTMLAttributes<HTMLInputElement> & { innerRef?: React.Ref<HTMLInputElement> }) {
  const { className = "", ...rest } = props;
  return (
    <input
      ref={innerRef}
      {...rest}
      className={
        "w-full rounded-lg border border-[#e5e5e2] bg-white px-3 py-2 text-sm text-zinc-800 placeholder:text-zinc-300 outline-none transition-shadow focus:border-zinc-400 focus:ring-4 focus:ring-zinc-900/5 " +
        className
      }
    />
  );
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  const { className = "", children, ...rest } = props;
  return (
    <select
      {...rest}
      className={
        "w-full appearance-none rounded-lg border border-[#e5e5e2] bg-white px-3 py-2 text-sm text-zinc-800 outline-none transition-shadow focus:border-zinc-400 focus:ring-4 focus:ring-zinc-900/5 " +
        className
      }
    >
      {children}
    </select>
  );
}

/** Kravio select dropdown — replaces the native <select> in forms and filters. */
export function SelectMenu({ value, onChange, options, placeholder = "—", align = "left", className = "" }: {
  value: string;
  onChange: (v: string) => void;
  options: [string, string][];
  placeholder?: string;
  align?: "left" | "right";
  className?: string;
}) {
  const selected = options.find(([v]) => v === value);
  return (
    <Dropdown
      align={align}
      widthClass="w-56"
      trigger={() => (
        <span
          className={
            "flex w-full items-center justify-between gap-2 rounded-lg border border-[#e5e5e2] bg-white px-3 py-2 text-sm shadow-[0_1px_2px_rgba(24,24,27,0.05)] transition-colors hover:border-zinc-300 " +
            className
          }
        >
          <span className={"min-w-0 truncate " + (selected ? "text-zinc-800" : "text-zinc-400")}>{selected ? selected[1] : placeholder}</span>
          <ChevronDown size={14} className="shrink-0 text-zinc-400" />
        </span>
      )}
    >
      {(close) => (
        <div className="max-h-64 overflow-y-auto">
          {options.map(([v, label]) => (
            <MenuItem
              key={v}
              onClick={() => {
                onChange(v);
                close();
              }}
            >
              <span className="flex w-full items-center justify-between gap-2">
                <span className="truncate">{label}</span>
                {value === v ? <Check size={13} className="shrink-0 text-zinc-900" /> : null}
              </span>
            </MenuItem>
          ))}
        </div>
      )}
    </Dropdown>
  );
}

export function Label({ children }: { children: React.ReactNode }) {
  return <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-zinc-400">{children}</label>;
}

/* ---------------------------------- Modal ---------------------------------- */

export function Modal({ open, onClose, title, children, wide = false }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-zinc-900/25 p-3 pt-[6vh] backdrop-blur-[2px] sm:p-4 sm:pt-[8vh]" onMouseDown={onClose}>
      <div
        className={"modal-shell w-full rounded-2xl border border-[#e9e9e6] bg-white shadow-[0_24px_60px_-12px_rgba(24,24,27,0.25)] " + (wide ? "max-w-3xl" : "max-w-lg")}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between rounded-t-2xl border-b border-[#efefec] bg-white px-4 py-3 sm:px-5 sm:py-3.5">
          <h2 className="text-sm font-semibold text-zinc-900">{title}</h2>
          <button onClick={onClose} className="rounded-lg p-1.5 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700" aria-label="Close">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </div>
        <div className="px-4 py-4 sm:px-5">{children}</div>
      </div>
    </div>
  );
}

/**
 * SlideOver — the app-wide right-side detail panel (Fleet, Dues, Transactions).
 * Dimmed backdrop + 520px sheet sliding in from the right; header with title +
 * close, scrollable body, optional sticky footer for actions. Replaces pop-ups
 * for details/editing across the platform.
 */
export function SlideOver({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!open) {
      setShown(false);
      return;
    }
    // setTimeout (not rAF) so it also fires in uncomposited/hidden webviews.
    const t = setTimeout(() => setShown(true), 30);
    return () => clearTimeout(t);
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[70]">
      <div
        onMouseDown={onClose}
        className={"absolute inset-0 bg-zinc-900/25 transition-opacity duration-200 " + (shown ? "opacity-100" : "opacity-0")}
      />
      <aside
        className="absolute right-0 top-0 flex h-full w-full max-w-[520px] flex-col border-l border-[#e7e0d4] bg-white shadow-[-12px_0_40px_-12px_rgba(24,24,27,0.18)] transition-transform duration-200 ease-out"
        style={{ transform: shown ? "translateX(0)" : "translateX(100%)" }}
        role="dialog"
      >
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-[#f0ece4] bg-[#faf8f4] px-5 py-3">
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-zinc-900">{title}</div>
            {subtitle ? <div className="mt-0.5 truncate text-[11px] text-zinc-400">{subtitle}</div> : null}
          </div>
          <button
            onClick={onClose}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-zinc-400 transition-colors hover:bg-[#f0ece4] hover:text-zinc-700"
            aria-label="Close panel"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto app-scroll">{children}</div>
        {footer ? (
          <div className="flex shrink-0 items-center justify-end gap-2 border-t border-[#f0ece4] bg-white px-5 py-3">{footer}</div>
        ) : null}
      </aside>
    </div>
  );
}

export function ConfirmDelete({ open, onClose, onConfirm, label }: { open: boolean; onClose: () => void; onConfirm: () => void; label: string }) {
  return (
    <Modal open={open} onClose={onClose} title="Delete entry">
      <p className="mb-4 text-sm text-zinc-600">
        Delete <span className="font-medium text-zinc-900">{label}</span>? This cannot be undone.
      </p>
      <div className="flex justify-end gap-2">
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="danger" onClick={() => { onConfirm(); onClose(); }}>Delete</Button>
      </div>
    </Modal>
  );
}

export function useKeyboardShortcut(key: string, fn: () => void) {
  const saved = useRef(fn);
  useEffect(() => {
    saved.current = fn;
  }, [fn]);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const inField = target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT");
      if (e.key === key && !e.metaKey && !e.ctrlKey && !e.altKey && !inField) {
        e.preventDefault();
        saved.current();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [key]);
}

export function Toast({ message }: { message: string | null }) {
  const [shown, setShown] = useState<string | null>(null);
  useEffect(() => {
    if (!message) return;
    setShown(message);
    const t = setTimeout(() => setShown(null), 2500);
    return () => clearTimeout(t);
  }, [message]);
  if (!shown) return null;
  return (
    <div className="fixed bottom-5 left-1/2 z-[60] -translate-x-1/2 rounded-full bg-zinc-900 px-4 py-2 text-sm font-medium text-white shadow-[0_8px_30px_rgba(24,24,27,0.3)]">
      {shown}
    </div>
  );
}

/* ------------------------- Kravio-style primitives ------------------------ */

const CHIP_TONES = {
  zinc: "border-[#e9e9e6] bg-[#f7f7f5] text-zinc-500",
  emerald: "border-emerald-100 bg-emerald-50 text-emerald-600",
  red: "border-red-100 bg-red-50 text-red-500",
  blue: "border-blue-100 bg-blue-50 text-blue-600",
  amber: "border-amber-100 bg-amber-50 text-amber-600",
  violet: "border-violet-100 bg-violet-50 text-violet-600",
} as const;

export type ChipTone = keyof typeof CHIP_TONES;

/** Small rounded icon chip with a soft tinted background. */
export function IconChip({ tone = "zinc", children, className = "" }: { tone?: ChipTone; children: React.ReactNode; className?: string }) {
  return <span className={"flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border " + CHIP_TONES[tone] + " " + className}>{children}</span>;
}

/** Colored delta: ▲ +21% vs last month (green up / red down; invert for expense). */
export function DeltaPill({ value, suffix = "", invert = false, className = "" }: { value: number | null; suffix?: string; invert?: boolean; className?: string }) {
  if (value === null || !Number.isFinite(value)) {
    return (
      <span className={"inline-flex items-center gap-1 text-[11px] font-medium text-zinc-400 " + className}>
        —{suffix ? <span className="font-normal">{suffix}</span> : null}
      </span>
    );
  }
  const up = value >= 0;
  const good = invert ? !up : up;
  const color = good ? "text-emerald-600" : "text-red-500";
  const Arrow = up ? ArrowUpRight : ArrowDownRight;
  const num = Math.abs(value) >= 9.95 ? String(Math.round(Math.abs(value))) : Math.abs(value).toFixed(1);
  return (
    <span className={"inline-flex min-w-0 max-w-full items-center gap-0.5 whitespace-nowrap text-[11px] font-semibold " + color + " " + className}>
      <Arrow size={11} strokeWidth={2.4} className="shrink-0" />
      <span className="shrink-0">{up ? "+" : "−"}{num}%</span>
      {suffix ? <span className="ml-0.5 min-w-0 truncate font-normal text-zinc-400">{suffix}</span> : null}
    </span>
  );
}

const AVATAR_TONES = [
  "bg-emerald-100 text-emerald-700",
  "bg-blue-100 text-blue-700",
  "bg-amber-100 text-amber-700",
  "bg-violet-100 text-violet-700",
  "bg-rose-100 text-rose-700",
  "bg-cyan-100 text-cyan-700",
];

/** Initials avatar with a stable tinted background per name. */
export function Avatar({ name, size = "md", src, className = "" }: { name: string; size?: "sm" | "md" | "lg" | "xl"; src?: string | null; className?: string }) {
  const sizes = { sm: "h-6 w-6 text-[8px]", md: "h-7 w-7 text-[9px]", lg: "h-9 w-9 text-[11px]", xl: "h-16 w-16 text-lg" };
  if (src) return <img src={src} alt={name} className={"shrink-0 rounded-full object-cover " + sizes[size] + " " + className} />;
  const initials = (name || "?").trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
  let h = 0;
  for (const ch of name || "?") h = (h * 31 + ch.charCodeAt(0)) % 997;
  return <span className={"flex shrink-0 select-none items-center justify-center rounded-full font-bold " + sizes[size] + " " + AVATAR_TONES[h % AVATAR_TONES.length] + " " + className}>{initials}</span>;
}

/** iOS-style toggle switch for settings rows. */
export function Switch({ checked, onChange, disabled = false, label }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; label?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={
        "relative h-5 w-9 shrink-0 rounded-full transition-colors disabled:opacity-40 " +
        (checked ? "bg-zinc-900" : "bg-zinc-200 hover:bg-zinc-300")
      }
    >
      <span
        className={
          "absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-all " +
          (checked ? "left-[18px]" : "left-0.5")
        }
      />
    </button>
  );
}

/** Generic dropdown with click-outside + Escape handling. */
export function Dropdown({ trigger, children, align = "right", widthClass = "w-56" }: {
  trigger: (open: boolean) => React.ReactNode;
  children: (close: () => void) => React.ReactNode;
  align?: "left" | "right";
  widthClass?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return (
    <div className="relative" ref={ref}>
      <button type="button" onClick={() => setOpen((o) => !o)}>{trigger(open)}</button>
      {open ? (
        <div
          className={
            "absolute z-50 mt-1.5 max-w-[calc(100vw-1.5rem)] rounded-xl border border-[#e9e9e6] bg-white p-1 shadow-[0_2px_8px_rgba(24,24,27,0.08),0_12px_32px_-8px_rgba(24,24,27,0.18)] " +
            widthClass + " " + (align === "right" ? "right-0" : "left-0")
          }
        >
          {children(() => setOpen(false))}
        </div>
      ) : null}
    </div>
  );
}

export function MenuItem({ icon, children, danger = false, onClick }: { icon?: React.ReactNode; children: React.ReactNode; danger?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs font-medium transition-colors " +
        (danger ? "text-red-600 hover:bg-red-50" : "text-zinc-600 hover:bg-[#f4f4f2] hover:text-zinc-900")
      }
    >
      {icon}
      {children}
    </button>
  );
}

/** Round ⋮ row menu. */
export function KebabMenu({ items }: { items: { label: string; icon?: React.ReactNode; danger?: boolean; onSelect: () => void }[] }) {
  return (
    <Dropdown
      widthClass="w-44"
      trigger={() => (
        <span className="flex h-7 w-7 items-center justify-center rounded-lg text-zinc-400 transition-colors hover:bg-[#f4f4f2] hover:text-zinc-700">
          <MoreHorizontal size={15} />
        </span>
      )}
    >
      {(close) => (
        <>
          {items.map((it) => (
            <MenuItem
              key={it.label}
              icon={it.icon}
              danger={it.danger}
              onClick={() => {
                close();
                it.onSelect();
              }}
            >
              {it.label}
            </MenuItem>
          ))}
        </>
      )}
    </Dropdown>
  );
}

/** Text input with a search glyph inside. */
export function SearchInput({ value, onChange, placeholder = "Search…", className = "", onEnter }: { value: string; onChange: (v: string) => void; placeholder?: string; className?: string; onEnter?: () => void }) {
  return (
    <div className={"relative " + className}>
      <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && onEnter) onEnter();
        }}
        placeholder={placeholder}
        className="w-full rounded-lg border border-[#e5e5e2] bg-white py-2 pl-9 pr-3 text-sm text-zinc-800 outline-none transition-shadow placeholder:text-zinc-300 focus:border-zinc-400 focus:ring-4 focus:ring-zinc-900/5"
      />
    </div>
  );
}

/** Tiny ⇅ sort glyph for table headers. */
export function SortGlyph({ active = false }: { active?: boolean }) {
  return <ArrowUpDown size={11} strokeWidth={2} className={"ml-1 inline-block align-[-1px] " + (active ? "text-zinc-600" : "text-zinc-300")} />;
}

export function EmptyState({ icon, title, hint }: { icon?: React.ReactNode; title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
      {icon ? (
        <div className="mb-1 flex h-11 w-11 items-center justify-center rounded-xl border border-[#e9e9e6] bg-[#f7f7f5] text-zinc-400">{icon}</div>
      ) : null}
      <p className="text-sm font-medium text-zinc-600">{title}</p>
      {hint ? <p className="max-w-sm text-xs text-zinc-400">{hint}</p> : null}
    </div>
  );
}
