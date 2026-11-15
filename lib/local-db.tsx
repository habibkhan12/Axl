"use client";
import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import type { Database, Role, TabAccess, TabAccessMap, TabKey } from "./types";
import { freshDb } from "./seed";
import { STORAGE_KEY, normalizeDb } from "./store";
import { getSupabase, SUPABASE_READY } from "./supabase";
import { ADMIN_EMAIL } from "./admin";
import { loadCloudDb, updateSettings, getSchemaIssues } from "./supabase-db";
import { appendNotif } from "./notifications";

interface Profile {
  id: string;
  name: string;
  role: Role;
  tab_access?: TabAccessMap | null;
  avatar_url?: string | null;
}

/** Tabs a restricted (non-admin) account can see — used to filter the sidebar nav. */
const TAB_PAGES: Record<Exclude<TabKey, "settings">, string> = {
  dashboard: "/",
  transactions: "/transactions",
  suppliers: "/suppliers",
  clients: "/clients",
  quotes: "/quotes",
  fleet: "/fleet",
  personnel: "/personnel",
  dues: "/dues",
};

export function tabAccessOf(profile: Profile | null, role: Role, tab: Exclude<TabKey, "settings">): TabAccess {
  if (role === "owner" || role === "editor") return "edit";
  if (!profile?.tab_access) {
    // Backward compat: legacy viewers with no tab_access get read access to
    // the original tabs; the Dues tab is opt-in (default hidden).
    return tab === "dues" ? "none" : "view";
  }
  return profile.tab_access[tab] ?? (tab === "dues" ? "none" : "view");
}

export function canViewPage(pathname: string, profile: Profile | null, role: Role): boolean {
  if (role === "owner") return true;
  if (pathname === "/settings") return true; // every account can open Settings (own details, password, notifications)
  const entry = (Object.entries(TAB_PAGES) as [Exclude<TabKey, "settings">, string][]).find(([, href]) => href === pathname);
  if (!entry) return true; // unknown routes stay visible
  return tabAccessOf(profile, role, entry[0]) !== "none";
}

export function canEditPage(pathname: string, profile: Profile | null, role: Role): boolean {
  if (role === "owner" || role === "editor") return true;
  if (pathname === "/settings") return false;
  const entry = (Object.entries(TAB_PAGES) as [Exclude<TabKey, "settings">, string][]).find(([, href]) => href === pathname);
  if (!entry) return false;
  return tabAccessOf(profile, role, entry[0]) === "edit";
}

/** Result of the last cloud write, so the UI can show whether a save landed. */
export interface SaveState {
  saving: boolean;
  error: string | null;
  savedAt: number | null;
}

interface DbContextValue {
  db: Database | null;
  hydrated: boolean;
  authChecked: boolean;
  setDb: React.Dispatch<React.SetStateAction<Database | null>>;
  saveState: SaveState;
  retrySave: () => void;
  /** Objects the deployed database is missing (e.g. the parties table). */
  schemaIssues: string[];
  session: Session | null;
  profile: Profile | null;
  role: Role;
  canWrite: boolean;
  tabAccess: (tab: Exclude<TabKey, "settings">) => TabAccess;
  canView: (pathname: string) => boolean;
  canEdit: (pathname: string) => boolean;
  signIn: (email: string, password: string) => Promise<string | null>;
  signUp: (email: string, password: string, name: string) => Promise<string | null>;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
}

const DbContext = createContext<DbContextValue>({
  db: null,
  hydrated: false,
  authChecked: false,
  setDb: () => {},
  saveState: { saving: false, error: null, savedAt: null },
  retrySave: () => {},
  schemaIssues: [],
  session: null,
  profile: null,
  role: "viewer",
  canWrite: false,
  tabAccess: () => "none",
  canView: () => false,
  canEdit: () => false,
  signIn: async () => "not ready",
  signUp: async () => "not ready",
  signOut: async () => {},
  refresh: async () => {},
});

function readLocalDb(): Database | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Database;
    if (!parsed || !Array.isArray(parsed.transactions)) return null;
    // Databases written before suppliers/clients existed have no `parties`.
    return normalizeDb(parsed);
  } catch {
    return null;
  }
}

