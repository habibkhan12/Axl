import type { Database, Transaction, Party } from "./types";

export type PartyType = Party["type"];

export interface PartyInput {
  name: string;
  phone?: string;
  type?: Party["type"];
  notes?: string;
}

export interface TransactionInput {
  kind: Transaction["kind"];
  txn_date: string;
  amount: number;
  party_id?: string | null;
  category_id?: string | null;
  payment_method_id?: string | null;
  vehicle_id?: string | null;
  fuel_liters?: number | null;
  job_ref?: string | null;
  voucher_no?: string | null;
  description?: string | null;
  notes?: string | null;
  receipt_url?: string | null;
  created_by: string;
}

export interface AxlStore {
  load(): Database | null;
  save(db: Database): void;
  subscribe(fn: () => void): () => void;
}

export const STORAGE_KEY = "axl-books-db-v1";
