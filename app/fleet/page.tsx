"use client";
/**
 * Fleet — page-level scroll (same pattern as Dues & fines).
 * Stat band = shared StatCard components (same as dashboard KPIs). Below it,
 * the car register as one full-width Card: tinted header strip + responsive
 * grid rows that flow with the page (no inner scroller, no nested box).
 * Picking a car opens the dossier as a right-side slide-over drawer.
 */
import React, { useEffect, useMemo, useState } from "react";
import { ExternalLink, Fuel, Plus, Receipt, Wallet } from "lucide-react";
import { useDb, useDbContext } from "@/lib/local-db";
import { vehicleStats, monthBounds } from "@/lib/analytics";
import { fmtAED, fmtDate, fmtDateShort, monthLabel, todayISO } from "@/lib/format";
import { upsertVehicle, updateTransaction, deleteTransaction } from "@/lib/repo";
import type { Database, Transaction, Vehicle } from "@/lib/types";
import { Button, Card, ConfirmDelete, EmptyState, Input, Label, MicroLabel, Modal, Pill, Select, SlideOver, StatCard, Toast } from "@/components/ui";
import { PageHeader } from "@/components/app-shell";
import { MonthPicker } from "@/components/date-picker";

const DUBAI_POLICE_URL = "https://www.dubaipolice.gov.ae/app/services/fine-payment/search";
const SALIK_URL = "https://www.salik.ae/en/support/salik-services-catalog/recharge-a-salik-account";

type PlateChipProps = { plate: string; size?: "sm" | "lg" };

/** Clean single-line plate chip: bold number, red emirate code — like a UAE plate. */
function PlateChip({ plate, size = "sm" }: PlateChipProps) {
  const parts = plate.trim().split(/\s+/);
  const number = parts[0] ?? "—";
  const code = parts.length > 2 ? parts[parts.length - 2] : "";
  const emirateAbbr = (parts[parts.length - 1] ?? "").toUpperCase();
  const big = size === "lg";
  return (
    <span
      className={
        "inline-flex shrink-0 items-center gap-1.5 overflow-hidden rounded-md border border-zinc-300 bg-white " +
        (big ? "h-9 px-3 " : "h-7 px-2 ")
      }
      title={plate}
    >
      <span className={"font-bold tabular-nums tracking-tight text-zinc-900 " + (big ? "text-[15px]" : "text-[12px]")}>
        {number}
        {code ? <span className="ml-1 text-zinc-500">{code}</span> : null}
      </span>
      {emirateAbbr ? (
        <span className={"border-l border-zinc-200 pl-1.5 font-bold uppercase leading-none text-red-500 " + (big ? "text-[10px]" : "text-[9px]")}>
          {emirateAbbr}
        </span>
      ) : null}
    </span>
  );
}

/** Expiry readout with status dot: red = expired, amber ≤30d, green otherwise. */
function ExpiryReadout({ label, iso, big = false }: { label: string; iso: string | null | undefined; big?: boolean }) {
  if (!iso) {
    return (
      <div>
        <div className={"font-medium text-zinc-300 " + (big ? "text-[13px]" : "text-[11px]")}>{label} —</div>
        <div className="text-[10px] text-zinc-300">Not recorded</div>
      </div>
    );
  }
  const days = Math.round((new Date(iso).getTime() - Date.now()) / 86400000);
  const dot = days < 0 ? "bg-red-500" : days <= 30 ? "bg-amber-500" : "bg-emerald-500";
  const tone = days < 0 ? "text-red-600" : days <= 30 ? "text-amber-600" : "text-zinc-700";
  return (
    <div>
      <div className={"flex items-center gap-1.5 font-semibold " + tone + " " + (big ? "text-[13px]" : "text-[11px]")}>
        <span className={"h-1.5 w-1.5 rounded-full " + dot} />
        {fmtDateShort(iso)}
      </div>
      <div className="text-[10px] text-zinc-400">
        {label} · {days < 0 ? Math.abs(days) + "d overdue" : days <= 30 ? days + "d left" : days + "d"}
      </div>
    </div>
  );
}