export function DbProvider({ children }: { children: React.ReactNode }) {
  const [db, setDb] = useState<Database | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>({ saving: false, error: null, savedAt: null });
  const [schemaIssues, setSchemaIssues] = useState<string[]>([]);

  // Auth session listener — hard-capped so the app can never hang on startup.
  useEffect(() => {
    const sb = getSupabase();
    let done = false;
    const finish = (s: Session | null) => {
      if (!done) {
        done = true;
        setSession(s);
        setAuthChecked(true);
      }
    };
    const timer = setTimeout(() => finish(null), 5000); // treat a stuck check as signed-out
    sb.auth
      .getSession()
      .then(({ data }) => finish(data.session ?? null))
      .catch(() => finish(null));
    const { data: sub } = sb.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
      setAuthChecked(true);
    });
    return () => {
      clearTimeout(timer);
      sub.subscription.unsubscribe();
    };
  }, []);

  // Load data: cloud when signed in, local otherwise
  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (session) {
        // Production: retry transient failures before falling back — silently
        // switching to a stale localStorage copy risks showing (and later
        // diff-syncing) outdated data.
        let cloud: Database | null = null;
        let lastErr: unknown = null;
        for (let attempt = 0; attempt < 3 && !cancelled; attempt++) {
          try {
            cloud = await loadCloudDb();
            break;
          } catch (e) {
            lastErr = e;
            await new Promise((r) => setTimeout(r, 1200 * (attempt + 1)));
          }
        }
        if (cloud && !cancelled) {
          setSchemaIssues(getSchemaIssues());
          setDb(cloud);
        } else if (!cancelled) {
          console.error("Cloud load failed after retries:", lastErr);
          appendNotif("sync", "Cloud load failed — showing last saved copy", lastErr instanceof Error ? lastErr.message : "network error");
          const local = readLocalDb() ?? freshDb();
          setDb(local);
        }
      } else {
        const local = readLocalDb() ?? freshDb();
        if (!readLocalDb()) {
          window.localStorage.setItem(STORAGE_KEY, JSON.stringify(local));
        }
        setDb(local);
      }
      if (!cancelled) setHydrated(true);
    }
    if (authChecked) load();
    return () => {
      cancelled = true;
    };
  }, [session, authChecked]);

  const authCheckedRef = React.useRef(authChecked);
  authCheckedRef.current = authChecked;

  // Load own profile (self-heal via ensure_my_profile if the row is missing)
  useEffect(() => {
    if (!session) {
      setProfile(null);
      return;
    }
    let cancelled = false;
    const sb = getSupabase();
    (async () => {
      const fallback: Profile = {
        id: session.user.id,
        name: session.user.user_metadata?.name ?? "User",
        role: "viewer",
      };
      // Hardcoded admin: always self-heal to owner via the server.
      const email = (session.user.email ?? "").trim().toLowerCase();
      if (email === ADMIN_EMAIL) {
        try {
          const res = await fetch("/api/auth/ensure-admin", {
            method: "POST",
            headers: { Authorization: "Bearer " + (session.access_token ?? "") },
          });
          if (res.ok) {
            if (!cancelled)
              setProfile({ id: session.user.id, name: session.user.user_metadata?.name ?? email.split("@")[0], role: "owner" });
            return;
          }
        } catch {
          /* fall through to normal profile loading */
        }
      }
      // everyone else: plain read first (includes tab_access), then self-healing RPC, then a retry
      for (let attempt = 0; attempt < 2 && !cancelled; attempt++) {
        const { data: row } = await sb.from("profiles").select("id, name, role, tab_access").eq("id", session.user.id).maybeSingle();
        if (row) {
          if (!cancelled) setProfile(row as Profile);
          return;
        }
        const { data, error } = await sb.rpc("ensure_my_profile", {
          p_name: session.user.user_metadata?.name ?? null,
        });
        if (!error && data) {
          if (!cancelled) setProfile({ ...fallback, role: data as Role });
          return;
        }
        await new Promise((r) => setTimeout(r, 1500));
      }
      if (!cancelled) setProfile(fallback);
    })();
    return () => {
      cancelled = true;
    };
  }, [session]);

  async function signIn(email: string, password: string): Promise<string | null> {
    const { error } = await getSupabase().auth.signInWithPassword({ email, password });
    return error ? error.message : null;
  }

  async function signUp(email: string, password: string, name: string): Promise<string | null> {
    const { error } = await getSupabase().auth.signUp({
      email,
      password,
      options: { data: { name } },
    });
    return error ? error.message : null;
  }

  async function signOut() {
    await getSupabase().auth.signOut();
    setSession(null);
    setProfile(null);
    const local = readLocalDb() ?? freshDb();
    setDb(local);
    setHydrated(true);
  }

  async function refresh() {
    if (!session) return;
    const cloud = await loadCloudDb();
    setSchemaIssues(getSchemaIssues());
    setDb(cloud);
  }

  /** Re-send the diff for the current state — used by the "Not saved" banner. */
  function retrySave() {
    if (!session) return;
    setSaveState((s) => ({ ...s, saving: true, error: null }));
    setDb((prev) => (prev ? { ...prev } : prev));
  }

  // "axl-profile-updated" — fired after the user changes their own name/avatar
  // in Settings so every open surface (sidebar, avatar menus) reloads instantly.
  useEffect(() => {
    const handler = () => {
      if (!session) return;
      const sb = getSupabase();
      void sb.from("profiles").select("id, name, role, tab_access, avatar_url").eq("id", session.user.id).maybeSingle().then(({ data }) => {
        if (data) setProfile(data as Profile);
      });
    };
    window.addEventListener("axl-profile-updated", handler);
    return () => window.removeEventListener("axl-profile-updated", handler);
  }, [session]);

  // Keep the last snapshot we successfully loaded/pushed so we can diff changes.
  const snapshotRef = React.useRef<Database | null>(null);
  const syncingRef = React.useRef(false);
  const pendingRef = React.useRef(false);

  // Notification log: diff db against the snapshot and record every change.
  const notifSnapshotRef = React.useRef<Database | null>(null);
  React.useEffect(() => {
    if (!db || !hydrated) return;
    const before = notifSnapshotRef.current;
    notifSnapshotRef.current = db;
    if (!before || before === db) return;
    const who = profile?.name ?? "Someone";

    // transactions
    const beforeTx = new Map(before.transactions.map((t) => [t.id, t] as const));
    const afterTx = new Map(db.transactions.map((t) => [t.id, t] as const));
    for (const t of db.transactions) {
      const prev = beforeTx.get(t.id);
      if (!prev) {
        appendNotif("transaction", (t.kind === "income" ? "Income" : "Expense") + " added — " + (t.description || "entry"), who + " · AED " + t.amount.toFixed(2) + (t.txn_date ? " · " + t.txn_date : ""), "/transactions#txn-" + t.id);
      } else if (prev !== t && JSON.stringify(prev) !== JSON.stringify(t)) {
        const changes: string[] = [];
        if (prev.amount !== t.amount) changes.push("AED " + prev.amount.toFixed(2) + " → " + t.amount.toFixed(2));
        if (prev.txn_date !== t.txn_date) changes.push("date " + prev.txn_date + " → " + t.txn_date);
        if (prev.description !== t.description) changes.push("description");
        if (prev.category_id !== t.category_id) changes.push("category");
        if (!changes.length) changes.push("details");
        appendNotif("transaction", "Entry edited — " + (t.description || prev.description || "entry"), who + " · " + changes.join(", "), "/transactions#txn-" + t.id);
      }
    }
    for (const t of before.transactions) {
      if (!afterTx.has(t.id)) appendNotif("transaction", "Entry deleted — " + (t.description || "entry"), who + " · AED " + t.amount.toFixed(2), "/transactions");
    }

    // reference data
    type RefRow = { id: string; name?: string; label?: string; archived?: boolean };
    const refSets: { label: string; b: RefRow[]; a: RefRow[] }[] = [
      { label: "category", b: before.categories, a: db.categories },
      { label: "vehicle", b: before.vehicles, a: db.vehicles },
      { label: "payment method", b: before.payment_methods, a: db.payment_methods },
    ];
    for (const { label, b, a } of refSets) {
      const bMap = new Map(b.map((r) => [r.id, r] as const));
      const aMap = new Map(a.map((r) => [r.id, r] as const));
      for (const r of a) {
        const prev = bMap.get(r.id);
        const refHref = label === "vehicle" ? "/fleet#car-" + r.id : "/settings";
        if (!prev) appendNotif("ref", label.charAt(0).toUpperCase() + label.slice(1) + " added — " + (r.name ?? r.label), who, refHref);
        else if (JSON.stringify(prev) !== JSON.stringify(r)) {
          const name = r.name ?? r.label;
          const wasArchived = !prev.archived && !!r.archived;
          const wasRestored = !!prev.archived && !r.archived;
          appendNotif("ref", wasArchived ? label.charAt(0).toUpperCase() + label.slice(1) + " archived — " + name : wasRestored ? label.charAt(0).toUpperCase() + label.slice(1) + " restored — " + name : label.charAt(0).toUpperCase() + label.slice(1) + " updated — " + name, who, refHref);
        }
      }
      for (const r of b) if (!aMap.has(r.id)) appendNotif("ref", label.charAt(0).toUpperCase() + label.slice(1) + " deleted — " + (r.name ?? r.label), who, label === "vehicle" ? "/fleet" : "/settings");
    }

    // settings
    if (
      before.settings.monthly_income_target !== db.settings.monthly_income_target ||
      before.settings.monthly_profit_target !== db.settings.monthly_profit_target ||
      before.settings.monthly_expense_target !== db.settings.monthly_expense_target
    ) {
      appendNotif("settings", "Monthly target updated", who + " · AED " + before.settings.monthly_income_target + " → " + db.settings.monthly_income_target, "/settings");
    }
  }, [db, hydrated, profile?.name]);

  React.useEffect(() => {
    if (!db) return;
    if (!session) {
      // local mode: persist to localStorage
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
      snapshotRef.current = db;
      return;
    }
    // Cloud mode: always persist locally first so nothing is lost if the
    // browser closes mid-sync — then push the diff to Supabase.
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(db));

    const before = snapshotRef.current;
    if (!before) {
      snapshotRef.current = db;
      return;
    }
    if (syncingRef.current) {
      // A sync is running — remember there is newer data and re-run after.
      pendingRef.current = true;
      return;
    }
    syncingRef.current = true;
    setSaveState((s) => ({ ...s, saving: true }));
    void (async () => {
      const sb = getSupabase();
      // Supabase returns errors instead of throwing — every write below is
      // checked so a rejected save can never look like a successful one.
      const check = (label: string, error: { message?: string } | null) => {
        if (error) throw new Error(label + " — " + (error.message ?? "write failed"));
      };
      try {
        // --- transactions: inserts, deletes, updates ---
        const beforeTx = new Map(before.transactions.map((t) => [t.id, t]));
        const afterTx = new Map(db.transactions.map((t) => [t.id, t]));
        const inserted = db.transactions.filter((t) => !beforeTx.has(t.id));
        const deleted = before.transactions.filter((t) => !afterTx.has(t.id));
        const updated = db.transactions.filter((t) => {
          const prev = beforeTx.get(t.id);
          return prev && prev !== t && JSON.stringify(prev) !== JSON.stringify(t);
        });
        if (inserted.length) {
          const { error } = await sb.from("transactions").insert(inserted);
          check("Could not save the new entry", error);
        }
        if (deleted.length) {
          const { error } = await sb.from("transactions").delete().in("id", deleted.map((t) => t.id));
          check("Could not delete the entry", error);
        }
        for (const t of updated) {
          // Field-level patch: push only the fields that actually changed so a
          // stale snapshot can never overwrite a teammate's concurrent edits
          // to other fields of the same row.
          const prev = beforeTx.get(t.id)!;
          const patch: Record<string, unknown> = {};
          for (const key of Object.keys(t) as (keyof typeof t)[]) {
            if (key === "id") continue;
            if (JSON.stringify(prev[key]) !== JSON.stringify(t[key])) patch[key] = t[key];
          }
          patch.updated_at = new Date().toISOString();
          const { error } = await sb.from("transactions").update(patch).eq("id", t.id);
          check("Could not update the entry", error);
        }

        // --- reference tables: upserts and deletes by id ---
        const refTables = [
          ["categories", before.categories, db.categories],
          ["parties", before.parties, db.parties],
          ["quotes", before.quotes, db.quotes],
          ["staff", before.staff, db.staff],
          ["staff_documents", before.staff_documents, db.staff_documents],
          ["staff_overtime", before.staff_overtime, db.staff_overtime],
          ["staff_leaves", before.staff_leaves, db.staff_leaves],
          ["staff_fines", before.staff_fines, db.staff_fines],
          ["staff_transactions", before.staff_transactions, db.staff_transactions],
          ["vehicles", before.vehicles, db.vehicles],
          ["payment_methods", before.payment_methods, db.payment_methods],
        ] as const;
        for (const [table, b, a] of refTables) {
          const beforeMap = new Map(b.map((r) => [r.id, r]));
          const afterMap = new Map(a.map((r) => [r.id, r]));
          const ups = a.filter((r) => {
            const prev = beforeMap.get(r.id);
            return !prev || JSON.stringify(prev) !== JSON.stringify(r);
          });
          const dels = b.filter((r) => !afterMap.has(r.id));
          if (ups.length) {
            const { error } = await sb.from(table).upsert(ups, { onConflict: "id" });
            check("Could not save " + table.replace("_", " "), error);
          }
          if (dels.length) {
            const { error } = await sb.from(table).delete().in("id", dels.map((r) => r.id));
            check("Could not delete from " + table.replace("_", " "), error);
          }
        }

        // --- settings ---
        if (JSON.stringify(before.settings) !== JSON.stringify(db.settings)) {
          const settingsErr = await updateSettings(db.settings);
          check("Could not save settings", settingsErr ? { message: settingsErr } : null);
        }

        snapshotRef.current = db;
        setSaveState({ saving: false, error: null, savedAt: Date.now() });
      } catch (e) {
        // On failure keep the edit and the snapshot so the retry sends the same
        // diff — but say so loudly instead of reporting a save that never happened.
        const message = e instanceof Error ? e.message : "network error";
        console.error("Cloud save failed:", e);
        setSaveState((s) => ({ ...s, saving: false, error: message }));
        appendNotif("sync", "Save failed — retrying", message);
        // Retry shortly so offline-then-online recovers without a new edit.
        setTimeout(() => setDb((prev) => (prev ? { ...prev } : prev)), 8000);
      } finally {
        syncingRef.current = false;
        if (pendingRef.current) {
          pendingRef.current = false;
          // Changes arrived while syncing — nudge the effect to diff them now.
          setTimeout(() => setDb((prev) => (prev ? { ...prev } : prev)), 0);
        }
      }
    })();
  }, [db, session]);

  // Reset the snapshot whenever the data source changes (login/logout/refresh)
  React.useEffect(() => {
    snapshotRef.current = db;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  // Local mode has no signed-in profile; act as the seeded user picked in the
  // sidebar so the app isn't stuck read-only when Supabase isn't configured.
  const localProfile: Profile | null =
    !SUPABASE_READY && db
      ? (() => {
          const u = db.users.find((x) => x.id === db.settings.active_user_id) ?? db.users[0];
          return u ? { id: u.id, name: u.name, role: u.role } : null;
        })()
      : null;
  const effectiveProfile = profile ?? localProfile;
  const role: Role = effectiveProfile?.role ?? "viewer";
  const value = useMemo<DbContextValue>(
    () => ({
      db,
      hydrated,
      authChecked,
      setDb,
      saveState,
      retrySave,
      schemaIssues,
      session,
      profile: effectiveProfile,
      role,
      canWrite: role === "owner" || role === "editor",
      tabAccess: (tab: Exclude<TabKey, "settings">) => tabAccessOf(effectiveProfile, role, tab),
      canView: (pathname: string) => canViewPage(pathname, effectiveProfile, role),
      canEdit: (pathname: string) => canEditPage(pathname, effectiveProfile, role),
      signIn,
      signUp,
      signOut,
      refresh,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [db, hydrated, authChecked, session, profile, role, saveState, schemaIssues]
  );

  return <DbContext.Provider value={value}>{children}</DbContext.Provider>;
}

export function useDbContext(): DbContextValue {
  return useContext(DbContext);
}

export function useDb(): { db: Database; hydrated: boolean; setDb: React.Dispatch<React.SetStateAction<Database | null>> } {
  const ctx = useContext(DbContext);
  if (!ctx.db) throw new Error("useDb used before hydration");
  return { db: ctx.db, hydrated: ctx.hydrated, setDb: ctx.setDb };
}
