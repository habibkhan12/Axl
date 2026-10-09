"use client";
import React, { useEffect, useRef, useState } from "react";
import { useDb, useDbContext } from "@/lib/local-db";
import { getSupabase } from "@/lib/supabase";
import { freshDb } from "@/lib/seed";
import { upsertCategory, upsertPaymentMethod, addTransaction, archiveRef } from "@/lib/repo";
import type { Database } from "@/lib/types";
import { todayISO } from "@/lib/format";
import { appendNotif, loadNotifPrefs, saveNotifPrefs, NOTIF_KIND_META, type NotifKind } from "@/lib/notifications";
import {
  Bell, Database as DatabaseIcon, Eye, EyeOff, KeyRound, Pencil, Plus, Settings2, Sun, Target, Trash2, UserRound, Users,
} from "lucide-react";
import { Card, Button, Input, Label, Modal, Toast, ConfirmDelete, KebabMenu, Segmented, Select, Avatar, Pill, Switch, MicroLabel } from "@/components/ui";
import { PageHeader } from "@/components/app-shell";

type Section = "details" | "password" | "notifications" | "appearance" | "team" | "general" | "data";

const SECTIONS: { key: Section; label: string }[] = [
  { key: "details", label: "My details" },
  { key: "password", label: "Password" },
  { key: "notifications", label: "Notifications" },
  { key: "appearance", label: "Appearance" },
  { key: "team", label: "Team" },
  { key: "general", label: "General" },
  { key: "data", label: "Data tools" },
];

/* ── Shared layout rhythm — matches Fleet / Dues card anatomy ─────────── */

