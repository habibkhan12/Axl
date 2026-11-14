"use client";
import React, { useMemo, useRef, useState } from "react";
import { AlertTriangle, Download, FileText, Image as ImageIcon, Pencil, Plus, Trash2, Upload, UserRound } from "lucide-react";
import { PageHeader } from "@/components/app-shell";
import { Button, Card, EmptyState, Input, Label, MicroLabel, Modal, SearchInput, SlideOver, StatCard, Toast } from "@/components/ui";
import { DatePicker } from "@/components/date-picker";
import { useDb, useDbContext } from "@/lib/local-db";
import { deleteStaffDocument, upsertStaff, upsertStaffDocument } from "@/lib/repo";
import { SUPABASE_READY } from "@/lib/supabase";
import { MAX_DOC_BYTES, readAsDataUrl, removeStaffFile, safeFileName, signedStaffUrl, uploadStaffFile } from "@/lib/staff-storage";
import { fmtDate, todayISO } from "@/lib/format";
import type { StaffDocument, StaffMember } from "@/lib/types";

/** Anything expiring inside this window is flagged as "expiring soon". */
const EXPIRY_SOON_DAYS = 60;

type Expiry = { days: number; label: string; tone: "expired" | "soon" | "ok" | "none" };

function expiryOf(date: string | null | undefined): Expiry {
  if (!date) return { days: Infinity, label: "No expiry", tone: "none" };
  const ms = new Date(date + "T00:00:00").getTime() - new Date(todayISO() + "T00:00:00").getTime();
  const days = Math.round(ms / 86400000);
  if (days < 0) return { days, label: "Expired " + Math.abs(days) + "d ago", tone: "expired" };
  if (days === 0) return { days, label: "Expires today", tone: "expired" };
  if (days <= EXPIRY_SOON_DAYS) return { days, label: "Expires in " + days + "d", tone: "soon" };
  return { days, label: "Valid", tone: "ok" };
}

const TONE_CLASS: Record<Expiry["tone"], string> = {
  expired: "border-red-200 bg-red-50 text-red-700",
  soon: "border-amber-200 bg-amber-50 text-amber-700",
  ok: "border-emerald-200 bg-emerald-50 text-emerald-700",
  none: "border-[#e5e5e2] bg-white text-zinc-400",
};

