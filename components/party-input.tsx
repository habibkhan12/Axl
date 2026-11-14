"use client";
import { useMemo, useState } from "react";
import type { Party } from "@/lib/types";
import { Input } from "@/components/ui";

/**
 * Free-text supplier/client field with autofill. Typing filters the existing
 * records; picking one reuses it, typing a new name creates the record on save.
 */
export function PartyInput({
  value,
  onChange,
  parties,
  kindLabel,
  placeholder,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  parties: Party[];
  kindLabel: string;
  placeholder?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);

  const query = value.trim().toLowerCase();
  const matches = useMemo(() => {
    const list = parties.filter((p) => !p.archived).sort((a, b) => a.name.localeCompare(b.name));
    if (!query) return list.slice(0, 6);
    return list.filter((p) => p.name.toLowerCase().includes(query)).slice(0, 6);
  }, [parties, query]);

  const exact = !!query && parties.some((p) => p.name.trim().toLowerCase() === query);

  function pick(name: string) {
    onChange(name);
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
            setHighlight((h) => Math.min(h + 1, matches.length - 1));
          } else if (e.key === "ArrowUp" && open) {
            e.preventDefault();
            setHighlight((h) => Math.max(h - 1, 0));
          } else if (e.key === "Enter" && open && matches.length > 0) {
            // Don't submit the form — pick the highlighted suggestion.
            e.preventDefault();
            e.stopPropagation();
            pick(matches[highlight]?.name ?? matches[0].name);
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
      />
      {open && matches.length > 0 ? (
        <ul className="absolute z-50 mt-1 w-full overflow-hidden rounded-lg border border-[#e9e9e6] bg-white py-0.5 shadow-[0_2px_8px_rgba(24,24,27,0.08),0_12px_32px_-8px_rgba(24,24,27,0.18)]">
          {matches.map((p, i) => (
            <li key={p.id}>
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(p.name);
                }}
                onMouseEnter={() => setHighlight(i)}
                className={
                  "block w-full truncate px-2.5 py-1.5 text-left text-xs transition-colors " +
                  (i === highlight ? "bg-[#f4f4f2] text-zinc-900" : "text-zinc-600")
                }
              >
                {p.name}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {query && !exact ? (
        <p className="mt-1 text-[10px] text-emerald-600">New {kindLabel} — added when you save</p>
      ) : null}
    </div>
  );
}
