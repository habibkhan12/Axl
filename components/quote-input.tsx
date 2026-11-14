"use client";
import { useMemo, useState } from "react";
import type { Quote } from "@/lib/types";
import { Input } from "@/components/ui";
import { isQuoteOpen } from "@/lib/repo";

export const QUOTE_STATUS_LABEL: Record<Quote["status"], string> = {
  review: "Under review",
  approved: "Approved",
  completed: "Completed",
  rejected: "Rejected",
};

/**
 * Quotation-number field with autofill. Only approved and completed quotes are
 * offered: an under-review or rejected quote cannot take income or expenses.
 */
export function QuoteInput({
  value,
  onChange,
  quotes,
  clientName,
  placeholder = "Quotation no. — or leave blank",
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  quotes: Quote[];
  clientName?: (clientId: string | null | undefined) => string;
  placeholder?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);

  const query = value.trim().toLowerCase();
  const sorted = useMemo(() => [...quotes].sort((a, b) => (a.quote_no < b.quote_no ? 1 : -1)), [quotes]);
  const matching = useMemo(() => {
    if (!query) return sorted.slice(0, 6);
    return sorted
      .filter((q) => q.quote_no.toLowerCase().includes(query) || (clientName?.(q.client_id) ?? "").toLowerCase().includes(query))
      .slice(0, 6);
  }, [sorted, query, clientName]);

  const exact = query ? sorted.find((q) => q.quote_no.trim().toLowerCase() === query) : undefined;
  const blocked = exact && !isQuoteOpen(exact) ? exact : undefined;

  function pick(q: Quote) {
    if (!isQuoteOpen(q)) return;
    onChange(q.quote_no);
    setOpen(false);
  }

  return (
    <div className="relative">
      <Input
        value={value}
        disabled={disabled}
        placeholder={placeholder}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onChange={(e) => {
          onChange(e.target.value);
          setHighlight(0);
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" && open) {
            e.preventDefault();
            setHighlight((h) => Math.min(h + 1, matching.length - 1));
          } else if (e.key === "ArrowUp" && open) {
            e.preventDefault();
            setHighlight((h) => Math.max(h - 1, 0));
          } else if (e.key === "Enter" && open && matching.length > 0) {
            e.preventDefault();
            e.stopPropagation();
            pick(matching[highlight] ?? matching[0]);
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
      />

      {open && matching.length > 0 ? (
        <ul className="absolute z-50 mt-1 w-full overflow-hidden rounded-lg border border-[#e9e9e6] bg-white py-0.5 shadow-[0_2px_8px_rgba(24,24,27,0.08),0_12px_32px_-8px_rgba(24,24,27,0.18)]">
          {matching.map((q, i) => {
            const usable = isQuoteOpen(q);
            return (
              <li key={q.id}>
                <button
                  type="button"
                  disabled={!usable}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    pick(q);
                  }}
                  onMouseEnter={() => setHighlight(i)}
                  className={
                    "flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs transition-colors " +
                    (usable ? (i === highlight ? "bg-[#f4f4f2] text-zinc-900" : "text-zinc-600") : "cursor-not-allowed text-zinc-300")
                  }
                >
                  <span className="shrink-0 font-medium">{q.quote_no}</span>
                  <span className="min-w-0 flex-1 truncate">{clientName?.(q.client_id) ?? ""}</span>
                  <span className="shrink-0 text-[9px] uppercase tracking-wide">{QUOTE_STATUS_LABEL[q.status]}</span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}

      {blocked ? (
        <p className="mt-1 text-[10px] font-medium text-amber-600">
          {blocked.quote_no} is {QUOTE_STATUS_LABEL[blocked.status].toLowerCase()} — approve it before adding entries.
        </p>
      ) : query && !exact ? (
        <p className="mt-1 text-[10px] text-amber-600">No quotation matches “{value.trim()}”.</p>
      ) : null}
    </div>
  );
}