export function PersonnelPage() {
  const { db, setDb } = useDb();
  const { canEdit } = useDbContext();
  const editable = canEdit("/personnel");

  const [q, setQ] = useState("");
  const [adding, setAdding] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [docFor, setDocFor] = useState<{ staffId: string; doc: StaffDocument | null } | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const people = useMemo(() => db.staff.filter((s) => !s.archived).sort((a, b) => a.name.localeCompare(b.name)), [db.staff]);
  const docs = db.staff_documents;
  const selected = selectedId ? people.find((p) => p.id === selectedId) ?? null : null;

  const docsOf = (staffId: string) =>
    docs.filter((d) => d.staff_id === staffId).sort((a, b) => (a.expiry_date ?? "9999") < (b.expiry_date ?? "9999") ? -1 : 1);

  const nextExpiry = (staffId: string): Expiry => {
    const dated = docsOf(staffId).filter((d) => d.expiry_date);
    if (dated.length === 0) return { days: Infinity, label: "—", tone: "none" };
    return expiryOf(dated[0].expiry_date);
  };

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return people.filter((p) => !needle || p.name.toLowerCase().includes(needle) || (p.phone ?? "").toLowerCase().includes(needle));
  }, [people, q]);

  const alerts = useMemo(() => {
    return docs
      .filter((d) => d.expiry_date && expiryOf(d.expiry_date).days <= EXPIRY_SOON_DAYS)
      .map((d) => ({ doc: d, person: people.find((p) => p.id === d.staff_id), expiry: expiryOf(d.expiry_date) }))
      .filter((a) => a.person)
      .sort((a, b) => a.expiry.days - b.expiry.days);
  }, [docs, people]);

  const expiredCount = alerts.filter((a) => a.expiry.tone === "expired").length;

  function addPerson(name: string, phone: string, notes: string) {
    const trimmed = name.trim().replace(/\s+/g, " ");
    if (!trimmed) return false;
    if (db.staff.some((s) => !s.archived && s.name.trim().toLowerCase() === trimmed.toLowerCase())) {
      setToast(`“${trimmed}” is already on the team list.`);
      return false;
    }
    setDb((prev) =>
      prev
        ? upsertStaff(prev, {
            id: "st_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
            name: trimmed,
            phone: phone.trim() || null,
            notes: notes.trim() || null,
            created_at: new Date().toISOString(),
          })
        : prev
    );
    setToast(`${trimmed} added.`);
    return true;
  }

  function saveDoc(staffId: string, doc: StaffDocument) {
    setDb((prev) => (prev ? upsertStaffDocument(prev, doc) : prev));
    setDocFor(null);
    setToast(`“${doc.name}” saved.`);
  }

  async function removeDoc(doc: StaffDocument) {
    if (!window.confirm(`Delete “${doc.name}”${doc.file_name ? " and its file" : ""}? This cannot be undone.`)) return;
    if (doc.file_path) await removeStaffFile(doc.file_path);
    setDb((prev) => (prev ? deleteStaffDocument(prev, doc.id) : prev));
    setToast(`“${doc.name}” deleted.`);
  }

  async function openDoc(doc: StaffDocument, download = false) {
    if (doc.file_path) {
      const url = await signedStaffUrl(doc.file_path, download ? doc.file_name ?? doc.name : null);
      if (!url) {
        setToast("Could not open that file — check the storage bucket.");
        return;
      }
      if (download) {
        const a = document.createElement("a");
        a.href = url;
        a.download = doc.file_name ?? doc.name;
        a.click();
      } else {
        window.open(url, "_blank", "noopener");
      }
      return;
    }
    if (doc.file_data) {
      // Local mode: turn the stored data URL into a blob URL (browsers block data: navigation).
      const blobUrl = dataUrlToBlobUrl(doc.file_data);
      if (!blobUrl) {
        setToast("Could not open that file.");
        return;
      }
      if (download) {
        const a = document.createElement("a");
        a.href = blobUrl;
        a.download = doc.file_name ?? doc.name;
        a.click();
      } else {
        window.open(blobUrl, "_blank", "noopener");
      }
      return;
    }
    setToast("This document has no file attached yet.");
  }

  return (
    <div>
      <PageHeader
        title="Employees"
        subtitle="Team records and their documents — passports, visas, licences — with expiry tracking."
        actions={
          editable ? (
            <Button variant="primary" onClick={() => setAdding(true)}>
              <Plus size={13} /> Add person
            </Button>
          ) : null
        }
      />

      <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard title="People" icon={<UserRound size={15} />} value={String(rows.length)} sub={rows.length === 1 ? "1 person" : `${rows.length} people`} />
        <StatCard title="Documents" value={String(docs.length)} sub="On file" />
        <StatCard title="Expiring soon" value={String(alerts.length - expiredCount)} sub={`Within ${EXPIRY_SOON_DAYS} days`} />
        <StatCard title="Expired" value={String(expiredCount)} sub="Need renewal now" tone={expiredCount > 0 ? "bad" : "plain"} />
      </div>

      {alerts.length > 0 ? (
        <Card className="mb-4 overflow-hidden">
          <div className="flex items-center gap-2 border-b border-[#eae4d9] bg-[#faf8f4] px-4 py-2.5">
            <AlertTriangle size={13} className={expiredCount > 0 ? "text-red-600" : "text-amber-600"} />
            <MicroLabel>Expiry alerts</MicroLabel>
            <span className="ml-auto text-[11px] text-zinc-400">{alerts.length} document{alerts.length === 1 ? "" : "s"}</span>
          </div>
          <div>
            {alerts.slice(0, 6).map(({ doc, person, expiry }) => (
              <button
                key={doc.id}
                onClick={() => setSelectedId(person!.id)}
                className="flex w-full items-center gap-3 border-b border-[#f1f1ef] px-4 py-2 text-left last:border-0 hover:bg-[#faf8f4]"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12px] font-medium text-zinc-800">
                    {doc.name} · {person!.name}
                  </span>
                  <span className="block text-[10px] text-zinc-400">{doc.expiry_date ? fmtDate(doc.expiry_date) : "no date"}</span>
                </span>
                <span className={"shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold " + TONE_CLASS[expiry.tone]}>
                  {expiry.label}
                </span>
              </button>
            ))}
          </div>
        </Card>
      ) : null}

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#eae4d9] bg-[#faf8f4] px-4 py-2.5">
          <MicroLabel>Team — {rows.length}</MicroLabel>
          <div className="w-full sm:w-56">
            <SearchInput value={q} onChange={setQ} placeholder="Search name or number" className="w-full" />
          </div>
        </div>

        {rows.length === 0 ? (
          <div className="p-6">
            <EmptyState icon={<UserRound size={18} />} title="No employees yet" hint={editable ? "Add an employee, then attach their documents." : "Ask an admin to add employees."} />
            {editable ? (
              <div className="mt-3 flex justify-center">
                <Button variant="primary" onClick={() => setAdding(true)}>
                  <Plus size={13} /> Add person
                </Button>
              </div>
            ) : null}
          </div>
        ) : (
          <div>
            {rows.map((p) => {
              const list = docsOf(p.id);
              const next = nextExpiry(p.id);
              return (
                <button
                  key={p.id}
                  onClick={() => setSelectedId(p.id)}
                  className="group flex w-full items-center gap-3 border-b border-[#f0ece4] px-4 py-3 text-left transition-colors last:border-b-0 hover:bg-[#faf8f4]"
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[#eae4d9] bg-[#f4efe8] text-[11px] font-bold text-zinc-500">
                    {monogram(p.name)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-zinc-900">{p.name}</span>
                    <span className="block truncate text-[11px] text-zinc-400">{p.phone || "No number"}</span>
                  </span>
                  <span className="shrink-0 text-[11px] text-zinc-500">
                    {list.length} {list.length === 1 ? "document" : "documents"}
                  </span>
                  {next.tone !== "none" ? (
                    <span className={"shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold " + TONE_CLASS[next.tone]}>{next.label}</span>
                  ) : (
                    <span className="shrink-0 text-[10px] text-zinc-300">no dates</span>
                  )}
                  <svg className="hidden h-4 w-4 shrink-0 text-zinc-300 transition-colors group-hover:text-zinc-500 sm:block" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m9 18 6-6-6-6" /></svg>
                </button>
              );
            })}
          </div>
        )}
      </Card>

      {adding ? (
        <AddPersonModal
          existing={people}
          onClose={() => setAdding(false)}
          onAdd={(name, phone, notes) => {
            if (addPerson(name, phone, notes)) setAdding(false);
          }}
        />
      ) : null}

      {selected ? (
        <PersonDrawer
          person={selected}
          documents={docsOf(selected.id)}
          editable={editable}
          onClose={() => setSelectedId(null)}
          onNewDoc={() => setDocFor({ staffId: selected.id, doc: null })}
          onEditDoc={(doc) => setDocFor({ staffId: selected.id, doc })}
          onView={(doc) => openDoc(doc, false)}
          onDownload={(doc) => openDoc(doc, true)}
          onDelete={(doc) => removeDoc(doc)}
        />
      ) : null}

      {docFor ? (
        <DocumentModal
          staffId={docFor.staffId}
          existing={docFor.doc}
          onClose={() => setDocFor(null)}
          onSaved={(doc) => saveDoc(docFor.staffId, doc)}
        />
      ) : null}

      <Toast message={toast} />
    </div>
  );
}

