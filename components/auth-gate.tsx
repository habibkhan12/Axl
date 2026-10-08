"use client";
import React, { useEffect, useState } from "react";
import { useDbContext } from "@/lib/local-db";
import { ADMIN_EMAIL } from "@/lib/admin";
import { Button, Input, Label, CARD } from "@/components/ui";

/**
 * Login screen.
 *  - Default: Sign in. Nothing else.
 *  - Only if the database has ZERO accounts: a one-time screen to create THE
 *    admin account, whose email is hardcoded server-side (no role choices,
 *    no "first user becomes owner" magic).
 *  - All other accounts are created by the admin in Settings → Users.
 */
export function AuthGate({ children }: { children: React.ReactNode }) {
  const { session, authChecked, signIn } = useDbContext();
  const [mode, setMode] = useState<"signin" | "first-admin">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // If no accounts exist at all, offer the one-time admin creation.
  useEffect(() => {
    if (session) return;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    fetch("/api/auth/setup-status", { signal: controller.signal, cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { hasOwner?: boolean | null } | null) => {
        if (data && data.hasOwner === false) setMode("first-admin");
      })
      .catch(() => {})
      .finally(() => clearTimeout(timer));
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [session]);

  async function submit() {
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      if (mode === "first-admin") {
        const res = await fetch("/api/auth/bootstrap", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ password, name: name.trim() }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError((data as { error?: string }).error ?? "Could not create the admin account.");
          return;
        }
        setMode("signin");
        setInfo("Admin account created. Sign in with your password.");
        return;
      }
      const err = await signIn(email.trim(), password);
      if (err) setError(prettyError(err));
    } finally {
      setBusy(false);
    }
  }

  if (!authChecked) {
    return <div className="flex min-h-screen items-center justify-center bg-[#f4efe8] text-sm text-zinc-400">Loading…</div>;
  }

  if (session) return <>{children}</>;

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#f4efe8] p-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <img src="/logo.png" alt="Al Yasmeen Steel" className="mx-auto mb-3 h-12 w-12 rounded-xl object-contain" />
          <h1 className="text-lg font-bold text-zinc-900">Al Yasmeen Steel</h1>
          <p className="text-sm text-zinc-500">
            {mode === "first-admin" ? "One-time setup — create the admin account" : "Sign in to your books"}
          </p>
        </div>

        <div className={CARD + " p-5"}>
          {mode === "first-admin" ? (
            <>
              <div className="mb-3">
                <Label>Admin email (fixed)</Label>
                <Input value={ADMIN_EMAIL} readOnly disabled className="bg-zinc-50 text-zinc-500" />
              </div>
              <div className="mb-3">
                <Label>Your name</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Habib" />
              </div>
              <div className="mb-4">
                <Label>Password</Label>
                <Input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="minimum 6 characters"
                  onKeyDown={(e) => e.key === "Enter" && submit()}
                />
              </div>
            </>
          ) : (
            <>
              <div className="mb-3">
                <Label>Email</Label>
                <Input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@company.com"
                  onKeyDown={(e) => e.key === "Enter" && submit()}
                />
              </div>
              <div className="mb-4">
                <Label>Password</Label>
                <Input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  onKeyDown={(e) => e.key === "Enter" && submit()}
                />
              </div>
            </>
          )}
          {error ? <p className="mb-3 rounded-full bg-red-50 px-3.5 py-1.5 text-xs font-medium text-red-600">{error}</p> : null}
          {info ? <p className="mb-3 rounded-full bg-emerald-50 px-3.5 py-1.5 text-xs font-medium text-emerald-700">{info}</p> : null}
          <Button
            variant="primary"
            className="w-full"
            disabled={busy || !password || (mode === "signin" && !email)}
            onClick={submit}
          >
            {busy ? "Please wait…" : mode === "first-admin" ? "Create admin account" : "Sign in"}
          </Button>
        </div>

        <p className="mt-4 text-center text-[11px] text-zinc-400">
          {mode === "first-admin"
            ? "This creates the single admin account. All other accounts are made by the admin."
            : "Accounts are created by the admin in Settings → Users."}
        </p>
      </div>
    </div>
  );
}

function prettyError(msg: string): string {
  if (msg.includes("Invalid login")) return "Wrong email or password.";
  if (msg.includes("Email not confirmed")) return "Email not confirmed — check your inbox, or ask the admin to confirm the account.";
  if (msg.includes("already registered")) return "That email already has an account — sign in instead.";
  if (msg.includes("Password")) return "Password must be at least 6 characters.";
  if (msg.includes("Failed to fetch")) return "Cannot reach the server — check your internet connection.";
  return msg;
}
