import type { Database, Transaction } from "./types";

export interface TransactionInput {
  kind: Transaction["kind"];
  txn_date: string;
  amount: number;
  category_id?: string | null;
  payment_method_id?: string | null;
  party_id?: string | null;
  vehicle_id?: string | null;
  fuel_liters?: number | null;
  job_ref?: string | null;
  voucher_no?: string | null;
  description?: string | null;
  notes?: string | null;
  receipt_url?: string | null;
  created_by: string;
}

export const STORAGE_KEY = "axl-books-db-v1";

/** Fill in collections added after a database was written (old local data, backups). */
export function normalizeDb(db: Database): Database {
  return { ...db, parties: Array.isArray(db.parties) ? db.parties : [] };
}