/* ───────────────────────────── Add person ───────────────────────────────── */

function AddPersonModal({
  existing,
  onClose,
  onAdd,
}: {
  existing: StaffMember[];
  onClose: () => void;
  onAdd: (name: string, phone: string, notes: string) => void;
}) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");
  const duplicate = !!name.trim() && existing.some((p) => p.name.trim().toLowerCase() === name.trim().toLowerCase());

  return (
    <Modal open onClose={onClose} title="Add person">
      <div className="space-y-3">
        <div>
          <Label>Name</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Mohammed Aslam" autoFocus />
          {duplicate ? <p className="mt-1 text-[11px] text-red-600">Someone with that name is already on the list.</p> : null}
        </div>
        <div>
          <Label>Contact number</Label>
          <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+971 50 000 0000" />
        </div>
        <div>
          <Label>Notes</Label>
          <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Role, visa sponsor, anything useful…" />
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!name.trim() || duplicate} onClick={() => onAdd(name, phone, notes)}>
            Add person
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/* ───────────────────────────── Person drawer ────────────────────────────── */

function PersonDrawer({
  person,
  documents,
  editable,
  onClose,
  onNewDoc,
  onEditDoc,
  onView,
  onDownload,
  onDelete,
}: {
  person: StaffMember;
  documents: StaffDocument[];
  editable: boolean;
  onClose: () => void;
  onNewDoc: () => void;
  onEditDoc: (doc: StaffDocument) => void;
  onView: (doc: StaffDocument) => void;
  onDownload: (doc: StaffDocument) => void;
  onDelete: (doc: StaffDocument) => void;
}) {
  return (
    <SlideOver
      open
      onClose={onClose}
      title={
        <span className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-[#eae4d9] bg-[#f4efe8] text-[11px] font-bold text-zinc-500">{monogram(person.name)}</span>
          <span className="min-w-0 flex-col">
            <span className="block truncate text-sm font-semibold text-zinc-900">{person.name}</span>
            <span className="block truncate text-[11px] text-zinc-400">{person.phone || "No contact number"}</span>
          </span>
        </span>
      }
      footer={
        <>
          <Button onClick={onClose}>Close</Button>
          {editable ? (
            <Button variant="primary" onClick={onNewDoc}>
              <Plus size={13} /> New Document
            </Button>
          ) : null}
        </>
      }
    >
      <div className="space-y-4 p-5">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <MicroLabel>Contact number</MicroLabel>
            <div className="mt-1 text-[13px] font-medium text-zinc-800">{person.phone || "—"}</div>
          </div>
          <div>
            <MicroLabel>Documents</MicroLabel>
            <div className="mt-1 text-[13px] font-medium text-zinc-800">{documents.length}</div>
          </div>
        </div>

        {person.notes ? <p className="rounded-xl border border-[#e9e9e6] bg-[#fbfbfa] px-3 py-2 text-[12px] leading-snug text-zinc-600">{person.notes}</p> : null}

        <div>
          <MicroLabel className="mb-2">Documents</MicroLabel>
          {documents.length === 0 ? (
            <div className="rounded-xl border border-dashed border-[#e5e5e2] px-3 py-4 text-[12px] text-zinc-400">
              <p>No documents attached yet.</p>
              {editable ? (
                <button onClick={onNewDoc} className="mt-2 inline-flex items-center gap-1 rounded-lg bg-zinc-900 px-2.5 py-1.5 text-[11px] font-medium text-white transition-colors hover:bg-zinc-700">
                  <Upload size={11} /> New Document
                </button>
              ) : null}
            </div>
          ) : (
            <div className="space-y-2">
              {documents.map((doc) => {
                const expiry = expiryOf(doc.expiry_date);
                const isImage = (doc.file_type ?? "").startsWith("image/");
                return (
                  <div key={doc.id} className="rounded-xl border border-[#eae4d9] p-3">
                    <div className="flex items-start gap-2.5">
                      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[#eae4d9] bg-[#f7f5f1] text-zinc-400">
                        {isImage ? <ImageIcon size={14} /> : <FileText size={14} />}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <span className="truncate text-[13px] font-semibold text-zinc-900">{doc.name}</span>
                          {expiry.tone !== "none" ? (
                            <span className={"rounded-full border px-2 py-0.5 text-[10px] font-semibold " + TONE_CLASS[expiry.tone]}>{expiry.label}</span>
                          ) : (
                            <span className="rounded-full border border-[#e5e5e2] bg-white px-2 py-0.5 text-[10px] text-zinc-400">No expiry</span>
                          )}
                        </div>
                        <div className="mt-0.5 truncate text-[11px] text-zinc-400">
                          {doc.expiry_date ? "Expires " + fmtDate(doc.expiry_date) : "No expiry date"}
                          {doc.file_name ? " · " + doc.file_name : " · no file"}
                          {doc.file_size ? " · " + formatSize(doc.file_size) : ""}
                        </div>
                      </div>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      <SmallAction icon={<FileText size={11} />} label="View" onClick={() => onView(doc)} disabled={!doc.file_path && !doc.file_data} />
                      <SmallAction icon={<Download size={11} />} label="Download" onClick={() => onDownload(doc)} disabled={!doc.file_path && !doc.file_data} />
                      {editable ? <SmallAction icon={<Pencil size={11} />} label="Edit" onClick={() => onEditDoc(doc)} /> : null}
                      {editable ? <SmallAction icon={<Trash2 size={11} />} label="Delete" onClick={() => onDelete(doc)} danger /> : null}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <p className="text-[10px] leading-relaxed text-zinc-300">
          {SUPABASE_READY
            ? "Files are stored in the private staff-documents bucket — only signed-in accounts can open them."
            : "Local mode: files are kept in this browser. Connect Supabase to store them in the cloud."}
        </p>
      </div>
    </SlideOver>
  );
}

function SmallAction({ icon, label, onClick, disabled, danger }: { icon: React.ReactNode; label: string; onClick: () => void; disabled?: boolean; danger?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={
        "inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[11px] font-medium transition-colors disabled:opacity-40 " +
        (danger ? "border-red-200 text-red-600 hover:bg-red-50" : "border-[#e5e5e2] text-zinc-600 hover:border-zinc-400 hover:text-zinc-900")
      }
    >
      {icon} {label}
    </button>
  );
}

/* ───────────────────────────── Document modal ───────────────────────────── */

function DocumentModal({
  staffId,
  existing,
  onClose,
  onSaved,
}: {
  staffId: string;
  existing: StaffDocument | null;
  onClose: () => void;
  onSaved: (doc: StaffDocument) => void;
}) {
  const [name, setName] = useState(existing?.name ?? "");
  const [expiry, setExpiry] = useState(existing?.expiry_date ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  async function save() {
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Give the document a name first.");
      return;
    }
    if (file && file.size > MAX_DOC_BYTES) {
      setError("That file is larger than 10 MB.");
      return;
    }
    setBusy(true);
    setError(null);
    const id = existing?.id ?? "doc_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    let filePath = existing?.file_path ?? null;
    let fileData = existing?.file_data ?? null;
    let fileName = existing?.file_name ?? null;
    let fileType = existing?.file_type ?? null;
    let fileSize = existing?.file_size ?? null;

    if (file) {
      if (SUPABASE_READY) {
        const path = staffId + "/" + id + "-" + safeFileName(file.name);
        const err = await uploadStaffFile(path, file);
        if (err) {
          setBusy(false);
          setError("Upload failed: " + err);
          return;
        }
        filePath = path;
        fileData = null;
      } else {
        try {
          fileData = await readAsDataUrl(file);
        } catch (e) {
          setBusy(false);
          setError(e instanceof Error ? e.message : "Could not read that file");
          return;
        }
        filePath = null;
      }
      fileName = file.name;
      fileType = file.type || null;
      fileSize = file.size;
    }

    onSaved({
      id,
      staff_id: staffId,
      name: trimmed,
      expiry_date: expiry || null,
      file_path: filePath,
      file_data: fileData,
      file_name: fileName,
      file_type: fileType,
      file_size: fileSize,
      created_at: existing?.created_at ?? new Date().toISOString(),
    });
    setBusy(false);
  }

  return (
    <Modal open onClose={onClose} title={existing ? "Edit document" : "New document"}>
      <div className="space-y-3">
        <div>
          <Label>Document name</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Passport, Visa, Labour card…" autoFocus />
        </div>

        <div>
          <Label>Expiry date</Label>
          {expiry ? (
            <div className="flex items-center gap-2">
              <div className="flex-1">
                <DatePicker value={expiry} onChange={setExpiry} />
              </div>
              <button type="button" onClick={() => setExpiry("")} className="rounded-lg border border-[#e5e5e2] px-2 py-1.5 text-[11px] text-zinc-500 hover:border-zinc-400">
                Clear
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setExpiry(todayISO())}
              className="w-full rounded-lg border border-dashed border-[#e5e5e2] px-3 py-2 text-left text-[12px] text-zinc-400 transition-colors hover:border-zinc-400"
            >
              Set an expiry date (optional)
            </button>
          )}
        </div>

        <div>
          <Label>File (PDF or photo)</Label>
          <input
            ref={fileRef}
            type="file"
            accept="application/pdf,image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0] ?? null;
              setError(null);
              setFile(f);
            }}
          />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="flex w-full items-center gap-2 rounded-lg border border-dashed border-[#d9d9d5] bg-[#fbfbfa] px-3 py-2.5 text-left text-[12px] text-zinc-500 transition-colors hover:border-zinc-400"
          >
            <Upload size={13} />
            <span className="min-w-0 flex-1 truncate">
              {file ? file.name + " · " + formatSize(file.size) : existing?.file_name ? "Replace " + existing.file_name : "Choose a PDF or image (max 10 MB)"}
            </span>
          </button>
        </div>

        {error ? <p className="text-[11px] text-red-600">{error}</p> : null}

        <div className="flex justify-end gap-2 border-t border-[#efefec] pt-3">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={busy || !name.trim()} onClick={save}>
            {busy ? "Saving…" : existing ? "Save changes" : "Save document"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/* ───────────────────────────────── helpers ──────────────────────────────── */

function monogram(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

function dataUrlToBlobUrl(dataUrl: string): string | null {
  const comma = dataUrl.indexOf(",");
  if (comma < 0) return null;
  const head = dataUrl.slice(0, comma);
  const body = dataUrl.slice(comma + 1);
  const mime = /data:([^;,]+)/.exec(head)?.[1] ?? "application/octet-stream";
  try {
    const binary = head.includes(";base64") ? atob(body) : decodeURIComponent(body);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return URL.createObjectURL(new Blob([bytes], { type: mime }));
  } catch {
    return null;
  }
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}
