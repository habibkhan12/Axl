export type DuesFieldSpec = {
  key: string;
  label: string;
  placeholder?: string;
  required?: boolean;
  type?: "text" | "tel" | "email" | "select";
  options?: string[];
};

/**
 * Built-in catalog of the UAE government / utility portals we monitor.
 * Lives in code (not the DB) so adding a provider later is a one-file change.
 * `fields` drives the dynamic add/edit form on the Dues page and what the
 * sequencer passes to each checker.
 */
export interface DuesProviderSpec {
  key: string;
  name: string;
  blurb: string;
  /** Deep link the dashboard's "Pay here" button opens. */
  paymentUrl: string;
  fields: DuesFieldSpec[];
  /** false = link-only (portal needs a login we don't automate). */
  checkable: boolean;
}

export const DUES_PROVIDERS: DuesProviderSpec[] = [
  {
    key: "evg",
    name: "EVG — Emirates Vehicle Gate",
    blurb: "Traffic fines & vehicle services. Login-only portal — we link out; an EVG Organization (fleet) account is the proper long-term fix.",
    paymentUrl: "https://evg.ae/_layouts/EVG/finepayment0.aspx?language=en",
    fields: [],
    checkable: false,
  },
  {
    key: "dubai_police",
    name: "Dubai Police — Traffic Fines",
    blurb: "Guest inquiry by traffic code (TC) number or plate. Payment takes GCC-issued cards.",
    paymentUrl: "https://www.dubaipolice.gov.ae/app/services/fine-payment/search",
    fields: [
      { key: "tc_number", label: "Traffic code (TC) number", placeholder: "e.g. 12345678901", required: false },
      { key: "plate_emirate", label: "Plate emirate (if using plate)", placeholder: "Dubai", required: false },
      { key: "plate_code", label: "Plate code", placeholder: "e.g. B / 12345", required: false },
      { key: "plate_number", label: "Plate number", placeholder: "e.g. 90615", required: false },
    ],
    checkable: true,
  },
  {
    key: "ajman_sewerage",
    name: "Ajman Sewerage — Quick Pay",
    blurb: "Outstanding sewerage balance by 10-digit account number.",
    paymentUrl: "https://www.ajmansewerage.ae/quickpay",
    fields: [{ key: "account_number", label: "Account number", placeholder: "10-digit number", required: true }],
    checkable: true,
  },
  {
    key: "etihad_we",
    name: "Etihad Water & Electricity",
    blurb: "Current bill by account number. Payments: GCC cards, max AED 100,000, 5 tx/card/day.",
    paymentUrl:
      "https://online.etihadwe.ae/QuickBillPay/index.cfm?fuseaction=home.OUJBOEJEMTdFNURENTY3QzcyNDAyOEE1MDI5OTEzMTA1NUMzOEVCMzZBMjg2NkU3MkIxRjAyNEZGMjJDNjNDMQ==&z=1",
    fields: [
      { key: "account_number", label: "Account number", placeholder: "EtihadWE account number", required: true },
      { key: "email", label: "Email (optional, for receipts)", placeholder: "name@company.ae", required: false },
    ],
    checkable: true,
  },
  {
    key: "salik",
    name: "Salik — Toll Balance",
    blurb: "Guest balance check by plate + registered mobile. Recharge needs account no. + PIN.",
    paymentUrl: "https://www.salik.ae/en/support/salik-services-catalog/recharge-a-salik-account",
    fields: [
      { key: "plate_emirate", label: "Plate emirate", placeholder: "Dubai", required: true, type: "select", options: ["Dubai", "Abu Dhabi", "Sharjah", "Ajman", "Umm Al Quwain", "Ras Al Khaimah", "Fujairah"] },
      { key: "plate_code", label: "Plate code", placeholder: "e.g. B / 12345", required: true },
      { key: "plate_number", label: "Plate number", placeholder: "e.g. 90615", required: true },
      { key: "registered_mobile", label: "Mobile registered with Salik", placeholder: "50 123 4567", required: true },
    ],
    checkable: true,
  },
  {
    key: "du",
    name: "du — Quick Pay",
    blurb: "Postpaid bill by mobile or account number, no login.",
    paymentUrl: "https://myaccount.du.ae/webapp/en/quick-pay",
    fields: [{ key: "account_number", label: "Mobile or account number", placeholder: "e.g. 0501234567", required: true }],
    checkable: true,
  },
  {
    key: "eand",
    name: "e& (Etisalat) — Quick Pay",
    blurb: "Outstanding bill by account number. Note: bot-protected — needs a UAE-located server to check.",
    paymentUrl: "https://www.eand.ae/ecare/c/quick-pay",
    fields: [{ key: "account_number", label: "Account number", placeholder: "e& account number", required: true }],
    checkable: true,
  },
];

export function duesProviderOf(key: string): DuesProviderSpec | undefined {
  return DUES_PROVIDERS.find((p) => p.key === key);
}