function SectionCard({
  title,
  hint,
  icon,
  right,
  children,
  flush = false,
}: {
  title: string;
  hint?: string;
  icon?: React.ReactNode;
  right?: React.ReactNode;
  children: React.ReactNode;
  flush?: boolean;
}) {
  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-[#eae4d9] bg-[#faf8f4] px-6 py-4">
        <div className="flex min-w-0 items-center gap-2.5">
          {icon ? (
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-[#eae4d9] bg-white text-zinc-500">{icon}</span>
          ) : null}
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-zinc-900">{title}</h3>
            {hint ? <p className="text-xs font-normal text-zinc-400">{hint}</p> : null}
          </div>
        </div>
        {right ? <div className="flex flex-wrap items-center gap-2">{right}</div> : null}
      </div>
      <div className={flush ? "" : "px-6 py-5"}>{children}</div>
    </Card>
  );
}

/** Single settings row: label + description left, control right. */
function Row({ title, desc, children, first = false }: { title: string; desc?: string; children: React.ReactNode; first?: boolean }) {
  return (
    <div className={"flex flex-wrap items-center justify-between gap-x-8 gap-y-3 px-6 py-4 " + (first ? "" : "border-t border-[#f0ece4]")}>
      <div className="min-w-0 max-w-lg">
        <div className="text-sm font-medium text-zinc-800">{title}</div>
        {desc ? <p className="mt-0.5 text-xs leading-snug text-zinc-400">{desc}</p> : null}
      </div>
      <div className="flex shrink-0 items-center gap-2">{children}</div>
    </div>
  );
}

const NARROW = "max-w-3xl";
const WIDE = "max-w-5xl";

export default function SettingsPage() {
  const { db, setDb } = useDb();
  const { session } = useDbContext();
  const [section, setSection] = useState<Section>("details");
  const [toast, setToast] = useState<string | null>(null);
  const isSignedIn = !!session;

  const sections = SECTIONS.filter((s) => !["details", "password"].includes(s.key) || isSignedIn);

  // Deep-link: /settings?section=team (also accepts the event from the palette).
  useEffect(() => {
    const s = new URLSearchParams(window.location.search).get("section");
    if (s && SECTIONS.some((x) => x.key === s)) setSection(s as Section);
  }, []);

  return (
    <div className="pb-4">
      <PageHeader title="Settings" subtitle="Your account, the books, and everyone who works in them." />

      {/* Section strip — segmented control like the Fleet/Dues filter bars */}
      <div className="mb-6 overflow-x-auto pb-1">
        <Segmented
          value={section}
          onChange={(v) => setSection(v)}
          options={sections.map((s) => [s.key, s.label] as [Section, string])}
        />
      </div>

      {section === "details" && isSignedIn ? <MyDetails onToast={setToast} /> : null}
      {section === "password" && isSignedIn ? <PasswordSection onToast={setToast} /> : null}
      {section === "notifications" ? <NotificationsSection onToast={setToast} /> : null}
      {section === "appearance" ? <AppearanceSection onToast={setToast} /> : null}
      {section === "team" ? <TeamSection collections={{ db, setDb }} onToast={setToast} /> : null}
      {section === "general" ? <GeneralSection db={db} setDb={setDb} onToast={setToast} /> : null}
      {section === "data" ? <DataSection db={db} setDb={setDb} onToast={setToast} signedIn={isSignedIn} /> : null}

      <Toast message={toast} />
    </div>
  );
}

/* ───────────────────────────── My details ─────────────────────────────── */

const AVATAR_HINT_BODY =
  "-- run once in the Supabase SQL editor to enable profile photos\nalter table profiles add column if not exists avatar_url text;\n\n-- upload quota guard (optional but recommended)\n-- photos are stored as data URLs inside the column, resized to 256px on the client.";

function MyDetails({ onToast }: { onToast: (m: string) => void }) {
  const { profile, refresh } = useDbContext();
  const [name, setName] = useState(profile?.name ?? "");
  const [email, setEmail] = useState("");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [createdAt, setCreatedAt] = useState<string | null>(null);
  const [editingName, setEditingName] = useState(false);
  const [savingName, setSavingName] = useState(false);
  const [savingAvatar, setSavingAvatar] = useState(false);
  const [sqlHint, setSqlHint] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await getSupabase().auth.getSession();
      const token = data.session?.access_token ?? "";
      if (!token) return;
      try {
        const res = await fetch("/api/me", { headers: { Authorization: "Bearer " + token } });
        if (!res.ok) return;
        const me = (await res.json()) as { email?: string; name?: string; avatar_url?: string | null; created_at?: string | null };
        if (!cancelled) {
          setEmail(me.email ?? "");
          if (me.name) setName(me.name);
          setAvatarUrl(me.avatar_url ?? null);
          setCreatedAt(me.created_at ?? null);
        }
      } catch {
        /* offline — form still editable from the profile row */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setAvatarUrl(profile?.avatar_url ?? avatarUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.avatar_url]);

  async function saveName() {
    const trimmed = name.trim();
    if (!trimmed) return;
    setSavingName(true);
    try {
      const { data } = await getSupabase().auth.getSession();
      const token = data.session?.access_token ?? "";
      const res = await fetch("/api/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
        body: JSON.stringify({ name: trimmed }),
      });
      const out = (await res.json().catch(() => ({}))) as { name?: string; error?: string };
      if (!res.ok) {
        onToast(out.error ?? "Could not save your name.");
        return;
      }
      window.dispatchEvent(new CustomEvent("axl-profile-updated"));
      appendNotif("account", "Your name was changed to " + (out.name ?? trimmed), "self");
      onToast("Name updated");
      setEditingName(false);
      await refresh();
    } finally {
      setSavingName(false);
    }
  }

  async function saveAvatar(file: File) {
    setSavingAvatar(true);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result));
        r.onerror = () => reject(new Error("read failed"));
        r.readAsDataURL(file);
      });
      const sized = await new Promise<string>((resolve) => {
        const img = new Image();
        img.onload = () => {
          const side = Math.min(img.width, img.height);
          const c = document.createElement("canvas");
          c.width = 256;
          c.height = 256;
          const ctx = c.getContext("2d");
          if (!ctx) return resolve(dataUrl);
          ctx.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, 256, 256);
          resolve(c.toDataURL("image/jpeg", 0.85));
        };
        img.onerror = () => resolve(dataUrl);
        img.src = dataUrl;
      });
      const { data } = await getSupabase().auth.getSession();
      const token = data.session?.access_token ?? "";
      const res = await fetch("/api/me", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
        body: JSON.stringify({ action: "avatar", dataUrl: sized }),
      });
      const out = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        if (/add column avatar_url/i.test(out.error ?? "")) setSqlHint(AVATAR_HINT_BODY);
        else onToast(out.error ?? "Could not save the photo.");
        return;
      }
      window.dispatchEvent(new CustomEvent("axl-profile-updated"));
      onToast("Profile photo updated");
      await refresh();
    } finally {
      setSavingAvatar(false);
    }
  }

  async function removeAvatar() {
    setSavingAvatar(true);
    try {
      const { data } = await getSupabase().auth.getSession();
      const token = data.session?.access_token ?? "";
      const res = await fetch("/api/me", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
        body: JSON.stringify({ action: "avatar", dataUrl: "" }),
      });
      const out = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        if (/add column avatar_url/i.test(out.error ?? "")) setSqlHint(AVATAR_HINT_BODY);
        else onToast(out.error ?? "Could not remove the photo.");
        return;
      }
      window.dispatchEvent(new CustomEvent("axl-profile-updated"));
      onToast("Profile photo removed");
      await refresh();
    } finally {
      setSavingAvatar(false);
    }
  }

  return (
    <div className={NARROW + " space-y-5"}>
      <SectionCard title="Profile" hint="How you appear across the books." icon={<UserRound size={13} />}>
        <div className="flex flex-wrap items-center gap-5">
          <div className="relative shrink-0">
            <Avatar name={name || "User"} size="xl" src={avatarUrl} />
            <button
              onClick={() => fileRef.current?.click()}
              disabled={savingAvatar}
              title={avatarUrl ? "Change photo" : "Upload photo"}
              className="absolute -bottom-1 -right-1 flex h-8 w-8 items-center justify-center rounded-full border border-[#eae4d9] bg-white text-zinc-500 shadow-[0_1px_3px_rgba(24,24,27,0.12)] transition-colors hover:bg-[#f4f4f2] hover:text-zinc-900 disabled:opacity-40"
            >
              <Pencil size={13} />
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void saveAvatar(f);
                e.target.value = "";
              }}
            />
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-lg font-semibold text-zinc-900">{name || "User"}</div>
            <div className="truncate text-sm text-zinc-400">{email || "…"}</div>
            <div className="mt-2 flex items-center gap-3">
              {avatarUrl ? (
                <button onClick={() => void removeAvatar()} disabled={savingAvatar} className="text-xs font-medium text-red-500 hover:underline disabled:opacity-40">
                  Remove photo
                </button>
              ) : null}
              {createdAt ? <span className="text-xs text-zinc-400">Member since {new Date(createdAt).toLocaleDateString()}</span> : null}
            </div>
          </div>
        </div>

        <div className="mt-6 border-t border-[#f0ece4] pt-5">
          <Label>Display name</Label>
          <div className="flex max-w-md gap-2">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={!editingName || savingName}
              className={editingName ? "" : "bg-[#fafaf9] text-zinc-700"}
            />
            {editingName ? (
              <>
                <Button onClick={() => { setEditingName(false); setName(profile?.name ?? ""); }} disabled={savingName}>Cancel</Button>
                <Button variant="primary" onClick={() => void saveName()} disabled={savingName || !name.trim() || name.trim() === profile?.name}>
                  {savingName ? "Saving…" : "Save"}
                </Button>
              </>
            ) : (
              <Button onClick={() => setEditingName(true)}>
                <Pencil size={13} /> Edit
              </Button>
            )}
          </div>
          <p className="mt-2 text-xs text-zinc-400">Shown in the sidebar and next to everything you add. Your sign-in email can’t be changed.</p>
        </div>
      </SectionCard>

      {sqlHint ? (
        <Card className="border-amber-200 bg-amber-50 p-5">
          <MicroLabel className="!text-amber-800">One-time setup: photo storage</MicroLabel>
          <p className="mt-1.5 text-xs text-amber-800">Profile photos need one column on the profiles table. Run this once in the Supabase SQL editor:</p>
          <pre className="mt-2 overflow-x-auto rounded-lg bg-zinc-900 p-3 text-[11px] text-zinc-100">{sqlHint}</pre>
        </Card>
      ) : null}

      <SectionCard title="Sessions" hint="Devices signed in with your account." icon={<KeyRound size={13} />}>
        <Row title="Sign out other devices" desc="Left the app open on a shared computer? This keeps you signed in here and kicks every other session." first>
          <SignOutOthersButton onToast={onToast} busy={savingAvatar ? true : undefined} />
        </Row>
      </SectionCard>
    </div>
  );
}

