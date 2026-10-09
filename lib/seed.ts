// ─── Seed reference data — lifted from Inc & Exp Sep 2026.xlsx ───────────────
import type { Database, User, Category, Vehicle, PaymentMethod } from "./types";

export const SEED_USERS: User[] = [
  { id: "u_owner", name: "Owner", email: "owner@axl.local", role: "owner" },
  { id: "u_book", name: "Bookkeeper", email: "bookkeeper@axl.local", role: "editor" },
  { id: "u_view", name: "Viewer", email: "viewer@axl.local", role: "viewer" },
];

export const SEED_CATEGORIES: Category[] = [
  { id: "c_materials", name: "Materials", kind: "expense" },
  { id: "c_fuel", name: "Fuel", kind: "expense" },
  { id: "c_manpower", name: "Man Power", kind: "expense" },
  { id: "c_utilities", name: "Utilities", kind: "expense" },
  { id: "c_vehicles", name: "Vehicles", kind: "expense" },
  { id: "c_villa1", name: "Villa 01", kind: "expense" },
  { id: "c_villa2", name: "Villa 02", kind: "expense" },
  { id: "c_villa3", name: "Villa 03", kind: "expense" },
  { id: "c_personal", name: "Personal", kind: "expense" },
  { id: "c_charity", name: "Charity", kind: "expense" },
  { id: "c_stationary", name: "Stationary", kind: "expense" },
  { id: "c_grocery", name: "Grocery", kind: "expense" },
  { id: "c_publicity", name: "Publicity", kind: "expense" },
  { id: "c_ministry", name: "Ministry", kind: "expense" },
  { id: "c_general", name: "General Income", kind: "income" },
];

export const SEED_VEHICLES: Vehicle[] = [
  { id: "v_rogue", label: "Rogue", plate: "85636 A AJM" },
  { id: "v_accord_silver", label: "Accord Silver", plate: "90615 C AJM" },
  { id: "v_accord_blue", label: "Accord Blue", plate: "64357 C AJM" },
  { id: "v_pathfinder", label: "Pathfinder", plate: "50393 G DXB" },
  { id: "v_avanza", label: "Avanza", plate: "29125 A AJM" },
  { id: "v_75011", label: "Hilux 75011", plate: "75011 A AJM" },
  { id: "v_73516", label: "Pickup 73516", plate: "73516 B AJM" },
  { id: "v_36975", label: "Sedan 36975", plate: "36975 A" },
  { id: "v_civic", label: "Civic White", plate: "64206 C AJM" },
  { id: "v_bmw", label: "BMW", plate: "87164" },
  { id: "v_company", label: "Company", plate: "—", is_company: true },
];

export const SEED_PAYMENT_METHODS: PaymentMethod[] = [
  { id: "pm_adcb", name: "ADCB" },
  { id: "pm_cash", name: "CASH" },
  { id: "pm_pos", name: "POS" },
  { id: "pm_janata", name: "Janata" },
  { id: "pm_cheque", name: "Cheque" },
];

export function freshDb(): Database {
  return {
    categories: SEED_CATEGORIES,
    vehicles: SEED_VEHICLES,
    payment_methods: SEED_PAYMENT_METHODS,
    transactions: [],
    users: SEED_USERS,
    settings: { monthly_income_target: 163350, monthly_profit_target: 0, monthly_expense_target: 0, active_user_id: "u_owner" },
  };
}
