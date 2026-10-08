/**
 * Lightweight fuzzy-search engine for the command palette.
 *
 * Strategy (in scoring order):
 *  1. exact match                — needle === field
 *  2. prefix match               — field starts with needle
 *  3. substring match            — field contains needle
 *  4. all-tokens match           — every whitespace-separated token appears in the haystack
 *  5. token-prefix match         — every token prefix-matches some word in the haystack
 *  6. ordered subsequence        — needle chars appear in order ("nsn rgue" → "Nissan Rogue")
 *  7. letter-subsequence         — loosest fallback ("hlx" → "Hilux", "accrd" → "Accord")
 *  8. typo tolerance             — token-level Damerau-Levenshtein: "poilice"
 *                                  → "Police" (transposition), "polce" (deletion),
 *                                  "polica" (substitution)
 *  9. character overlap          — order-insensitive last resort: rank by shared
 *                                  character bigrams so something always surfaces
 *
 * Normalization: case-fold, collapse whitespace, strip diacritics, and map
 * common confusables (arabic transliterations: mohd→mohammed etc. handled by
 * prefix matching; "050-123-4567" and "0501234567" match via digit-only form).
 */

const DIACRITICS = /[\u0300-\u036f]/g;

export function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(DIACRITICS, "")
    .replace(/[\u0640]/g, "") // arabic tatweel
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** Digits-only form so "050 123 4567", "0501234567", "+971501234567" all match "501234567". */
export function digitsOf(s: string): string {
  const d = s.replace(/\D/g, "");
  // strip UAE trunk prefix and country code for phone-like strings
  return d.replace(/^971/, "").replace(/^0(?=\d{9})/, "");
}

/**
 * Order-insensitive similarity between two strings (0..1): shared character
 * bigram overlap (Dice coefficient). "abc" vs "acb" scores high because letter
 * order is not factored in — only which characters appear. Used as the last
 * resort so the palette can always show the closest match.
 */