function SignOutOthersButton({ onToast }: { onToast: (m: string) => void; busy?: boolean }) {
  const [busy, setBusy] = useState(false);
  async function go() {
    setBusy(true);
    try {
      const { data } = await getSupabase().auth.getSession();
      const token = data.session?.access_token ?? "";
      const res = await fetch("/api/me", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
        body: JSON.stringify({ action: "signOutOthers" }),
      });
      const out = (await res.json().catch(() => ({}))) as { error?: string };
      onToast(res.ok ? "All other sessions signed out" : out.error ?? "Failed — not configured on the server.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Button variant="danger" onClick={() => void go()} disabled={busy}>
      {busy ? "Signing out…" : "Sign out other devices"}
    </Button>
  );
}

/* ───────────────────────────── Password ───────────────────────────────── */

function PasswordSection({ onToast }: { onToast: (m: string) => void }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function strength(pw: string): { score: number; label: string } {
    let score = 0;
    if (pw.length >= 8) score++;
    if (pw.length >= 12) score++;
    if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) score++;
    if (/\d/.test(pw)) score++;
    if (/[^A-Za-z0-9]/.test(pw)) score++;
    return { score, label: ["Too short", "Weak", "Okay", "Good", "Strong", "Very strong"][Math.min(score, 5)] };
  }
  const st = strength(next);

  async function save() {
    setErr(null);
    if (next.length < 6) return setErr("New password must be at least 6 characters.");
    if (next !== confirm) return setErr("The two passwords don’t match.");
    setBusy(true);
    try {
      const sb = getSupabase();
      const email = (await sb.auth.getSession()).data.session?.user?.email ?? "";
      if (current) {
        const { error } = await sb.auth.signInWithPassword({ email, password: current });
        if (error) {
          setErr("That current password is not right — try again or leave it empty.");
          return;
        }
      }
      const { data: sdata } = await sb.auth.getSession();
      const token = sdata.session?.access_token ?? "";
      const res = await fetch("/api/me", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
        body: JSON.stringify({ action: "password", password: next }),
      });
      const out = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setErr(out.error ?? "Could not change the password.");
        return;
      }
      appendNotif("account", "Your password was changed", "self");
      onToast("Password updated");
      setCurrent("");
      setNext("");
      setConfirm("");
    } finally {
      setBusy(false);
    }
  }

  const barColor = st.score <= 1 ? "bg-red-400" : st.score === 2 ? "bg-amber-400" : st.score === 3 ? "bg-lime-500" : "bg-emerald-500";

  return (
    <div className={NARROW + " space-y-5"}>
      <SectionCard title="Change your password" hint="Pick something you don’t use anywhere else." icon={<KeyRound size={13} />}>
        <div className="max-w-md space-y-4">
          <div>
            <Label>Current password <span className="normal-case font-normal text-zinc-300">— verifies it’s you; leave empty to skip</span></Label>
            <div className="relative">
              <Input type={show ? "text" : "password"} value={current} onChange={(e) => setCurrent(e.target.value)} placeholder="••••••••" className="pr-16" />
              <ToggleShow show={show} onToggle={() => setShow((s) => !s)} />
            </div>
          </div>
          <div>
            <Label>New password</Label>
            <div className="relative">
              <Input type={show ? "text" : "password"} value={next} onChange={(e) => setNext(e.target.value)} placeholder="at least 6 characters" className="pr-16" />
              <ToggleShow show={show} onToggle={() => setShow((s) => !s)} />
            </div>
            {next ? (
              <div className="mt-2.5">
                <div className="h-1 w-44 overflow-hidden rounded-full bg-zinc-100">
                  <div className={"h-full rounded-full transition-all " + barColor} style={{ width: (Math.min(st.score, 5) / 5) * 100 + "%" }} />
                </div>
                <div className="mt-1.5 text-[11px] font-medium text-zinc-400">{st.label}</div>
              </div>
            ) : null}
          </div>
          <div>
            <Label>Confirm new password</Label>
            <Input type={show ? "text" : "password"} value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="repeat the new password" />
          </div>
          {err ? <p className="rounded-lg bg-red-50 px-3.5 py-2.5 text-[12px] text-red-700">{err}</p> : null}
          <div className="flex justify-end pt-1">
            <Button variant="primary" disabled={busy || next.length < 6 || next !== confirm} onClick={() => void save()}>
              {busy ? "Updating…" : "Update password"}
            </Button>
          </div>
        </div>
      </SectionCard>

      <SectionCard title="Sessions" hint="Devices signed in with your account." icon={<KeyRound size={13} />}>
        <Row title="Sign out other devices" desc="Signs every other device out without changing your password. This one stays signed in." first>
          <SignOutOthersButton onToast={onToast} />
        </Row>
      </SectionCard>
    </div>
  );
}

function ToggleShow({ show, onToggle }: { show: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="absolute right-2 top-1/2 flex h-7 w-8 -translate-y-1/2 items-center justify-center rounded-md text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700"
      tabIndex={-1}
    >
      {show ? <EyeOff size={14} /> : <Eye size={14} />}
    </button>
  );
}

/* ──────────────────────────── Notifications ──────────────────────────── */

