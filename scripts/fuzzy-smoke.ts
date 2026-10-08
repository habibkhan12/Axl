import { scoreField, charSimilarity, dlDistance } from "../lib/fuzzy";

const cases: [string, string, number][] = [
  ["poilice", "Police", 1],
  ["poilice", "police", 1],
  ["polce", "police", 1],
  ["polica", "police", 1],
  ["poilice", "Dubai Police — Traffic Fines", 1],
  ["poilice", "Utilities", 0], // must NOT be a strong-rule match
  ["nsn rogue", "Nissan Rogue", 1],
  ["hlx", "Hilux", 1],
];

let pass = true;
for (const [q, f, want] of cases) {
  const s = scoreField(q, f);
  const got = s > 0 ? 1 : 0;
  if (got !== want) {
    pass = false;
    console.log("FAIL", q, "→", f, "got", got, "want", want);
  } else {
    console.log("ok  ", q, "→", f, "score", s);
  }
}
console.log("dl(poilice,police) =", dlDistance("poilice", "police"));
console.log("sim(Utilities) =", charSimilarity("poilice", "Utilities").toFixed(3));
console.log("sim(Dubai Police) =", charSimilarity("poilice", "Dubai Police — Traffic Fines").toFixed(3));
console.log(pass ? "ALL_PASS" : "SOME_FAIL");