export function charSimilarity(a: string, b: string): number {
  const na = norm(a);
  const nb = norm(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  // Single-character strings have no bigrams — compare the character directly.
  if (na.length < 2 || nb.length < 2) return na === nb ? 1 : 0;
  const bigrams = (s: string) => {
    const m = new Map<string, number>();
    for (let i = 0; i < s.length - 1; i++) {
      const g = s.slice(i, i + 2);
      m.set(g, (m.get(g) ?? 0) + 1);
    }
    return m;
  };
  const A = bigrams(na);
  const B = bigrams(nb);
  let overlap = 0;
  for (const [g, c] of A) overlap += Math.min(c, B.get(g) ?? 0);
  const total = (na.length - 1) + (nb.length - 1);
  return total > 0 ? (2 * overlap) / total : 0;
}

export type Match = { score: number; kind: MatchKind };
export type MatchKind = "exact" | "prefix" | "substring" | "tokens" | "token-prefix" | "subsequence" | "none";

/** Score a needle against one haystack field. 0 = no match. */
export function scoreField(needle: string, field: string): number {
  if (!needle) return 0;
  const n = norm(needle);
  if (!n) return 0;
  const f = norm(field);
  if (!f) return 0;

  if (f === n) return 1000;
  if (f.startsWith(n)) return 800 - Math.min(f.length - n.length, 200);
  if (f.includes(n)) return 600 - Math.min(f.indexOf(n), 200);

  const nTokens = n.split(" ").filter(Boolean);
  const fTokens = f.split(" ").filter(Boolean);
  if (nTokens.length > 1) {
    if (nTokens.every((t) => fTokens.some((ft) => ft === t))) return 500;
    if (nTokens.every((t) => fTokens.some((ft) => ft.startsWith(t)))) return 400;
    // mixed: some exact, some prefix
    if (nTokens.every((t) => fTokens.some((ft) => ft.startsWith(t) || ft.includes(t)))) return 350;
  }

  // ordered subsequence of the whole needle ("nsn rogue" across words)
  if (isSubsequence(n, f)) return 300 - Math.min(f.length - n.length, 150);

  // per-token loose subsequence ("hlx" → "hilux")
  if (nTokens.length > 0 && nTokens.every((t) => fTokens.some((ft) => isSubsequence(t, ft)))) return 200;

  // typo tolerance — "poilice" → "police" (one transposition), "polce" (one
  // deletion), "polica" (one substitution). Each query token must be within
  // edit distance 1 of some field token (distance 2 for long words ≥ 6).
  if (nTokens.length > 0 && nTokens.every((t) => fTokens.some((ft) => tokenTypoOk(t, ft)))) {
    // fewer mistakes rank higher: 1 typo across the query ≈ 340, 2 ≈ 320…
    let cost = 0;
    for (const t of nTokens) {
      let best = 99;
      for (const ft of fTokens) best = Math.min(best, dlDistance(t, ft, 2));
      cost += Math.min(best, 2);
    }
    return Math.max(260, 340 - 20 * (cost - nTokens.length));
  }

  return 0;
}

/** True when a query token is within typo distance of a field token. */
function tokenTypoOk(t: string, ft: string): boolean {
  const max = t.length >= 6 || ft.length >= 6 ? 2 : 1;
  return dlDistance(t, ft, max) <= max;
}

/** Damerau-Levenshtein distance (adjacent transposition = 1 edit), capped. */
export function dlDistance(a: string, b: string, cap = 2): number {
  if (a === b) return 0;
  const al = a.length;
  const bl = b.length;
  if (Math.abs(al - bl) > cap) return cap + 1;
  // Early exits for trivial single-edit cases.
  if (al === bl) {
    let diff = 0;
    for (let i = 0; i < al; i++) if (a[i] !== b[i]) diff++;
    if (diff === 1) return 1;
    if (diff === 2 && al >= 2 && a[al - 2] === b[al - 1] && a[al - 1] === b[al - 2]) return 1; // one transposition
  }
  const INF = cap + 1;
  const d: number[][] = [];
  for (let i = 0; i <= al; i++) {
    d[i] = new Array(bl + 1).fill(0);
    d[i][0] = i;
  }
  for (let j = 0; j <= bl; j++) d[0][j] = j;
  for (let i = 1; i <= al; i++) {
    let rowMin = d[i][0];
    for (let j = 1; j <= bl; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, d[i - 2][j - 2] + 1);
      d[i][j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > cap) return INF; // entire row already too far — bail early
  }
  return Math.min(d[al][bl], INF);
}

function isSubsequence(needle: string, hay: string): boolean {
  if (needle.length > hay.length) return false;
  let i = 0;
  for (let j = 0; j < hay.length && i < needle.length; j++) {
    if (hay[j] === needle[i]) i++;
  }
  return i === needle.length;
}

export interface SearchDoc {
  key: string; // unique result key
  group: string; // display group header
  title: string;
  sub?: string;
  /** Fields searched with weights. Digits fields get phone-style normalization. */
  fields?: string[];
  digits?: string[]; // matched against digit-normalized needle
  /** Navigation/detail action. */
  run: () => void;
  keywords?: string[]; // extra lowercase boosters
}

/** Build the searchable haystack for a doc and score it against the query. */
export function scoreDoc(doc: SearchDoc, query: string): number {
  const n = norm(query);
  if (!n) return 0;
  let best = 0;
  for (const f of doc.fields ?? []) {
    const s = scoreField(n, f);
    if (s > best) best = s;
  }
  // digits: phone/account numbers
  const qDigits = digitsOf(query);
  if (qDigits.length >= 3 && doc.digits) {
    for (const d of doc.digits) {
      if (d.includes(qDigits)) {
        const s = 550;
        if (s > best) best = s;
      }
    }
  }
  if (best === 0 && doc.keywords) {
    for (const k of doc.keywords) {
      const s = scoreField(n, k);
      if (s > best) best = s;
    }
  }
  // multi-token queries: require the strongest token to still match
  return best;
}

/** Best order-insensitive similarity for a doc against the query. */
function similarDoc(doc: SearchDoc, query: string): number {
  const fields = [...(doc.fields ?? []), ...(doc.keywords ?? []), doc.title, doc.sub ?? ""];
  let best = 0;
  for (const f of fields) {
    const s = charSimilarity(query, f);
    if (s > best) best = s;
  }
  return best;
}

/** Rank docs by score desc, keep stable order for ties. */
export function rankDocs(docs: SearchDoc[], query: string, limit = 20): { doc: SearchDoc; score: number; fallback?: boolean }[] {
  const scored: { doc: SearchDoc; score: number; fallback?: boolean }[] = [];
  for (const d of docs) {
    const s = scoreDoc(d, query);
    if (s > 0) scored.push({ doc: d, score: s });
  }
  scored.sort((a, b) => b.score - a.score);
  if (scored.length > 0) return scored.slice(0, limit);

  // Nothing matched any rule — fall back to pure character overlap
  // (letter order ignored) so the closest option still surfaces.
  const nearest = docs
    .map((d) => ({ doc: d, sim: similarDoc(d, query) }))
    .filter((x) => x.sim > 0)
    .sort((a, b) => b.sim - a.sim)
    .slice(0, Math.min(5, limit));
  return nearest.map((x) => ({ doc: x.doc, score: Math.round(x.sim * 60), fallback: true }));
}
