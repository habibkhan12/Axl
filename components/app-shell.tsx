"use client";
import React, { createContext, useContext, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ArrowLeftRight, Bell, CarFront, Grid2X2, Landmark, LogOut, Menu, PanelLeftClose, PanelLeftOpen, Plus, Search, Settings2, X } from "lucide-react";
import type { Kind } from "@/lib/types";
import { DbProvider, useDbContext, canViewPage } from "@/lib/local-db";
import { activeUser } from "@/lib/repo";
import { AuthGate } from "@/components/auth-gate";
import { Avatar, useKeyboardShortcut } from "@/components/ui";
import { loadNotifs, markAllRead, type NotifEvent } from "@/lib/notifications";

function NotificationBell() {
  const [events, setEvents] = useState<NotifEvent[]>([]);
  const [open, setOpen] = useState(false);
  const ref = React.useRef<HTMLDivElement>(null);

  useEffect(() => {
    const update = () => setEvents(loadNotifs());
    update();
    window.addEventListener("axl-notifs-changed", update);
    return () => window.removeEventListener("axl-notifs-changed", update);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const unread = events.filter((n) => !n.read).length;

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="relative flex h-9 w-9 items-center justify-center rounded-full border border-[#e6dfd2] bg-white text-zinc-500 transition-colors hover:border-[#d6ccba] hover:text-zinc-900"
        title="Notifications"
      >
        <Bell size={15} />
        {unread > 0 ? (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-zinc-900 px-1 text-[9px] font-bold text-white">{unread > 99 ? "99+" : unread}</span>
        ) : null}
      </button>
      {open ? (
        <div className="absolute right-0 z-50 mt-2 w-80 overflow-hidden rounded-xl border border-[#e7e0d4] bg-white shadow-[0_2px_8px_rgba(24,24,27,0.08),0_12px_32px_-8px_rgba(24,24,27,0.18)]">
          <div className="flex items-center justify-between border-b border-[#f0ece4] px-4 py-2.5">
            <span className="text-sm font-semibold text-zinc-900">Notifications</span>
            {unread > 0 ? (
              <button onClick={markAllRead} className="text-xs font-medium text-zinc-400 transition-colors hover:text-zinc-900">
                Mark all read
              </button>
            ) : null}
          </div>
          <div className="max-h-96 overflow-y-auto">
            {events.length === 0 ? (
              <p className="px-4 py-8 text-center text-xs text-zinc-400">No activity yet. Changes you make will appear here.</p>
            ) : (
              events.slice(0, 50).map((n) => (
                <div key={n.id} className={"flex gap-2.5 border-b border-[#f5f1e9] px-4 py-2.5 last:border-0 " + (n.read ? "" : "bg-[#faf7f1]")}>
                  <span className={"mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full " + (n.read ? "bg-transparent" : "bg-zinc-900")} />
                  <div className="min-w-0 flex-1">
                    <p className="text-[12px] font-medium leading-snug text-zinc-800">{n.text}</p>
                    {n.detail ? <p className="mt-0.5 truncate text-[11px] text-zinc-400">{n.detail}</p> : null}
                  </div>
                  <span className="shrink-0 text-[10px] tabular-nums text-zinc-300">{new Date(n.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                </div>
              ))
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
import { CommandPalette } from "@/components/command-palette";
import { QuickEntry } from "@/components/quick-entry";

const NAV = [
  { href: "/", label: "Dashboard", icon: Grid2X2, section: "main" },
  { href: "/transactions", label: "Transactions", icon: ArrowLeftRight, section: "main" },
  { href: "/fleet", label: "Fleet", icon: CarFront, section: "main" },
  { href: "/dues", label: "Dues & fines", icon: Landmark, section: "main" },
  { href: "/settings", label: "Settings", icon: Settings2, section: "manage" },
] as const;

const PAGE_LABELS: Record<string, string> = {
  "/": "Dashboard",
  "/transactions": "Transactions",
  "/fleet": "Fleet",
  "/dues": "Dues & fines",
  "/settings": "Settings",
};

interface QuickEntryContextValue {
  openQuickEntry: (kind?: Kind) => void;
}

const QuickEntryContext = createContext<QuickEntryContextValue>({ openQuickEntry: () => {} });

export function useQuickEntry() {
  return useContext(QuickEntryContext);
}

function Shell({ children }: { children: React.ReactNode }) {
  const { db, hydrated, setDb } = useDbContext();
  const pathname = usePathname();
  const router = useRouter();
  const [qeOpen, setQeOpen] = useState(false);
  const [qeKind, setQeKind] = useState<Kind>("expense");
  const [palOpen, setPalOpen] = useState(false);
  const [collapsed, setCollapsedInit] = useState<boolean>(() => (typeof window !== "undefined" ? window.localStorage.getItem("axl-sidebar-collapsed") === "1" : false));
  const setCollapsed = (v: boolean) => {
    setCollapsedInit(v);
    try { window.localStorage.setItem("axl-sidebar-collapsed", v ? "1" : "0"); } catch { /* private mode */ }
  };

  // Settings → Appearance can flip the sidebar from another component.
  useEffect(() => {
    const handler = (e: Event) => setCollapsedInit(!!(e as CustomEvent<boolean>).detail);
    window.addEventListener("axl-sidebar-collapse", handler);
    return () => window.removeEventListener("axl-sidebar-collapse", handler);
  }, []);
  const scrollRef = React.useRef<HTMLElement | null>(null);
  const [mobileNav, setMobileNav] = useState(false);
  const { session, profile, role, canEdit, signOut } = useDbContext();

  // Restricted accounts only see the tabs they were granted (admins see all).
  const visibleNav = NAV.filter((item) => canViewPage(item.href, profile, role));

  // Route guard: a restricted account that deep-links to a hidden tab gets bounced home.
  useEffect(() => {
    if (!hydrated) return;
    if (!canViewPage(pathname, profile, role)) router.replace("/");
  }, [hydrated, pathname, profile, role, router]);

  // New page: reset the content panel's internal scroll.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [pathname]);

  function openQuickEntry(kind: Kind = "expense") {
    // Quick entry always creates a transaction — needs transactions edit access.
    if (!canEdit("/transactions")) return;
    setQeKind(kind);
    setQeOpen(true);
  }
  useKeyboardShortcut("n", () => openQuickEntry("expense"));

  // The sheet top bar renders inside the Shell; pages can also trigger entry/burger via events.
  useEffect(() => {
    const onQuick = (e: Event) => openQuickEntry(((e as CustomEvent).detail as Kind) ?? "expense");
    window.addEventListener("axl-open-quick-entry", onQuick);
    return () => window.removeEventListener("axl-open-quick-entry", onQuick);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // ⌘K and ⌘F both open the command palette (F matches the sidebar label).
      if ((e.metaKey || e.ctrlKey) && (e.key.toLowerCase() === "k" || e.key.toLowerCase() === "f")) {
        e.preventDefault();
        setPalOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!hydrated || !db) {
    return <div className="flex h-dvh items-center justify-center bg-[#efeee9] text-sm text-zinc-400">Loading your books…</div>;
  }

  const localUser = db.users.find((u) => u.id === db.settings.active_user_id);
  const user = profile
    ? { id: profile.id, name: profile.name, role, avatar_url: profile.avatar_url ?? null }
    : { ...activeUser(db), avatar_url: null as string | null };
  const email = session?.user?.email ?? localUser?.email ?? "";
  const pageLabel = PAGE_LABELS[pathname] ?? pathname;
  const width = collapsed ? "w-[68px]" : "w-[232px]";

  return (
    <QuickEntryContext.Provider value={{ openQuickEntry }}>
      {/* ── Full-screen app: edge-to-edge, no mockup margins ── */}
      <div className="h-dvh bg-white">
        <div className="flex h-full flex-col overflow-hidden bg-white">
          <div className="flex min-h-0 flex-1 overflow-hidden">
            {/* ───────────────────────────── Sidebar ───────────────────────────── */}
            <aside
              className={
                "hidden h-full shrink-0 flex-col bg-[#f7f5f1] transition-[width] duration-200 md:flex " +
                width
              }
            >
              {/* Brand */}
              <div className={(collapsed ? "px-2" : "px-4") + " pt-5"}>
                <div className={collapsed ? "flex justify-center" : "flex items-center gap-2.5"}>
                  <img src="/logo.png" alt="Al Yasmeen Steel" className="h-9 w-9 shrink-0 rounded-xl border border-[#e7e0d4] bg-white object-contain p-0.5" />
                  {!collapsed ? (
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13.5px] font-semibold tracking-tight text-zinc-900">Al Yasmeen Steel</div>
                      <div className="truncate text-[11px] text-zinc-400">Income &amp; Expense</div>
                    </div>
                  ) : null}
                  {!collapsed ? (
                    <button
                      onClick={() => setCollapsed(!collapsed)}
                      title="Collapse sidebar"
                      className="ml-auto flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-zinc-300 transition-colors hover:bg-[#eceae4] hover:text-zinc-600"
                    >
                      <PanelLeftClose size={15} />
                    </button>
                  ) : null}
                </div>
                {collapsed ? (
                  <button
                    onClick={() => setCollapsed(!collapsed)}
                    title="Expand sidebar"
                    className="mt-2 flex h-8 w-full items-center justify-center rounded-lg text-zinc-400 transition-colors hover:bg-[#eceae4] hover:text-zinc-700"
                  >
                    <PanelLeftOpen size={15} />
                  </button>
                ) : null}
              </div>

              {/* Search trigger */}
              <div className={collapsed ? "px-2 pt-3" : "px-3 pt-3"}>
                <button
                  onClick={() => setPalOpen(true)}
                  className={
                    "flex w-full items-center gap-2.5 rounded-lg border border-[#e5e0d6] bg-white text-sm text-zinc-500 transition-colors hover:border-[#d3cab8] hover:text-zinc-800 " +
                    (collapsed ? "justify-center px-0 py-2" : "px-3 py-2")
                  }
                  title="Search (Ctrl+F)"
                >
                  <Search size={16} className="shrink-0" />
                  {!collapsed ? (
                    <>
                      <span>Search anything</span>
                      <kbd className="ml-auto text-xs font-normal text-zinc-400">⌘ K</kbd>
                    </>
                  ) : null}
                </button>
              </div>

              {/* Nav */}
              <nav className="mt-5 flex-1 space-y-0.5 overflow-y-auto px-3 pb-2">
                {!collapsed ? <div className="px-2 pb-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-400">Main navigation</div> : <div className="h-3" />}
                {visibleNav.filter((n) => n.section === "main").map((item) => (
                  <NavLink key={item.href} href={item.href} label={item.label} active={pathname === item.href} collapsed={collapsed}>
                    <item.icon size={16} strokeWidth={1.8} />
                  </NavLink>
                ))}
                {visibleNav.some((n) => n.section === "manage") ? (
                  !collapsed ? <div className="px-2 pb-2 pt-6 text-[11px] font-semibold uppercase tracking-wider text-zinc-400">Manage</div> : <div className="h-5" />
                ) : null}
                {visibleNav.filter((n) => n.section === "manage").map((item) => (
                  <NavLink key={item.href} href={item.href} label={item.label} active={pathname === item.href} collapsed={collapsed}>
                    <item.icon size={16} strokeWidth={1.8} />
                  </NavLink>
                ))}
              </nav>

              {/* Bottom */}
              <div className={(collapsed ? "space-y-2 px-2" : "space-y-2 px-3") + " border-t-0 py-3"}>
                {canEdit("/transactions") ? (
                  collapsed ? (
                    <button
                      onClick={() => openQuickEntry("expense")}
                      title="New entry (N)"
                      className="flex h-9 w-full items-center justify-center rounded-lg bg-zinc-900 text-white transition-colors hover:bg-zinc-800"
                    >
                      <Plus size={16} />
                    </button>
                  ) : (
                    <button
                      onClick={() => openQuickEntry("expense")}
                      className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-zinc-900 px-3.5 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-800"
                    >
                      <Plus size={14} /> New entry
                    </button>
                  )
                ) : (
                  <div className="rounded-xl border border-dashed border-[#ddd4c4] px-2 py-2 text-center text-[9px] font-medium uppercase tracking-wider text-zinc-400">View only</div>
                )}

                {session ? (
                  collapsed ? (
                    <div className="flex justify-center py-1">
                      <div className="relative">
                        <Avatar name={user.name} size="lg" src={user.avatar_url} />
                        <span className="absolute -bottom-0.5 -left-0.5 h-2.5 w-2.5 rounded-full bg-emerald-500 ring-2 ring-white" />
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2.5 rounded-xl border border-[#eae5da] bg-white p-2 transition-colors hover:border-[#d9cfbd]">
                      <div className="relative shrink-0">
                        <Avatar name={user.name} size="lg" src={user.avatar_url} />
                        <span className="absolute -bottom-0.5 -left-0.5 h-2.5 w-2.5 rounded-full bg-emerald-500 ring-2 ring-white" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-xs font-semibold text-zinc-900">{user.name}</div>
                        <div className="truncate text-[10px] text-zinc-400">{email || role}</div>
                      </div>
                      <UserMenu onSignOut={() => void signOut()} />
                    </div>
                  )
                ) : collapsed ? (
                  <div className="flex justify-center py-1">
                    <Avatar name={localUser?.name ?? "?"} size="lg" />
                  </div>
                ) : (
                  <div className="rounded-xl border border-[#e5e0d6] bg-white p-2.5">
                    <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-zinc-400">Local mode — acting as</label>
                    <select
                      value={db.settings.active_user_id}
                      onChange={(e) => setDb((prev) => (prev ? { ...prev, settings: { ...prev.settings, active_user_id: e.target.value } } : prev))}
                      className="w-full rounded-lg border border-[#e5ddd0] bg-white px-2 py-1.5 text-xs text-zinc-700 outline-none focus:border-zinc-400"
                    >
                      {db.users.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.name} · {u.role}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
            </aside>

            {/* ─────────────────────────── Main content (white) ─────────────────────────── */}
            <div className="flex h-full min-w-0 flex-1 flex-col bg-white">
              <SheetTopBar
                label={pageLabel}
                onOpenMobileNav={() => setMobileNav(true)}
                onQuickEntry={() => openQuickEntry("expense")}
              />
              <main ref={scrollRef} className="app-scroll flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden px-4 pb-24 pt-5 md:px-7 md:pb-8 md:pt-6">
                {children}
              </main>
            </div>
          </div>
        </div>

        {/* Mobile quick entry */}
        <button
          onClick={() => openQuickEntry("expense")}
          className="fixed bottom-20 right-4 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-zinc-900 text-2xl font-light text-white shadow-xl transition-transform hover:scale-105 md:hidden"
          aria-label="New entry"
        >
          +
        </button>

        {/* Mobile bottom nav */}
        <nav className="fixed inset-x-0 bottom-0 z-40 flex items-stretch justify-around border-t border-[#e6dfd2] bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
          {visibleNav.slice(0, 4).map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={"flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] font-medium " + (pathname === item.href ? "text-zinc-900" : "text-zinc-400")}
            >
              <item.icon size={18} strokeWidth={1.8} />
              {item.label.split(" ")[0]}
            </Link>
          ))}
        </nav>

        {/* Mobile nav drawer */}
        {mobileNav ? (
          <div className="fixed inset-0 z-[60] bg-zinc-900/25 backdrop-blur-[2px] md:hidden" onMouseDown={() => setMobileNav(false)}>
            <div className="h-full w-64 bg-white p-3 shadow-xl" onMouseDown={(e) => e.stopPropagation()}>
              <div className="mb-3 flex items-center justify-between px-1">
                <span className="text-sm font-semibold text-zinc-900">Navigation</span>
                <button onClick={() => setMobileNav(false)} className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-100" aria-label="Close navigation">
                  <X size={16} />
                </button>
              </div>
              <button
                onClick={() => { setMobileNav(false); setPalOpen(true); }}
                className="mb-2 flex w-full items-center gap-2 rounded-lg border border-[#e6dfd2] px-3 py-2 text-sm text-zinc-500"
              >
                <Search size={14} /> Search anything
              </button>
              {visibleNav.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setMobileNav(false)}
                  className={"flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-medium " + (pathname === item.href ? "border border-[#e6dfd2] bg-white text-zinc-900 shadow-sm" : "text-zinc-500")}
                >
                  <item.icon size={16} strokeWidth={1.8} /> {item.label}
                </Link>
              ))}
              {session ? (
                <button
                  onClick={() => { setMobileNav(false); void signOut(); }}
                  className="mt-3 flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-sm font-medium text-zinc-500"
                >
                  <LogOut size={15} /> Sign out
                </button>
              ) : null}
            </div>
          </div>
        ) : null}

        <QuickEntry open={qeOpen} onClose={() => setQeOpen(false)} db={db} setDb={setDb} initialKind={qeKind} />
        <CommandPalette open={palOpen} onClose={() => setPalOpen(false)} db={db} />
      </div>
    </QuickEntryContext.Provider>
  );
}

/**
 * Top sliver that runs across the top of the white sheet: breadcrumb + bell + new-entry.
 * Rendered once by the Shell, so pages don't repeat it.
 */
function SheetTopBar({ label, onOpenMobileNav, onQuickEntry }: { label: string; onOpenMobileNav: () => void; onQuickEntry: () => void }) {
  return (
    <header className="shrink-0 bg-white">
      <div className="flex items-center justify-between px-4 pt-4 md:px-6" style={{ paddingBottom: 0 }}>
        <div className="flex min-w-0 items-center gap-1.5 text-[13px]">
          <button
            onClick={onOpenMobileNav}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-zinc-400 hover:bg-[#f4f4f2] hover:text-zinc-700 md:hidden"
            aria-label="Open navigation"
          >
            <Menu size={17} />
          </button>
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-[#e9e4da] bg-[#faf8f4] text-zinc-400">
            <Grid2X2 size={12} />
          </span>
          <span className="text-zinc-400">Books</span>
          <span className="text-zinc-200">/</span>
          <span className="truncate font-medium text-zinc-800">{label}</span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <NotificationBell />
          <button
            onClick={onQuickEntry}
            title="New entry (N)"
            className="flex h-9 items-center gap-1.5 rounded-lg border border-[#e9e4da] bg-white pl-2.5 pr-3 text-[13px] font-medium text-zinc-700 shadow-[0_1px_2px_rgba(24,24,27,0.05)] transition-colors hover:border-zinc-300 hover:text-zinc-900"
          >
            <Plus size={14} /> New entry
          </button>
        </div>
      </div>
    </header>
  );
}

function NavLink({ href, label, active, collapsed, children }: { href: string; label: string; active: boolean; collapsed: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      title={collapsed ? label : undefined}
      className={
        "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] font-medium transition-colors " +
        (collapsed ? "justify-center px-0 " : "") +
        (active
          ? "border border-[#e7e0d4] bg-white text-zinc-900 shadow-[0_1px_2px_rgba(24,24,27,0.04)]"
          : "border border-transparent text-zinc-500 hover:bg-[#eceae3] hover:text-zinc-900")
      }
    >
      <span className={"flex w-4 justify-center " + (active ? "text-zinc-800" : "text-zinc-400")}>{children}</span>
      {!collapsed ? label : null}
    </Link>
  );
}

function UserMenu({ onSignOut }: { onSignOut: () => void }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (!t.closest("[data-user-menu]")) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);
  return (
    <div className="relative" data-user-menu>
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex h-7 w-7 items-center justify-center rounded-lg text-zinc-400 transition-colors hover:bg-[#f4efe8] hover:text-zinc-700"
        title="Account"
      >
        <LogOut size={14} />
      </button>
      {open ? (
        <div className="absolute bottom-full right-0 z-50 mb-1.5 w-40 rounded-xl border border-[#e7e0d4] bg-white p-1 shadow-[0_2px_8px_rgba(24,24,27,0.08),0_12px_32px_-8px_rgba(24,24,27,0.18)]">
          <button
            onClick={() => {
              setOpen(false);
              onSignOut();
            }}
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs font-medium text-zinc-600 transition-colors hover:bg-[#f4efe8] hover:text-zinc-900"
          >
            <LogOut size={13} /> Sign out
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <DbProvider>
      <AuthGate>
        <Shell>{children}</Shell>
      </AuthGate>
    </DbProvider>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-[26px] font-semibold leading-tight tracking-tight text-zinc-900">{title}</h1>
        {subtitle ? <p className="mt-1 text-sm text-zinc-500">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