function NotificationsSection({ onToast }: { onToast: (m: string) => void }) {
  const [prefs, setPrefs] = useState<Record<NotifKind, boolean> | null>(null);

  useEffect(() => {
    setPrefs(loadNotifPrefs());
  }, []);

  function setKind(kind: NotifKind, on: boolean) {
    const next = { ...(prefs ?? loadNotifPrefs()), [kind]: on };
    setPrefs(next);
    saveNotifPrefs(next);
    onToast(on ? kind + " notifications on" : kind + " notifications muted");
  }

  function setAll(on: boolean) {
    const next = {} as Record<NotifKind, boolean>;
    for (const m of NOTIF_KIND_META) next[m.kind] = on;
    setPrefs(next);
    saveNotifPrefs(next);
    onToast(on ? "All notifications on" : "Notifications muted");
  }

  if (!prefs) return null;

  return (
    <div className={WIDE + " space-y-5"}>
      <SectionCard
        title="Notification settings"
        hint="Mute a category and it stops landing in the bell feed and badge. Stored per device."
        icon={<Bell size={13} />}
        right={
          <>
            <Button onClick={() => setAll(true)} className="!px-3 !py-1.5 !text-xs">Enable all</Button>
            <Button onClick={() => setAll(false)} className="!px-3 !py-1.5 !text-xs">Mute all</Button>
          </>
        }
        flush
      >
        <div>
          {NOTIF_KIND_META.map((m, i) => (
            <div key={m.kind} className={"flex flex-wrap items-center justify-between gap-x-8 gap-y-2 px-6 py-4 " + (i > 0 ? "border-t border-[#f0ece4]" : "")}>
              <div className="min-w-0 max-w-lg">
                <div className="text-sm font-medium text-zinc-800">{m.label}</div>
                <p className="mt-0.5 text-xs leading-snug text-zinc-400">{m.blurb}</p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span className="w-10 text-right text-[11px] font-medium text-zinc-300">{prefs[m.kind] ? "On" : "Off"}</span>
                <Switch checked={prefs[m.kind]} onChange={(v) => setKind(m.kind, v)} label={m.label} />
              </div>
            </div>
          ))}
        </div>
      </SectionCard>
    </div>
  );
}

/* ───────────────────────────── Appearance ────────────────────────────── */

function AppearanceSection({ onToast }: { onToast: (m: string) => void }) {
  return (
    <div className={NARROW + " space-y-5"}>
      <SectionCard title="Appearance" hint="Local display choices — saved per device." icon={<Sun size={13} />} flush>
        <CollapseRow onToast={onToast} />
        <Row title="Theme" desc="The app follows your operating system’s preference. The books keep the warm-paper look in both modes." >
          <Pill tone="emerald">Light — follows system</Pill>
        </Row>
      </SectionCard>
    </div>
  );
}

function CollapseRow({ onToast }: { onToast: (m: string) => void }) {
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    setCollapsed(window.localStorage.getItem("axl-sidebar-collapsed") === "1");
  }, []);
  function flip(v: boolean) {
    window.localStorage.setItem("axl-sidebar-collapsed", v ? "1" : "0");
    window.dispatchEvent(new CustomEvent("axl-sidebar-collapse", { detail: v }));
    setCollapsed(v);
    onToast(v ? "Sidebar: icons only" : "Sidebar: full width");
  }
  return (
    <Row first title="Icons-only sidebar" desc="A narrower sidebar shows navigation icons only — handy on smaller screens. Also available from the sidebar itself.">
      <Switch checked={collapsed} onChange={flip} label="Icons-only sidebar" />
    </Row>
  );
}

/* ─────────────────────────── Team (admin) ────────────────────────────── */

interface UserRowX {
  id: string;
  email: string;
  name: string;
  role: string;
  avatar_url?: string | null;
  tab_access?: Record<string, string> | null;
  confirmed: boolean;
  last_sign_in: string | null;
  created_at: string | null;
  has_profile: boolean;
}

const TAB_DEFS: { key: string; label: string }[] = [
  { key: "dashboard", label: "Dashboard" },
  { key: "transactions", label: "Transactions" },
  { key: "fleet", label: "Fleet" },
  { key: "dues", label: "Dues" },
];
const ACCESS_LEVELS: { key: string; label: string }[] = [
  { key: "none", label: "No access" },
  { key: "view", label: "View" },
  { key: "edit", label: "Edit" },
];

