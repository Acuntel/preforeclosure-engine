// Cross-confirmation engine. Groups raw records that refer to the SAME property
// across different sources (by case number, PIN, or normalized address), merges
// them into one lead, and records how many INDEPENDENT sources confirm it plus
// any field-level CONFLICTS between sources. This is what lets us say "3 free
// sources agree on this lead" instead of trusting one scrape.

const DIR = { NORTH: "N", SOUTH: "S", EAST: "E", WEST: "W", NO: "N", SO: "S" };
const SUF = {
  STREET: "ST",
  ST: "ST",
  AVENUE: "AVE",
  AVE: "AVE",
  ROAD: "RD",
  RD: "RD",
  DRIVE: "DR",
  DR: "DR",
  LANE: "LN",
  LN: "LN",
  COURT: "CT",
  CT: "CT",
  PLACE: "PL",
  PL: "PL",
  BOULEVARD: "BLVD",
  BLVD: "BLVD",
  TERRACE: "TER",
  CIRCLE: "CIR",
  TRAIL: "TRL",
  PARKWAY: "PKWY",
  HIGHWAY: "HWY",
  HWY: "HWY",
};

// Canonical street key: "3737 ROBEY AVE" — number + normalized street, unit/punct stripped.
export function normAddr(a) {
  if (!a) return "";
  let s = String(a)
    .toUpperCase()
    .replace(/[.,#]/g, " ")
    .replace(/\b(UNIT|APT|STE|SUITE|LOT|#)\b.*$/, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!/\d/.test(s)) return ""; // need a house number to be a usable key
  return s
    .split(" ")
    .filter(Boolean)
    .map((t) => DIR[t] || SUF[t] || t)
    .join(" ");
}
// Canonicalize IL case numbers so format variants match:
//   "2025 FC 394" / "2025-FC-0000394" / "25 FC 394"  ->  "2025FC394"
export function normCase(c) {
  if (!c) return "";
  const raw = String(c)
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
  const m = raw.match(/^(\d{2,4})(CH|FC|MR|AR|LM|TX|CV)(\d+)$/);
  if (m) {
    let y = m[1];
    if (y.length === 2) y = "20" + y;
    return y + m[2] + String(parseInt(m[3], 10)); // strip leading zeros on seq #
  }
  return raw;
}
const normName = (n) =>
  n
    ? String(n)
        .toUpperCase()
        .replace(/[^A-Z]/g, "")
        .slice(0, 14)
    : "";

// union-find
function find(parent, i) {
  while (parent[i] !== i) {
    parent[i] = parent[parent[i]];
    i = parent[i];
  }
  return i;
}
function union(parent, a, b) {
  parent[find(parent, a)] = find(parent, b);
}

const SRC_LABEL = {
  tjsc: "TJSC judicial sales",
  "public-notice-il": "Public Notice IL",
  "roup-winnebago": "Winnebago sheriff (Roup)",
  "will-treasurer": "Will treasurer (delinquent)",
  "judici-boone": "Judici (Boone)",
  intercounty: "Intercounty Judicial Sales",
  "boone-sheriff": "Boone County Sheriff",
  "lake-sheriff": "Lake County Sheriff",
  "kane-sheriff": "Kane County Sheriff",
  "mchenry-sheriff": "McHenry County Sheriff",
  "will-sheriff": "Will County Sheriff",
  "recorder-lake": "Lake Recorder (lis pendens)",
  "recorder-will": "Will Recorder (lis pendens)",
};
const label = (id) => SRC_LABEL[id] || id;

/**
 * Group records that share a strong key, merge each group, and annotate with
 * confirmations / confidence / conflicts / sources.
 * @returns merged leads (one per real property)
 */
export function corroborate(records) {
  const n = records.length;
  const parent = Array.from({ length: n }, (_, i) => i);

  // index every strong key -> first record that owns it, union on collision
  const byKey = new Map();
  // EVERY key is scoped to county: IL case numbers (e.g. "25 FC 360") and PINs
  // are NOT unique across counties — each county numbers its own cases — so a key
  // must never match across county lines or we'd falsely "confirm" two different
  // properties. County is the namespace for all three keys.
  const keysOf = (r) => {
    const co = (r.county || "").toUpperCase();
    const ks = [];
    const ck = normCase(r.caseNumber);
    if (ck) ks.push("C:" + co + ":" + ck);
    if (r.pin) ks.push("P:" + co + ":" + String(r.pin).replace(/[^0-9]/g, ""));
    const ak = normAddr(r.address);
    if (ak) ks.push("A:" + co + ":" + ak);
    return ks;
  };
  records.forEach((r, i) => {
    for (const k of keysOf(r)) {
      if (byKey.has(k)) union(parent, i, byKey.get(k));
      else byKey.set(k, i);
    }
  });

  // gather groups
  const groups = new Map();
  for (let i = 0; i < n; i++) {
    const root = find(parent, i);
    (groups.get(root) || groups.set(root, []).get(root)).push(records[i]);
  }

  const merged = [];
  for (const recs of groups.values()) {
    const out = mergeGroup(recs);
    merged.push(out);
  }
  return merged;
}

function pickNonEmpty(recs, key) {
  for (const r of recs) if (r[key] != null && r[key] !== "") return r[key];
  return undefined;
}

function mergeGroup(recs) {
  // base: union all fields, first-non-empty wins (enriched values already merged per record)
  const out = {};
  const allKeys = new Set();
  recs.forEach((r) => Object.keys(r).forEach((k) => allKeys.add(k)));
  for (const k of allKeys) {
    const v = pickNonEmpty(recs, k);
    if (v !== undefined) out[k] = v;
  }

  // distinct sources confirming this property. Handle both raw records (single
  // `_src`) and already-merged leads from an earlier pass (a `sources` array),
  // so multiple corroboration passes UNION sources instead of discarding them.
  const sources = [
    ...new Set(
      recs.flatMap((r) =>
        r.sources && r.sources.length ? r.sources : r._src ? [r._src] : [],
      ),
    ),
  ];
  out.sources = sources;
  out.sourceLabels = sources.map(label);
  out.confirmations = sources.length;
  // the county assessor returning a matching parcel = an independent verification
  out.recordVerified = recs.some((r) => r.recordVerified);
  // total independent signals = foreclosure feeds + (assessor record, if matched)
  const signals = sources.length + (out.recordVerified ? 1 : 0);
  out.confidence =
    signals >= 3 ? "strong" : signals === 2 ? "confirmed" : "single";

  // conflicts: where two sources disagree on a key field
  const conflicts = [];
  const distinct = (key, norm = (x) => String(x)) => {
    const vals = [
      ...new Set(
        recs
          .map((r) => r[key])
          .filter((v) => v != null && v !== "")
          .map(norm),
      ),
    ];
    return vals;
  };
  const saleDates = distinct("sale");
  if (saleDates.length > 1) {
    conflicts.push({ field: "saleDate", values: saleDates });
    out.sale = saleDates.sort()[0];
  } // keep soonest
  const cases = distinct("caseNumber", normCase);
  if (cases.length > 1)
    conflicts.push({
      field: "caseNumber",
      values: [...new Set(recs.map((r) => r.caseNumber).filter(Boolean))],
    });
  const owners = distinct("owner", normName);
  if (owners.length > 1)
    conflicts.push({
      field: "owner",
      values: [...new Set(recs.map((r) => r.owner).filter(Boolean))],
    });
  out.conflicts = conflicts;

  // a one-line provenance string for the UI
  const parts = [...out.sourceLabels];
  if (out.recordVerified) parts.push("County assessor (verified)");
  out.confirmText =
    parts.length > 1
      ? `${parts.length} sources align: ${parts.join(" + ")}`
      : `1 source: ${parts[0] || "unknown"}`;
  return out;
}