export default function FleetPage() {
  const { db, setDb } = useDb();
  const { canWrite, canEdit } = useDbContext();
  const canEditFleet = canWrite && canEdit("/fleet");
  const [ym, setYm] = useState(todayISO().slice(0, 7));
  const { from, to } = monthBounds(ym);
  const stats = useMemo(() => vehicleStats(db, from, to), [db, from, to]);

  const [selected, setSelected] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [newPlate, setNewPlate] = useState("");
  const [deletingVeh, setDeletingVeh] = useState<Vehicle | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [q, setQ] = useState("");

  // Deep link from the command palette: /fleet#car-<id> selects (and opens) the car.
  useEffect(() => {
    const handle = () => {
      const hash = window.location.hash;
      if (!hash.startsWith("#car-")) return;
      const id = decodeURIComponent(hash.slice(5));
      if (db.vehicles.some((x) => x.id === id)) {
        setSelected(id);
        // Clear the hash only once the panel is actually open.
        history.replaceState(null, "", window.location.pathname + window.location.search);
      }
    };
    handle();
    window.addEventListener("hashchange", handle);
    return () => window.removeEventListener("hashchange", handle);
  }, [db.vehicles]);

  function saveVehicle(v: Vehicle) {
    setDb((prev) => (prev ? upsertVehicle(prev, v) : prev));
  }

  const active = useMemo(() => db.vehicles.filter((v) => !v.archived), [db.vehicles]);
  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const base = [...active, ...db.vehicles.filter((v) => v.archived)];
    if (!needle) return base;
    return base.filter((v) => [v.label, v.plate, v.owner_name ?? ""].join(" ").toLowerCase().includes(needle));
  }, [db.vehicles, active, q]);

  // Register rows open the dossier drawer. Esc closes it too.
  useEffect(() => {
    if (!selected) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSelected(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected]);

  const totalSpend = useMemo(() => stats.reduce((s, v) => s + v.total, 0), [stats]);
  const totalLiters = useMemo(() => stats.reduce((s, v) => s + (v.liters ?? 0), 0), [stats]);
  const topSpender = useMemo(() => {
    let top: { vehicle: Vehicle; total: number } | null = null;
    for (const s of stats) {
      if (s.vehicleId === "_none" || s.total <= 0) continue;
      const veh = db.vehicles.find((v) => v.id === s.vehicleId);
      if (veh && (!top || s.total > top.total)) top = { vehicle: veh, total: s.total };
    }
    return top;
  }, [stats, db.vehicles]);
  const alertCount = useMemo(() => {
    const today = todayISO();
    return active.filter((v) => {
      const gone = (v.license_expiry && v.license_expiry < today) || (v.insurance_expiry && v.insurance_expiry < today);
      const soon =
        (v.license_expiry && v.license_expiry >= today && new Date(v.license_expiry).getTime() - Date.now() <= 30 * 86400000) ||
        (v.insurance_expiry && v.insurance_expiry >= today && new Date(v.insurance_expiry).getTime() - Date.now() <= 30 * 86400000);
      return gone || soon;
    }).length;
  }, [active]);

  const statOf = (id: string) => stats.find((s) => s.vehicleId === id);

  return (
    <div>
      <PageHeader
        title="Fleet"
        subtitle={active.length + " cars · " + monthLabel(ym)}
        actions={
          <>
            <MonthPicker value={ym} onChange={setYm} className="w-44" />
            {canEditFleet ? (
              <Button variant="primary" onClick={() => { setNewLabel(""); setNewPlate(""); setAddOpen(true); }}>
                <Plus size={13} /> Add car
              </Button>
            ) : null}
          </>
        }
      />

      {/* ── Summary band — same StatCard components as the dashboard KPIs ── */}
      <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          title="Fuel & vehicle spend"
          icon={<Wallet size={15} />}
          value={fmtAED(totalSpend, { compact: true })}
          sub={stats.length > 0 ? stats.length + " cars with entries" : "No entries yet"}
        />
        <StatCard
          title="Fuel volume"
          icon={<Fuel size={15} />}
          value={totalLiters > 0 ? Math.round(totalLiters).toLocaleString() + " L" : "—"}
          sub={topSpender ? "Top: " + topSpender.vehicle.label + " · " + fmtAED(topSpender.total, { compact: true }) : "—"}
        />
        <StatCard
          title="Docs to renew"
          value={alertCount === 0 ? "All valid" : String(alertCount)}
          sub={alertCount === 0 ? "Licences & insurance current" : "Expired or due within 30 days"}
          tone={alertCount === 0 ? "ok" : "warn"}
        />
        <StatCard title="Active cars" value={String(active.length)} sub={db.vehicles.filter((v) => v.archived).length + " archived"} />
      </div>

      {/* ── The register: one full-width card, rows flow with the page (no inner scroll) ── */}
      {db.vehicles.length === 0 ? (
        <Card className="p-8">
          <EmptyState title="No cars yet" hint={canEditFleet ? "Add your first car to track fuel, expenses, Salik and fines." : "Ask an admin to add cars."} />
          {canEditFleet ? (
            <div className="mt-4 flex justify-center">
              <Button variant="primary" onClick={() => { setNewLabel(""); setNewPlate(""); setAddOpen(true); }}>
                <Plus size={14} /> Add your first car
              </Button>
            </div>
          ) : null}
        </Card>
      ) : (
        <Card className="overflow-hidden">
          {/* Header strip: tinted, like the Dues card header */}
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#eae4d9] bg-[#faf8f4] px-4 py-2.5">
            <MicroLabel>Car register — {list.length}</MicroLabel>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search cars"
              className="w-full rounded-lg border border-[#e5e5e2] bg-white px-2.5 py-1 text-xs text-zinc-700 outline-none placeholder:text-zinc-300 focus:border-zinc-400 sm:w-44"
            />
          </div>

          {list.length === 0 ? (
            <p className="px-4 py-10 text-center text-xs text-zinc-400">No cars match “{q}”.</p>
          ) : (
            <>
              {/* Column captions (md+) */}
              <div className="hidden border-b border-[#eae4d9] px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-300 md:grid md:grid-cols-[130px_minmax(0,1.5fr)_minmax(0,1fr)_120px_80px_110px_20px] md:items-center md:gap-3">
                <span>Plate</span>
                <span>Car</span>
                <span>Owner</span>
                <span className="text-right">{monthLabel(ym).split(" ")[0]} spend</span>
                <span className="text-right">Entries</span>
                <span>Documents</span>
                <span />
              </div>

              <div>
                {list.map((v) => {
                  const stat = statOf(v.id);
                  const total = stat?.total ?? 0;
                  const count = stat?.count ?? 0;
                  const today = todayISO();
                  const licGone = !!v.license_expiry && v.license_expiry < today;
                  const insGone = !!v.insurance_expiry && v.insurance_expiry < today;
                  const licSoon = !!v.license_expiry && v.license_expiry >= today && new Date(v.license_expiry).getTime() - Date.now() <= 30 * 86400000;
                  const insSoon = !!v.insurance_expiry && v.insurance_expiry >= today && new Date(v.insurance_expiry).getTime() - Date.now() <= 30 * 86400000;
                  const docDot = licGone || insGone ? "bg-red-500" : licSoon || insSoon ? "bg-amber-500" : "bg-emerald-500";
                  const docText = licGone || insGone ? "Expired" : licSoon || insSoon ? "Due soon" : "Valid";
                  return (
                    <button
                      key={v.id}
                      onClick={() => setSelected(v.id)}
                      className="group grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 border-b border-[#f0ece4] px-4 py-3 text-left transition-colors last:border-b-0 hover:bg-[#faf8f4] md:grid-cols-[130px_minmax(0,1.5fr)_minmax(0,1fr)_120px_80px_110px_20px]"
                    >
                      {/* Plate */}
                      <span>
                        <PlateChip plate={v.plate} />
                      </span>

                      {/* Car (+ owner on mobile) */}
                      <span className="min-w-0">
                        <span className="flex items-center gap-1.5">
                          <span className="truncate text-[13px] font-semibold text-zinc-900">{v.label}</span>
                          {v.is_company ? <Pill tone="blue">Shared</Pill> : null}
                          {v.archived ? <Pill tone="zinc">Archived</Pill> : null}
                        </span>
                        <span className="block truncate text-[11px] text-zinc-400 md:hidden">{v.owner_name ?? "—"}</span>
                      </span>

                      {/* Owner (md+) */}
                      <span className="hidden truncate text-[12px] text-zinc-500 md:block">{v.owner_name ?? "—"}</span>

                      {/* Month spend */}
                      <span className="text-right">
                        <span className="block text-[13px] font-bold tabular-nums text-zinc-900">{total > 0 ? fmtAED(total, { compact: true }) : "—"}</span>
                        <span className="block text-[10px] text-zinc-400">{count} entr{count === 1 ? "y" : "ies"}</span>
                      </span>

                      {/* Entries all-time (md+) */}
                      <span className="hidden text-right text-[12px] tabular-nums text-zinc-500 md:block">
                        {txnsOf(db, v.id) > 0 ? txnsOf(db, v.id) : "—"}
                      </span>

                      {/* Documents (md+) */}
                      <span className="hidden items-center gap-1.5 md:flex">
                        <span className={"h-1.5 w-1.5 shrink-0 rounded-full " + docDot} />
                        <span className="text-[11px] text-zinc-500">{docText}</span>
                      </span>

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

      {/* ── Slide-over dossier drawer (right), overlaying the register ── */}
      {selected ? (
        <DossierDrawer
          vehicle={db.vehicles.find((v) => v.id === selected) ?? null}
          db={db}
          canEdit={canEditFleet}
          onClose={() => setSelected(null)}
          onSaved={saveVehicle}
          onDelete={() => {
            const v = db.vehicles.find((x) => x.id === selected);
            if (v) setDeletingVeh(v);
          }}
          setDb={setDb}
          setToast={setToast}
        />
      ) : null}

      {/* Delete confirm */}
      <ConfirmDelete
        open={!!deletingVeh}
        onClose={() => setDeletingVeh(null)}
        label={deletingVeh ? deletingVeh.label + " (" + deletingVeh.plate + ")" : ""}
        onConfirm={() => {
          if (!deletingVeh) return;
          const id = deletingVeh.id;
          setDb((prev) => (prev ? { ...prev, vehicles: prev.vehicles.filter((v) => v.id !== id) } : prev));
          if (selected === id) setSelected(null);
          setToast("Car deleted.");
        }}
      />

      {/* Add car modal */}
      <Modal open={addOpen} onClose={() => setAddOpen(false)} title="Add car">
        <div className="space-y-3">
          <div>
            <Label>Name</Label>
            <Input value={newLabel} onChange={(e) => setNewLabel(e.target.value)} placeholder="e.g. Land Cruiser" />
          </div>
          <div>
            <Label>Plate</Label>
            <Input value={newPlate} onChange={(e) => setNewPlate(e.target.value)} placeholder="12345 A AJM" />
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button
              variant="primary"
              disabled={!newLabel.trim()}
              onClick={() => {
                const v = { id: "v_" + Date.now().toString(36), label: newLabel.trim(), plate: newPlate.trim() || "—" };
                saveVehicle(v);
                setSelected(v.id);
              }}
            >
              Add
            </Button>
          </div>
        </div>
      </Modal>

      <Toast message={toast} />
    </div>
  );
}

function txnsOf(db: Database, vehicleId: string) {
  return db.transactions.filter((t) => t.vehicle_id === vehicleId).length;
}

/* ───────────────────── Slide-over dossier drawer ─────────────────────────── */

function DossierDrawer({
  vehicle,
  db,
  canEdit,
  onClose,
  onSaved,
  onDelete,
  setDb,
  setToast,
}: {
  vehicle: Vehicle | null;
  db: Database;
  canEdit: boolean;
  onClose: () => void;
  onSaved: (v: Vehicle) => void;
  onDelete: () => void;
  setDb: React.Dispatch<React.SetStateAction<Database | null>>;
  setToast: (m: string) => void;
}) {
  if (!vehicle) return null;
  return (
    <CarProfile
      vehicle={vehicle}
      db={db}
      canEdit={canEdit}
      onClose={onClose}
      onSaved={onSaved}
      onDelete={onDelete}
      setDb={setDb}
      setToast={setToast}
    />
  );
}

/* ──────────────────────────── Car dossier ───────────────────────────────── */

function CarProfile({
  vehicle,
  db,
  canEdit,
  onClose,
  onSaved,
  onDelete,
  setDb,
  setToast,
}: {
  vehicle: Vehicle;
  db: Database;
  canEdit: boolean;
  onClose: () => void;
  onSaved: (v: Vehicle) => void;
  onDelete: () => void;
  setDb: React.Dispatch<React.SetStateAction<Database | null>>;
  setToast: (m: string) => void;
}) {
  // Inline edit state — the panel edits in place, no separate Manage popup.
  const [label, setLabel] = useState(vehicle.label);
  const [plate, setPlate] = useState(vehicle.plate);
  const [isCompany, setIsCompany] = useState(!!vehicle.is_company);
  const [owner, setOwner] = useState(vehicle.owner_name ?? "");
  const [tc, setTc] = useState(vehicle.tc_number ?? "");
  const [licExpiry, setLicExpiry] = useState(vehicle.license_expiry ?? "");
  const [insExpiry, setInsExpiry] = useState(vehicle.insurance_expiry ?? "");
  const [salikMobile, setSalikMobile] = useState(vehicle.salik_mobile ?? "");
  const [salikAccount, setSalikAccount] = useState(vehicle.salik_account ?? "");
  const [salikTag, setSalikTag] = useState(vehicle.salik_tag ?? "");
  const [salikCode, setSalikCode] = useState(vehicle.salik_code ?? "");

  // Re-seed the form whenever a different car is opened.
  useEffect(() => {
    setLabel(vehicle.label);
    setPlate(vehicle.plate);
    setIsCompany(!!vehicle.is_company);
    setOwner(vehicle.owner_name ?? "");
    setTc(vehicle.tc_number ?? "");
    setLicExpiry(vehicle.license_expiry ?? "");
    setInsExpiry(vehicle.insurance_expiry ?? "");
    setSalikMobile(vehicle.salik_mobile ?? "");
    setSalikAccount(vehicle.salik_account ?? "");
    setSalikTag(vehicle.salik_tag ?? "");
    setSalikCode(vehicle.salik_code ?? "");
  }, [vehicle]);

  function save() {
    onSaved({
      ...vehicle,
      label: label.trim(),
      plate: plate.trim() || "—",
      is_company: isCompany,
      owner_name: owner.trim() || null,
      tc_number: tc.trim() || null,
      license_expiry: licExpiry || null,
      insurance_expiry: insExpiry || null,
      salik_mobile: salikMobile.trim() || null,
      salik_account: salikAccount.trim() || null,
      salik_tag: salikTag.trim() || null,
      salik_code: salikCode.trim() || null,
    });
    setToast("Car updated.");
  }

  const txns = useMemo(
    () => db.transactions.filter((t) => t.vehicle_id === vehicle.id).sort((a, b) => (a.txn_date < b.txn_date ? 1 : -1)),
    [db, vehicle.id]
  );
  const lifetime = txns.reduce((s, t) => s + (t.kind === "expense" ? t.amount : 0), 0);
  const liters = txns.reduce((s, t) => s + (t.fuel_liters ?? 0), 0);

  const [editingTxn, setEditingTxn] = useState<Transaction | null>(null);
  const [deletingTxn, setDeletingTxn] = useState<Transaction | null>(null);

  // Last 6 months spend for the mini bars.
  const bars = useMemo(() => {
    const out: { label: string; total: number }[] = [];
    const now = new Date();
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const { from, to } = monthBounds(ym);
      const total = db.transactions
        .filter((t) => t.vehicle_id === vehicle.id && t.kind === "expense" && t.txn_date >= from && t.txn_date <= to)
        .reduce((s, t) => s + t.amount, 0);
      out.push({ label: monthLabel(ym).split(" ")[0].slice(0, 3), total });
    }
    return out;
  }, [db.transactions, vehicle.id]);
  const maxBar = Math.max(...bars.map((b) => b.total), 0);

  return (
    <SlideOver
      open
      onClose={onClose}
      title={
        <span className="flex items-center gap-2.5">
          <PlateChip plate={vehicle.plate} size="lg" />
          <span className="flex min-w-0 flex-col">
            <span className="truncate text-sm font-semibold text-zinc-900">{vehicle.label}</span>
            <span className="truncate text-[11px] text-zinc-400">{vehicle.is_company ? "Shared company car" : vehicle.owner_name ?? "—"}</span>
          </span>
        </span>
      }
      subtitle={undefined}
      footer={
        <>
          {canEdit ? (
            <Button
              variant="danger"
              className="mr-auto"
              onClick={() => {
                onDelete();
              }}
            >
              Delete car
            </Button>
          ) : null}
          <Button onClick={onClose}>Cancel</Button>
          {canEdit ? (
            <Button variant="primary" disabled={!label.trim()} onClick={save}>
              Save changes
            </Button>
          ) : null}
        </>
      }
    >
      {/* Scrollable dossier body */}
      <div className="p-5">
        {/* Stats — inline, hairline-divided */}
        <div className="grid grid-cols-3 divide-x divide-[#f0ece4]">
          <div className="pr-4">
            <MicroLabel>Lifetime</MicroLabel>
            <div className="mt-1 text-[18px] font-bold tabular-nums text-zinc-900">{fmtAED(lifetime, { compact: true })}</div>
          </div>
          <div className="px-4">
            <MicroLabel>Entries</MicroLabel>
            <div className="mt-1 text-[18px] font-bold tabular-nums text-zinc-900">{txns.length}</div>
          </div>
          <div className="pl-4">
            <MicroLabel>Fuel</MicroLabel>
            <div className="mt-1 text-[18px] font-bold tabular-nums text-zinc-900">{liters ? Math.round(liters).toLocaleString() + " L" : "—"}</div>
          </div>
        </div>

        {/* Documents readout — status dots straight from the saved values */}
        <div className="mt-5 border-t border-[#f1f1ef] pt-4">
          <MicroLabel className="mb-2.5">Documents</MicroLabel>
          <div className="grid grid-cols-2 gap-4">
            <ExpiryReadout label="Licence" iso={licExpiry || null} big />
            <ExpiryReadout label="Insurance" iso={insExpiry || null} big />
          </div>
        </div>

        {/* Inline edit — the whole dossier doubles as the edit form. */}
        <div className="mt-5 border-t border-[#f1f1ef] pt-4">
          <MicroLabel className="mb-2.5">Car details</MicroLabel>
          <div className="space-y-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <Label>Name</Label>
                <Input value={label} onChange={(e) => setLabel(e.target.value)} disabled={!canEdit} />
              </div>
              <div>
                <Label>Plate</Label>
                <Input value={plate} onChange={(e) => setPlate(e.target.value)} disabled={!canEdit} />
              </div>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <Label>Owner</Label>
                <Input value={owner} onChange={(e) => setOwner(e.target.value)} disabled={!canEdit} />
              </div>
              <div>
                <Label>TC number (Dubai Police)</Label>
                <Input value={tc} onChange={(e) => setTc(e.target.value)} disabled={!canEdit} />
              </div>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <Label>License expiry</Label>
                <Input type="date" value={licExpiry} onChange={(e) => setLicExpiry(e.target.value)} disabled={!canEdit} />
              </div>
              <div>
                <Label>Insurance expiry</Label>
                <Input type="date" value={insExpiry} onChange={(e) => setInsExpiry(e.target.value)} disabled={!canEdit} />
              </div>
            </div>
            <div className="rounded-xl border border-[#e9e9e6] bg-[#fbfbfa] p-3">
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-400">Salik registration — powers automated balance checks on the Dues page</div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <Label>Registered mobile</Label>
                  <Input value={salikMobile} onChange={(e) => setSalikMobile(e.target.value)} placeholder="50 123 4567" disabled={!canEdit} />
                </div>
                <div>
                  <Label>Salik account no.</Label>
                  <Input value={salikAccount} onChange={(e) => setSalikAccount(e.target.value)} disabled={!canEdit} />
                </div>
                <div>
                  <Label>Tag number</Label>
                  <Input value={salikTag} onChange={(e) => setSalikTag(e.target.value)} disabled={!canEdit} />
                </div>
                <div>
                  <Label>Code</Label>
                  <Input value={salikCode} onChange={(e) => setSalikCode(e.target.value)} disabled={!canEdit} />
                </div>
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm text-zinc-600">
              <input type="checkbox" checked={isCompany} onChange={(e) => setIsCompany(e.target.checked)} disabled={!canEdit} className="rounded" />
              Shared company vehicle (not tied to one driver)
            </label>
          </div>
        </div>

        {/* Spend trend — only when there is something to show */}
        <div className="mt-5 border-t border-[#f1f1ef] pt-4">
          {maxBar > 0 ? (
            <>
              <MicroLabel className="mb-2">Spend · last 6 months</MicroLabel>
              <div className="flex h-14 items-end gap-1.5">
                {bars.map((b) => (
                  <div key={b.label} className="group flex min-w-0 flex-1 flex-col items-center gap-1">
                    <div className="flex w-full flex-1 items-end">
                      <div
                        className="w-full rounded-t-[4px] bg-[#e5e5e9] transition-colors group-hover:bg-zinc-900"
                        style={{ height: Math.max(4, Math.round((b.total / maxBar) * 100)) + "%" }}
                        title={b.label + " · " + fmtAED(b.total)}
                      />
                    </div>
                    <span className="text-[9px] text-zinc-400">{b.label}</span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <p className="text-[11px] text-zinc-400">No vehicle spend in the last 6 months.</p>
          )}
        </div>

        {/* Portal actions */}
        <div className="mt-5 flex flex-wrap gap-2 border-t border-[#f1f1ef] pt-4">
          <a href={DUBAI_POLICE_URL} target="_blank" rel="noreferrer" className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-zinc-900 px-3 text-[12px] font-medium text-white hover:bg-zinc-700">
            Check fines {vehicle.tc_number ? "· TC " + vehicle.tc_number : ""} <ExternalLink size={11} />
          </a>
          <a href={SALIK_URL} target="_blank" rel="noreferrer" className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[#e5e5e2] bg-white px-3 text-[12px] font-medium text-zinc-700 shadow-[0_1px_2px_rgba(24,24,27,0.05)] hover:bg-zinc-50">
            Salik recharge <ExternalLink size={11} />
          </a>
        </div>
        {/* Ledger — at the end of the dossier body, inside the scrollable area */}
        <div className="mt-5 border-t border-[#f1f1ef] pt-4">
        <div className="flex items-center justify-between px-5 py-2.5">
          <span className="flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wider text-zinc-400">
            <Receipt size={12} /> Entries
          </span>
          <span className="text-[11px] text-zinc-400">{txns.length} all-time</span>
        </div>
        {txns.length === 0 ? (
          <p className="mx-5 mb-5 rounded-xl border border-dashed border-[#e0d8c8] px-3 py-5 text-center text-[12px] text-zinc-400">
            No entries yet — pick this car in Quick Entry when logging fuel or vehicle expenses.
          </p>
        ) : (
          <div className="max-h-48 overflow-y-auto app-scroll border-t border-[#f0ece4]">
            {txns.map((t) => {
              const cat = db.categories.find((c) => c.id === t.category_id)?.name ?? "—";
              return (
                <div key={t.id} className="group flex items-center gap-3 border-b border-[#f0ece4] px-5 py-2 last:border-0 hover:bg-[#faf8f4]">
                  <span className="w-12 shrink-0 text-[11px] tabular-nums text-zinc-400">{fmtDateShort(t.txn_date)}</span>
                  <span className="min-w-0 flex-1 truncate text-[12px] text-zinc-600">
                    {cat}
                    {t.description ? <span className="text-zinc-400"> · {t.description}</span> : null}
                  </span>
                  {t.fuel_liters ? <span className="shrink-0 text-[10px] tabular-nums text-zinc-400">{t.fuel_liters} L</span> : null}
                  <span className="w-24 shrink-0 text-right text-[12px] font-semibold tabular-nums text-zinc-900">{fmtAED(t.amount)}</span>
                  {canEdit ? (
                    <span className="flex shrink-0 opacity-0 transition-opacity group-hover:opacity-100">
                      <button
                        onClick={() => setEditingTxn(t)}
                        className="flex h-6 w-6 items-center justify-center rounded text-zinc-400 hover:bg-[#f4f4f2] hover:text-zinc-700"
                        title="Edit"
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 3a2.85 2.83 4 0 1 4 4L7.5 20.5 2 22l1.5-5.5Z" /></svg>
                      </button>
                      <button
                        onClick={() => setDeletingTxn(t)}
                        className="flex h-6 w-6 items-center justify-center rounded text-zinc-400 hover:bg-red-50 hover:text-red-600"
                        title="Delete"
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /></svg>
                      </button>
                    </span>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </div>

      </div>

      {/* Edit / delete transaction modals */}
      <EditTxnPanel
        txn={editingTxn}
        onClose={() => setEditingTxn(null)}
        onSave={(patch) => {
          if (!editingTxn) return;
          setDb((prev) => (prev ? updateTransaction(prev, editingTxn.id, patch) : prev));
          setEditingTxn(null);
          setToast("Entry updated.");
        }}
      />
      <ConfirmDelete
        open={!!deletingTxn}
        onClose={() => setDeletingTxn(null)}
        label={deletingTxn ? fmtAED(deletingTxn.amount) + " · " + fmtDate(deletingTxn.txn_date) : ""}
        onConfirm={() => {
          if (!deletingTxn) return;
          const id = deletingTxn.id;
          setDb((prev) => (prev ? deleteTransaction(prev, id) : prev));
          setDeletingTxn(null);
          setToast("Entry deleted.");
        }}
      />
    </SlideOver>
  );
}

/* EditTxnPanel — small slide-over for editing a ledger row inside the dossier. */
function EditTxnPanel({ txn, onClose, onSave }: { txn: Transaction | null; onClose: () => void; onSave: (patch: Record<string, unknown>) => void }) {
  const { db } = useDb();
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState("");
  const [desc, setDesc] = useState("");
  const [liters, setLiters] = useState("");
  const [vehicleId, setVehicleId] = useState("");

  React.useEffect(() => {
    if (txn) {
      setAmount(String(txn.amount));
      setDate(txn.txn_date);
      setDesc(txn.description ?? "");
      setLiters(txn.fuel_liters != null ? String(txn.fuel_liters) : "");
      setVehicleId(txn.vehicle_id ?? "");
    }
  }, [txn]);

  if (!txn) return null;

  return (
    <SlideOver
      open
      onClose={onClose}
      title={"Edit entry · " + fmtAED(txn.amount)}
      subtitle={fmtDate(txn.txn_date)}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            onClick={() =>
              onSave({
                amount: parseFloat(amount) || txn.amount,
                txn_date: date,
                description: desc,
                vehicle_id: vehicleId || null,
                fuel_liters: liters ? parseFloat(liters) : null,
              })
            }
          >
            Save changes
          </Button>
        </>
      }
    >
      <div className="space-y-3 p-5">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <Label>Amount (AED)</Label>
            <Input type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
          <div>
            <Label>Date</Label>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <Label>Vehicle</Label>
            <Select value={vehicleId} onChange={(e) => setVehicleId(e.target.value)}>
              <option value="">—</option>
              {db.vehicles.filter((v) => !v.archived).map((v) => (
                <option key={v.id} value={v.id}>
                  {v.label} · {v.plate}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label>Liters</Label>
            <Input type="number" min="0" step="0.01" value={liters} onChange={(e) => setLiters(e.target.value)} />
          </div>
        </div>
        <div>
          <Label>Description</Label>
          <Input value={desc} onChange={(e) => setDesc(e.target.value)} />
        </div>
      </div>
    </SlideOver>
  );
}
