"use client";
import { getSupabase } from "./supabase";

/** Private Supabase Storage bucket that holds personnel documents. */
export const STAFF_BUCKET = "staff-documents";
/** Files above this are rejected with a readable message instead of a hung upload. */
export const MAX_DOC_BYTES = 10 * 1024 * 1024;

/** Keep object keys free of slashes/odd characters while staying recognisable. */
export function safeFileName(name: string): string {
  return name.replace(/[^\w.\-]+/g, "_").replace(/^_+/, "").slice(-80) || "document";
}

/** Upload (or replace) a document object. Returns an error message, or null. */
export async function uploadStaffFile(path: string, file: File): Promise<string | null> {
  const { error } = await getSupabase()
    .storage.from(STAFF_BUCKET)
    .upload(path, file, { upsert: true, contentType: file.type || undefined });
  return error ? error.message : null;
}

/** Short-lived link to view or download a stored document. */
export async function signedStaffUrl(path: string, downloadName?: string | null): Promise<string | null> {
  const { data, error } = await getSupabase()
    .storage.from(STAFF_BUCKET)
    .createSignedUrl(path, 60 * 10, downloadName ? { download: downloadName } : undefined);
  if (error) return null;
  return data?.signedUrl ?? null;
}

export async function removeStaffFile(path: string): Promise<void> {
  await getSupabase().storage.from(STAFF_BUCKET).remove([path]);
}

export function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Could not read that file"));
    reader.readAsDataURL(file);
  });
}
