// ─── Lightweight activity log for the notification bell ─────────────────────
// Stored in localStorage so it survives reloads and works offline.

export type NotifKind = "transaction" | "ref" | "settings" | "account" | "sync" | "dues";

export interface NotifEvent {
  id: string;
  at: string; // ISO timestamp
  kind: NotifKind;
  text: string;
  detail?: string;
  read: boolean;
}

const KEY = "axl-notifs-v1";
const PREFS_KEY = "axl-notif-prefs-v1";

/** Which kinds are allowed to land in the feed + badge. All on by default. */
const DEFAULT_PREFS: Record<NotifKind, boolean> = {
  transaction: true,
  ref: true,
  settings: true,
  account: true,
  sync: true,
  dues: true,
};

export function loadNotifPrefs(): Record<NotifKind, boolean> {
  if (typeof window === "undefined") return { ...DEFAULT_PREFS };
  try {
    const raw = window.localStorage.getItem(PREFS_KEY);
    if (!raw) return { ...DEFAULT_PREFS };
    const parsed = JSON.parse(raw) as Partial<Record<NotifKind, boolean>>;
    return { ...DEFAULT_PREFS, ...parsed };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export function saveNotifPrefs(prefs: Record<NotifKind, boolean>) {
  try {
    window.localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    /* storage full — prefs are best-effort */
  }
  window.dispatchEvent(new CustomEvent("axl-notifs-changed"));
}

export const NOTIF_KIND_META: { kind: NotifKind; label: string; blurb: string }[] = [
  { kind: "transaction", label: "Transactions", blurb: "New income and expense entries added by you or teammates." },
  { kind: "dues", label: "Dues & fines", blurb: "New or changed balances detected on monitored portals." },
  { kind: "account", label: "Account changes", blurb: "Accounts created, roles changed, passwords reset." },
  { kind: "ref", label: "References & jobs", blurb: "Job references, vouchers and party updates." },
  { kind: "settings", label: "Books settings", blurb: "Targets, categories and payment methods edited." },
  { kind: "sync", label: "Sync activity", blurb: "Cloud sync status and data tools activity." },
];

export function loadNotifs(): NotifEvent[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as NotifEvent[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Feed filtered to the kinds the user has enabled (badge + panel use this). */
export function visibleNotifs(): NotifEvent[] {
  const prefs = loadNotifPrefs();
  return loadNotifs().filter((n) => prefs[n.kind] !== false);
}

function persist(events: NotifEvent[]) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(events.slice(0, CAP)));
  } catch {
    /* storage full — notifications are best-effort */
  }
}

export function appendNotif(kind: NotifKind, text: string, detail?: string) {
  const prefs = loadNotifPrefs();
  if (prefs[kind] === false) return; // muted category — don't even record
  const events = loadNotifs();
  events.unshift({ id: "n_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), at: new Date().toISOString(), kind, text, detail, read: false });
  persist(events);
  window.dispatchEvent(new CustomEvent("axl-notifs-changed"));
}

export function markAllRead() {
  persist(loadNotifs().map((n) => ({ ...n, read: true })));
  window.dispatchEvent(new CustomEvent("axl-notifs-changed"));
}

export function unreadCount(): number {
  return visibleNotifs().filter((n) => !n.read).length;
}

const CAP = 200;