function TeamSection({ collections, onToast }: { collections: { db: Database | null; setDb: React.Dispatch<React.SetStateAction<Database | null>> }; onToast: (m: string) => void }) {
  const ctx = useDbContext();
  const { role, refresh, profile, session } = ctx;
  const db = collections.db;
  const isOwner = role === "owner";
  const [rows, setRows] = useState<UserRowX[] | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [newRole, setNewRole] = useState<"owner" | "editor" | "viewer">("editor");
  const [newAccess, setNewAccess] = useState<Record<string, string>>({ transactions: "edit", dashboard: "view", fleet: "view" });
  const [accessUserId, setAccessUserId] = useState<string | null>(null);
  const [pwUser, setPwUser] = useState<UserRowX | null>(null);
  const [busy, setBusy] = useState(false);
  const [notConfigured, setNotConfigured] = useState(false);

  async function api(method: string, body?: unknown, query = "") {
    const { data } = await getSupabase().auth.getSession();
    const token = data.session?.access_token ?? "";
    const res = await fetch("/api/admin/users" + query, {
      method,
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (res.status === 503) {
      setNotConfigured(true);
      throw new Error("Server account management is not configured yet.");
    }
    const out = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((out as { error?: string }).error ?? "Request failed.");
    return out;
  }

  async function loadAll() {
    try {
      const data = (await api("GET")) as { users: UserRowX[] };
      setRows(data.users);
    } catch {
      /* action errors surface themselves; an empty list shows the fallback */
    }
  }

  React.useEffect(() => {
    if (isOwner) void loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOwner]);

  async function createUser() {
    setBusy(true);
    try {
      const access = newRole === "viewer" ? newAccess : undefined;
      await api("POST", { email: email.trim(), password, name: name.trim(), role: newRole, tab_access: access });
      appendNotif("account", "Account created — " + (name.trim() || email.trim()), (newRole === "owner" ? "admin" : newRole) + " · " + email.trim());
      onToast("Account created for " + email.trim());
      setName("");
      setEmail("");
      setPassword("");
      setAddOpen(false);
      await loadAll();
      await refresh();
    } catch (e) {
      onToast(e instanceof Error ? e.message : "Failed.");
    } finally {
      setBusy(false);
    }
  }

  async function setRole(userId: string, r: string) {
    try {
      await api("PATCH", { userId, role: r });
      appendNotif("account", "Role changed — " + r + " granted", "account " + userId.slice(0, 8));
      onToast("Role changed to " + r + ".");
      await loadAll();
    } catch (e) {
      onToast(e instanceof Error ? e.message : "Failed.");
    }
  }

  async function saveAccess(userId: string, access: Record<string, string>) {
    try {
      await api("PATCH", { userId, tab_access: access });
      appendNotif("account", "Tab access updated", "account " + userId.slice(0, 8));
      onToast("Tab access saved.");
      await loadAll();
    } catch (e) {
      onToast(e instanceof Error ? e.message : "Failed.");
    }
  }

  async function savePassword(userId: string, pw: string, userName: string) {
    try {
      await api("PATCH", { userId, password: pw });
      appendNotif("account", "Password reset — " + userName, "admin action");
      onToast("Password updated for " + userName + ".");
    } catch (e) {
      onToast(e instanceof Error ? e.message : "Failed.");
    }
  }

  function accessSummary(u: UserRowX): string {
    if (u.role === "owner") return "full access";
    if (u.role === "editor") return "full data access";
    const a = u.tab_access ?? {};
    const parts = TAB_DEFS.filter((t) => a[t.key] && a[t.key] !== "none").map((t) => t.label + " · " + (a[t.key] === "edit" ? "edit" : "view"));
    return parts.length ? parts.join(", ") : "no tabs assigned";
  }

  async function deleteUser(userId: string, userName: string) {
    if (!window.confirm("Delete the account for " + userName + "? This cannot be undone.")) return;
    try {
      await api("DELETE", undefined, "?userId=" + encodeURIComponent(userId));
      appendNotif("account", "Account deleted — " + userName, "admin action");
      onToast("Account deleted: " + userName);
      await loadAll();
    } catch (e) {
      onToast(e instanceof Error ? e.message : "Failed.");
    }
  }

  if (!isOwner) {
    return (
      <div className={NARROW + " space-y-5"}>
        <SectionCard title="Your account" hint="What you can do in these books." icon={<Users size={13} />}>
          <div className="flex flex-wrap items-center gap-4">
            <Avatar name={profile?.name ?? "User"} size="lg" src={profile?.avatar_url ?? null} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold text-zinc-900">{profile?.name ?? "User"}</div>
              <div className="truncate text-xs text-zinc-400">{session?.user?.email ?? "—"}</div>
            </div>
            <Pill tone={role === "editor" ? "emerald" : "zinc"}>{role === "editor" ? "Editor — full data access" : "View-only account"}</Pill>
          </div>
          <p className="mt-4 text-xs text-zinc-400">Only the owner can manage team accounts, roles and tab access. Ask them for any changes.</p>
        </SectionCard>
      </div>
    );
  }

  return (
    <div className={WIDE + " space-y-5"}>
      <SectionCard
        title="Team accounts"
        hint="Create accounts, set roles, and choose which tabs each account can see."
        icon={<Users size={13} />}
        right={
          <Button variant="primary" onClick={() => setAddOpen(true)}>
            <Plus size={13} /> Create account
          </Button>
        }
        flush
      >
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-[#eae4d9] bg-white text-left text-[10px] uppercase tracking-wider text-zinc-400">
              <th className="px-6 py-3 font-semibold">Account</th>
              <th className="px-6 py-3 font-semibold">Role &amp; access</th>
              <th className="hidden px-6 py-3 font-semibold sm:table-cell">Last sign-in</th>
              <th className="w-10 px-6 py-3" />
            </tr>
          </thead>
          <tbody>
            {((rows ?? []) as UserRowX[]).concat(
              (rows ? [] : (db?.users ?? []).map((u) => ({ ...u, confirmed: true, last_sign_in: null, created_at: null, has_profile: true }))) as UserRowX[]
            ).map((u, i) => {
              const last = u.last_sign_in ? new Date(u.last_sign_in).toLocaleDateString() : "—";
              const isSelf = u.id === profile?.id;
              const accessOpen = accessUserId === u.id;
              return (
                <React.Fragment key={u.id + "-" + i}>
                <tr className={"transition-colors hover:bg-[#faf8f4] " + (i > 0 && !accessOpen ? "border-t border-[#f0ece4]" : "")}>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <Avatar name={u.name} size="md" src={u.avatar_url ?? null} />
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 font-medium text-zinc-800">
                          <span className="truncate">{u.name}</span>
                          {isSelf ? <span className="shrink-0 text-[10px] uppercase tracking-wide text-zinc-400">you</span> : null}
                          {u.role === "owner" ? <span className="shrink-0 rounded-md bg-zinc-900 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-white">admin</span> : null}
                        </div>
                        <div className="truncate text-xs text-zinc-400">{u.email || "—"}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    {!isSelf ? (
                      <div className="flex flex-col items-start gap-1.5">
                        <Select value={u.role} onChange={(e) => void setRole(u.id, e.target.value)} className="!w-auto px-2 py-1 text-xs">
                          <option value="owner">admin — full control</option>
                          <option value="editor">editor — all tabs, edit</option>
                          <option value="viewer">custom — pick tabs below</option>
                        </Select>
                        {u.role === "viewer" ? (
                          <button onClick={() => setAccessUserId((v) => (v === u.id ? null : u.id))} className="text-[11px] font-medium text-blue-600 hover:underline">
                            {accessSummary(u)} — {accessUserId === u.id ? "hide" : "edit access"}
                          </button>
                        ) : null}
                      </div>
                    ) : (
                      <Pill tone="blue">admin · this is you</Pill>
                    )}
                  </td>
                  <td className="hidden px-6 py-4 text-xs text-zinc-500 sm:table-cell">{last}</td>
                  <td className="px-6 py-4 text-right">
                    {isSelf ? null : (
                      <KebabMenu
                        items={[
                          { label: "Set password", onSelect: () => setPwUser(u) },
                          ...(u.role === "viewer" ? [{ label: "Edit tab access", onSelect: () => setAccessUserId(accessOpen ? null : u.id) }] : []),
                          { label: "Delete account", icon: <Trash2 size={13} />, danger: true, onSelect: () => void deleteUser(u.id, u.name) },
                        ]}
                      />
                    )}
                  </td>
                </tr>
                {accessOpen && u.role === "viewer" ? (
                  <tr className="bg-[#faf8f4]">
                    <td colSpan={4} className="px-6 pb-5 pt-1">
                      <div className="rounded-xl border border-[#eae4d9] bg-white p-4">
                        <div className="mb-1 flex items-center justify-between gap-3">
                          <span className="text-[12px] font-semibold text-zinc-900">Tab access — {u.name}</span>
                          <button onClick={() => setAccessUserId(null)} className="text-[11px] font-medium text-zinc-400 transition-colors hover:text-zinc-700" aria-label="Close access editor">
                            ✕
                          </button>
                        </div>
                        <p className="mb-3 text-[11px] text-zinc-400">Choose what this account can see. Tabs set to “No access” are hidden from their navigation entirely.</p>
                        <InlineAccessEditor userId={u.id} initial={u.tab_access ?? {}} onSave={saveAccess} onDone={() => setAccessUserId(null)} />
                      </div>
                    </td>
                  </tr>
                ) : null}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </SectionCard>

      {notConfigured ? (
        <Card className="border-amber-200 bg-amber-50 p-5">
          <MicroLabel className="!text-amber-800">One-time server setup needed</MicroLabel>
          <p className="mt-2 text-xs text-amber-800">
            Account creation runs on the server with the Supabase service key. Add this line to the file <code className="rounded bg-amber-100 px-1">.env.local</code> in the project folder, then restart the app:
          </p>
          <pre className="mt-2 overflow-x-auto rounded-lg bg-zinc-900 p-3 text-[11px] text-zinc-100">SUPABASE_SERVICE_ROLE_KEY=your-service-role-key</pre>
          <p className="mt-2 text-xs text-amber-800">
            Get the key from the Supabase Dashboard → Project Settings → API keys → <b>service_role</b>. It stays on the server and is never shown in the browser.
          </p>
        </Card>
      ) : null}

      <Modal open={addOpen} onClose={() => setAddOpen(false)} title="Create account" wide>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Rahim" />
          </div>
          <div>
            <Label>Email</Label>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="rahim@company.com" />
          </div>
          <div>
            <Label>Password</Label>
            <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="minimum 6 characters" />
          </div>
        </div>
        <div className="mt-4">
          <Label>Role</Label>
          <div className="grid gap-2 sm:grid-cols-3">
            {(["editor", "viewer", "owner"] as const).map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setNewRole(r)}
                className={
                  "rounded-xl border px-4 py-3 text-left transition-all " +
                  (newRole === r ? "border-zinc-900 bg-[#f4efe8]" : "border-[#e5e5e2] bg-white hover:border-zinc-400")
                }
              >
                <span className={"block text-sm font-semibold " + (newRole === r ? "text-zinc-900" : "text-zinc-700")}>
                  {r === "owner" ? "Admin" : r === "editor" ? "Editor" : "Custom"}
                </span>
                <span className="mt-0.5 block text-[11px] leading-snug text-zinc-400">
                  {r === "owner" ? "Full control + users" : r === "editor" ? "All tabs, edit everything" : "Pick visible tabs below"}
                </span>
              </button>
            ))}
          </div>
        </div>
        {newRole === "viewer" ? (
          <div className="mt-4">
            <Label>Tab access</Label>
            <div className="space-y-1.5">
              {TAB_DEFS.map((t) => (
                <div key={t.key} className="flex items-center justify-between gap-3 rounded-lg border border-[#e9e9e6] bg-white px-3.5 py-2.5">
                  <span className="text-xs font-medium text-zinc-700">{t.label}</span>
                  <div className="flex gap-1">
                    {ACCESS_LEVELS.map((lvl) => (
                      <button
                        key={lvl.key}
                        type="button"
                        onClick={() => setNewAccess((prev) => ({ ...prev, [t.key]: lvl.key }))}
                        className={
                          "rounded-full px-2.5 py-1 text-[11px] font-medium transition-all " +
                          ((newAccess[t.key] ?? "none") === lvl.key
                            ? "bg-zinc-900 text-white"
                            : "border border-[#e5e5e2] bg-white text-zinc-500 hover:border-zinc-400")
                        }
                      >
                        {lvl.label}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}
        <div className="mt-5 flex justify-end gap-2 border-t border-[#f0ece4] pt-4">
          <Button onClick={() => setAddOpen(false)}>Cancel</Button>
          <Button variant="primary" disabled={busy || !email.trim() || password.length < 6} onClick={() => void createUser()}>
            {busy ? "Creating…" : "Create account"}
          </Button>
        </div>
      </Modal>

      <PasswordModal user={pwUser} onClose={() => setPwUser(null)} onSave={savePassword} />
    </div>
  );
}

/** Inline tab-access editor — expands under the user row, no popup. */
function InlineAccessEditor({
  userId,
  initial,
  onSave,
  onDone,
}: {
  userId: string;
  initial: Record<string, string>;
  onSave: (userId: string, access: Record<string, string>) => void;
  onDone: () => void;
}) {
  const [access, setAccess] = useState<Record<string, string>>({ ...initial });
  const [busy, setBusy] = useState(false);

  return (
    <div className="space-y-1.5">
      {TAB_DEFS.map((t) => (
        <div key={t.key} className="flex items-center justify-between gap-3 rounded-lg border border-[#e9e9e6] bg-white px-3.5 py-2.5">
          <span className="text-xs font-medium text-zinc-700">{t.label}</span>
          <div className="flex gap-1">
            {ACCESS_LEVELS.map((lvl) => (
              <button
                key={lvl.key}
                type="button"
                onClick={() => setAccess((prev) => ({ ...prev, [t.key]: lvl.key }))}
                className={
                  "rounded-full px-2.5 py-1 text-[11px] font-medium transition-all " +
                  ((access[t.key] ?? "none") === lvl.key ? "bg-zinc-900 text-white" : "border border-[#e5e5e2] bg-white text-zinc-500 hover:border-zinc-400")
                }
              >
                {lvl.label}
              </button>
            ))}
          </div>
        </div>
      ))}
      <div className="mt-3 flex justify-end gap-2">
        <Button onClick={onDone}>Cancel</Button>
        <Button
          variant="primary"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            onSave(userId, access);
            onDone();
          }}
        >
          {busy ? "Saving…" : "Save access"}
        </Button>
      </div>
    </div>
  );
}

function PasswordModal({
  user,
  onClose,
  onSave,
}: {
  user: UserRowX | null;
  onClose: () => void;
  onSave: (userId: string, pw: string, userName: string) => void;
}) {
  const [pw, setPw] = useState("");
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (user) {
      setPw("");
      setShow(false);
    }
  }, [user]);

  if (!user) return null;

  return (
    <Modal open={!!user} onClose={onClose} title={"Set password — " + user.name}>
      <p className="mb-3 text-xs text-zinc-500">Passwords are stored encrypted by Supabase and cannot be viewed — only replaced with a new one.</p>
      <Label>New password</Label>
      <div className="relative">
        <Input type={show ? "text" : "password"} value={pw} onChange={(e) => setPw(e.target.value)} placeholder="minimum 6 characters" className="pr-16" />
        <button
          type="button"
          onClick={() => setShow((s) => !s)}
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md px-2 py-1 text-[11px] font-semibold text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900"
        >
          {show ? "Hide" : "Show"}
        </button>
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" disabled={pw.length < 6} onClick={() => { onSave(user.id, pw, user.name); onClose(); }}>Save password</Button>
      </div>
    </Modal>
  );
}

/* ─────────────────────────── General (books) ─────────────────────────── */

function GeneralSection({ db, setDb, onToast }: { db: Database; setDb: React.Dispatch<React.SetStateAction<Database | null>>; onToast: (m: string) => void }) {
  const [target, setTarget] = useState(String(db.settings.monthly_income_target));
  const [profitTarget, setProfitTarget] = useState(String(db.settings.monthly_profit_target ?? 0));
  const [expenseTarget, setExpenseTarget] = useState(String(db.settings.monthly_expense_target ?? 0));

  function saveTargets() {
    const income = parseFloat(target);
    const profit = parseFloat(profitTarget);
    const expense = parseFloat(expenseTarget);
    if (isNaN(income) || income < 0) return;
    setDb((prev) =>
      prev
        ? {
            ...prev,
            settings: {
              ...prev.settings,
              monthly_income_target: income,
              monthly_profit_target: isNaN(profit) || profit < 0 ? 0 : profit,
              monthly_expense_target: isNaN(expense) || expense < 0 ? 0 : expense,
            },
          }
        : prev
    );
    appendNotif("settings", "Monthly targets updated", "general settings");
    onToast("Targets saved");
  }

  return (
    <div className={WIDE + " space-y-5"}>
      <SectionCard title="Monthly targets" hint="Drives the dashboard target ring, pace calculation and chart overlays." icon={<Target size={13} />}>
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <Label>Income target (AED)</Label>
            <Input type="number" min="0" value={target} onChange={(e) => setTarget(e.target.value)} />
          </div>
          <div>
            <Label>Profit target (AED)</Label>
            <Input type="number" min="0" value={profitTarget} onChange={(e) => setProfitTarget(e.target.value)} />
          </div>
          <div>
            <Label>Expense target (AED)</Label>
            <Input type="number" min="0" value={expenseTarget} onChange={(e) => setExpenseTarget(e.target.value)} />
          </div>
        </div>
        <div className="mt-5 flex justify-end">
          <Button variant="primary" onClick={saveTargets}>Save targets</Button>
        </div>
      </SectionCard>

      <CollectionEditor />
    </div>
  );
}

function CollectionEditor() {
  const { db, setDb } = useDb();
  const [editorFor, setEditorFor] = useState<"categories" | "methods">("categories");
  const [newName, setNewName] = useState("");
  const [kind, setKind] = useState<"income" | "expense">("expense");

  const items = editorFor === "categories" ? db.categories.filter((c) => c.id !== "c_fuel" && c.id !== "c_vehicles") : db.payment_methods;

  function addItem() {
    if (!newName.trim()) return;
    if (editorFor === "categories") {
      setDb((prev) => (prev ? upsertCategory(prev, { id: "c_" + Date.now().toString(36), name: newName, kind }) : prev));
    } else {
      setDb((prev) => (prev ? upsertPaymentMethod(prev, { id: "pm_" + Date.now().toString(36), name: newName }) : prev));
    }
    appendNotif("settings", (editorFor === "categories" ? "Category added — " : "Payment method added — ") + newName, "books settings");
    setNewName("");
  }

  function rename(id: string, value: string) {
    setDb((prev) => {
      if (!prev) return prev;
      if (editorFor === "categories") {
        const c = prev.categories.find((x) => x.id === id);
        return c ? upsertCategory(prev, { ...c, name: value }) : prev;
      }
      const pm = prev.payment_methods.find((x) => x.id === id);
      return pm ? upsertPaymentMethod(prev, { ...pm, name: value }) : prev;
    });
  }

  function archive(id: string, archived: boolean) {
    const table = editorFor === "methods" ? "payment_methods" : editorFor;
    setDb((prev) => (prev ? archiveRef(prev, table, id, archived) : prev));
    appendNotif("settings", (archived ? "Archived — " : "Restored — ") + items.find((x) => x.id === id)?.name, "books settings");
  }

  return (
    <SectionCard
      title={editorFor === "categories" ? "Categories" : "Payment methods"}
      hint={editorFor === "categories" ? "Rename, archive or add. Fuel and Vehicles live on the Fleet page." : "Bank transfers, cash, POS and anything you pay with."}
      icon={editorFor === "categories" ? <DatabaseIcon size={13} /> : <Settings2 size={13} />}
      right={
        <Segmented
          size="sm"
          value={editorFor}
          onChange={setEditorFor}
          options={[["categories", "Categories"], ["methods", "Payment methods"]]}
        />
      }
      flush
    >
      <div className="flex flex-wrap items-end gap-3 px-6 py-4">
        {editorFor === "categories" && (
          <div className="w-32">
            <Label>Kind</Label>
            <Select value={kind} onChange={(e) => setKind(e.target.value as "income" | "expense")}>
              <option value="expense">Expense</option>
              <option value="income">Income</option>
            </Select>
          </div>
        )}
        <div className="w-52">
          <Label>Name</Label>
          <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder={editorFor === "categories" ? "e.g. Transport" : "e.g. Janata"} />
        </div>
        <Button variant="primary" onClick={addItem}>Add</Button>
      </div>
      <table className="w-full text-[13px]">
        <thead>
          <tr className="border-t border-b border-[#eae4d9] bg-white text-left text-[10px] uppercase tracking-wider text-zinc-400">
            <th className="px-6 py-2.5 font-semibold">Name</th>
            <th className="px-6 py-2.5 text-right font-semibold">Status</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item, i) => {
            const archived = item.archived ?? false;
            return (
              <tr key={item.id} className={"transition-colors hover:bg-[#faf8f4] " + (i > 0 ? "border-t border-[#f0ece4]" : "")}>
                <td className="px-6 py-3">
                  <input
                    value={item.name}
                    onChange={(e) => rename(item.id, e.target.value)}
                    className={"w-full max-w-sm rounded-md border border-transparent px-2 py-1.5 text-[13px] hover:border-zinc-200 focus:border-zinc-400 focus:outline-none " + (archived ? "text-zinc-300" : "text-zinc-800")}
                  />
                </td>
                <td className="px-6 py-3">
                  <div className="flex items-center justify-end gap-2">
                    <Pill tone={archived ? "amber" : "emerald"}>{archived ? "Archived" : "Active"}</Pill>
                    <KebabMenu items={[{ label: archived ? "Restore" : "Archive", onSelect: () => archive(item.id, !archived) }]} />
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </SectionCard>
  );
}

/* ───────────────────────────── Data tools ────────────────────────────── */

function DataSection({ db, setDb, signedIn, onToast }: { db: Database; setDb: React.Dispatch<React.SetStateAction<Database | null>>; signedIn: boolean; onToast: (m: string) => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [confirmReset, setConfirmReset] = useState(false);

  function exportJson() {
    const blob = new Blob([JSON.stringify(db, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "axl-books-backup-" + todayISO() + ".json";
    a.click();
    URL.revokeObjectURL(a.href);
    onToast("Backup downloaded");
  }

  function importJson(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result)) as Database;
        if (!parsed.transactions || !Array.isArray(parsed.transactions)) throw new Error("bad file");
        setDb(parsed);
        appendNotif("sync", "Backup restored (" + parsed.transactions.length + " transactions)", "data tools");
        onToast("Backup restored (" + parsed.transactions.length + " transactions)");
      } catch {
        onToast("Import failed — not a valid backup file");
      }
    };
    reader.readAsText(file);
  }

  function loadDemo() {
    setDb((prev) => {
      if (!prev) return prev;
      let next = prev;
      for (let i = 0; i < 60; i++) {
        const day = 1 + (i % 28);
        const iso = todayISO().slice(0, 8) + String(day).padStart(2, "0");
        if (i % 3 === 0) {
          next = addTransaction(next, {
            kind: "income",
            txn_date: iso,
            amount: 500 + ((i * 7919) % 9000),
            category_id: "c_general",
            payment_method_id: ["pm_adcb", "pm_cash", "pm_pos"][i % 3],
            job_ref: "AY" + (20000 + ((i * 3571) % 999)),
            description: ["Gate works", "Material sale", "Fabrication", "Door repair"][i % 4],
            created_by: "u_owner",
          });
        } else {
          const fuel = i % 7 === 0;
          next = addTransaction(next, {
            kind: "expense",
            txn_date: iso,
            amount: fuel ? 100 + ((i * 13) % 150) : 55 + ((i * 4523) % 3000),
            category_id: fuel ? "c_fuel" : "c_materials",
            payment_method_id: fuel ? "pm_cash" : "pm_adcb",
            description: fuel ? "Diesel / petrol" : "Aluminium & steel",
            created_by: "u_owner",
          });
        }
      }
      return next;
    });
    onToast("Demo data loaded — explore the dashboard, fuel heatmap and rankings");
  }

  function resetAll() {
    setDb(freshDb());
    onToast("Reset to fresh books");
  }

  async function resetCloud() {
    const sb = getSupabase();
    const { error } = await sb.from("transactions").delete().neq("id", "");
    setConfirmReset(false);
    if (error) {
      onToast("Reset failed: " + error.message);
      return;
    }
    setDb((prev) => (prev ? { ...prev, transactions: [] } : prev));
    appendNotif("sync", "All transactions deleted from the cloud", "data tools");
    onToast("All transactions deleted from the cloud");
  }

  return (
    <div className={NARROW + " space-y-5"}>
      <SectionCard title="Backup & restore" hint="Download regular backups; the JSON restores exactly." icon={<DatabaseIcon size={13} />} flush>
        <Row first title="Download backup" desc="One JSON file with every transaction, category, vehicle and setting.">
          <Button onClick={exportJson}>Download (JSON)</Button>
        </Row>
        <Row title="Restore from backup" desc="Replaces everything in this books file with the backup’s contents.">
          <Button onClick={() => fileRef.current?.click()}>Restore backup</Button>
          <input ref={fileRef} type="file" accept="application/json" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) importJson(f); e.target.value = ""; }} />
        </Row>
      </SectionCard>

      <SectionCard title="Tools" hint="Utilities and reset actions." icon={<Settings2 size={13} />} flush>
        <Row first title="Demo data" desc="Loads 60 realistic entries to explore the dashboard, fuel heatmap and rankings.">
          <Button onClick={loadDemo}>Load demo data</Button>
        </Row>
        {signedIn ? (
          <Row title="Reset ALL books (cloud)" desc="Danger: permanently deletes every transaction for the whole team.">
            <Button variant="danger" onClick={() => setConfirmReset(true)}>Reset cloud books</Button>
          </Row>
        ) : (
          <Row title="Reset to fresh books" desc="Clears everything you entered and starts from the seeded categories.">
            <Button variant="danger" onClick={resetAll}>Reset books</Button>
          </Row>
        )}
      </SectionCard>

      <ConfirmDelete
        open={confirmReset}
        onClose={() => setConfirmReset(false)}
        label="delete EVERY transaction from the cloud database"
        onConfirm={() => void resetCloud()}
      />
    </div>
  );
}
