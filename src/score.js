// Normalization, stage derivation, equity estimate, and lead scoring.
// Collectors return partial leads; enrichers fill property fields; this turns
// the merged record into the exact shape the CRM consumes.
import { judgmentAmountOf } from "./value-math.js";
import { PROFILE } from "./profile.js";

const MS_DAY = 864e5;
const CHI_FMT = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Chicago",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

// Calendar date (YYYY-MM-DD) in America/Chicago for an instant.
export function chicagoDate(d = new Date()) {
  const parts = Object.fromEntries(
    CHI_FMT.formatToParts(d).map((p) => [p.type, p.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function chicagoToday(now = new Date()) {
  return chicagoDate(now);
}

// Whole calendar days from today (Chicago) to a YYYY-MM-DD date. A sale dated
// tomorrow is 1 at any hour of the Chicago day, never 0 because the container
// runs on UTC.
export function daysTo(dateStr, today = new Date()) {
  if (!dateStr) return null;
  let ymd = String(dateStr).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) {
    const t = Date.parse(dateStr);
    if (Number.isNaN(t)) return null;
    ymd = chicagoDate(new Date(t));
  }
  const a = Date.parse(chicagoDate(today) + "T00:00:00Z");
  const b = Date.parse(ymd + "T00:00:00Z");
  if (Number.isNaN(b)) return null;
  return Math.round((b - a) / MS_DAY);
}

// Stage from the IL judicial-foreclosure paper trail (see MASTER_PROMPT §3).
export function deriveStage(lead, today = new Date()) {
  const d = daysTo(lead.sale, today);
  if (d != null && d >= 0) {
    if (d <= 7) return "auction_imminent";
    if (d <= 30) return "notice_of_sale";
    return "judgment"; // sale scheduled but >30d out
  }
  if (lead.judgment || lead.judgmentAmount || lead.judgmentDate)
    return "judgment";
  return "lis_pendens"; // filed, no sale date yet = earliest signal
}

// Illinois assessed value is 1/3 of fair market (33.33% level of assessment),
// except Cook, which assesses residential property at 10%.
function estMarketFrom(lead) {
  if (lead.estMarket) return lead.estMarket;
  if (lead.assessed) {
    const mult = lead.county === "Cook" ? 10 : 3;
    return Math.round((lead.assessed * mult) / 1000) * 1000;
  }
  if (lead.lastSalePrice) return Math.round(lead.lastSalePrice * 1.25);
  return null;
}
// Debt estimate: opening bid ≈ payoff; else ~80% of last sale price.
function estDebtFrom(lead) {
  if (lead.estDebt) return lead.estDebt;
  if (lead.openingBid) return lead.openingBid;
  if (lead.lastSalePrice) return Math.round(lead.lastSalePrice * 0.8);
  return null;
}

export function leadScore(lead) {
  let s = 0;
  const eqPct =
    lead.estMarket && lead.estEquity != null
      ? lead.estEquity / lead.estMarket
      : 0;
  s += Math.max(0, Math.min(40, Math.round(eqPct * 80))); // equity up to 40
  if (lead.absentee) s += 20; // reachable / motivated
  const d = daysTo(lead.sale);
  if (d != null && d >= 0) s += d <= 7 ? 20 : d <= 30 ? 16 : 10; // urgency
  if (lead.caseNumber) s += 10; // confirmed case
  if (lead.phone || lead.email) s += 10; // already reachable
  return Math.max(1, Math.min(99, s));
}

function legacyAbsentee(lead) {
  return lead.mailing && lead.address
    ? !lead.mailing
        .toUpperCase()
        .includes(String(lead.address).toUpperCase().slice(0, 10))
    : false;
}

const DIRS = new Set(["N", "S", "E", "W", "NORTH", "SOUTH", "EAST", "WEST", "NE", "NW", "SE", "SW"]);
const SUFFIX = new Set(["ST", "STREET", "AVE", "AV", "AVENUE", "RD", "ROAD", "DR", "DRIVE", "LN", "LANE", "CT", "COURT", "PL", "PLACE", "BLVD", "BOULEVARD", "TER", "TERRACE", "CIR", "CIRCLE", "TRL", "TRAIL", "PKWY", "PARKWAY", "HWY", "WAY"]);

// "1826 1/2 S 13TH AVE" -> { num: 1826, street: "13TH" }. Directionals,
// suffixes and a "1/2" (two-flat) are ignored.
export function streetKey(addr) {
  const toks = String(addr || "")
    .toUpperCase()
    .replace(/[.,#]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  const m = /^(\d+)/.exec(toks[0] || "");
  if (!m) return null;
  const rest = toks.slice(1).filter((t) => t !== "1/2" && !DIRS.has(t));
  const street = rest.find((t) => !SUFFIX.has(t)) || rest[0] || "";
  return { num: Number(m[1]), street };
}

// Split "902 N 5TH AVE, MAYWOOD, IL 60153" into street / city / zip.
function parseMailing(m) {
  const s = String(m || "").toUpperCase();
  const [street, ...tail] = s.split(",");
  const rest = tail.join(" ").trim();
  const zip = /\b(\d{5})(?:[-\s]\d{4})?\s*$/.exec(rest)?.[1] || null;
  const city = rest
    .replace(/\b\d{5}(?:[-\s]\d{4})?\s*$/, "")
    .replace(/\b[A-Z]{2}\s*$/, "")
    .replace(/[^A-Z ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return { street: street.trim(), city: city || null, zip };
}

// Absentee only when the owner's mailing address is a different house: a
// different city or zip, a different street, or a house number more than 2 off.
export function isAbsentee(lead) {
  if (!lead.mailing || !lead.address) return false;
  const mail = parseMailing(lead.mailing);
  if (/\bP\s*O\s*BOX\b|\bPOB\b/.test(mail.street)) return true;
  const a = streetKey(lead.address);
  const b = streetKey(mail.street);
  if (!a || !b) return false;
  const city = String(lead.city || "").toUpperCase().replace(/\s+/g, " ").trim();
  if (city && mail.city && city !== mail.city) return true;
  const zip = String(lead.zip || "").slice(0, 5);
  if (zip && mail.zip && zip !== mail.zip) return true;
  if (a.street !== b.street) return true;
  return Math.abs(a.num - b.num) > 2;
}

// Finalize a merged raw+enriched lead into the CRM record shape.
export function finalize(lead, idx, today = new Date()) {
  const out = { ...lead };
  out.id = lead.id ?? idx + 1;
  out.estMarket = estMarketFrom(lead);
  out.estDebt = estDebtFrom(lead);
  out.estEquity =
    out.estMarket != null && out.estDebt != null
      ? out.estMarket - out.estDebt
      : 0;
  out.stage = lead.stage || deriveStage(lead, today);
  const j = judgmentAmountOf(lead);
  if (j && out.judgmentAmount == null) out.judgmentAmount = j;
  // Vince uses the canonical absentee check (P1-6); Z keeps its original rule.
  out.absentee =
    lead.absentee ??
    (PROFILE.name === "vince" ? isAbsentee(lead) : legacyAbsentee(lead));
  // base desirability score + a confirmation bonus (multi-source = more trustworthy)
  let s = lead.score ?? leadScore(out);
  if (lead.confirmations > 1)
    s = Math.min(99, s + (lead.confirmations - 1) * 7);
  out.score = s;
  return out;
}

// Dedupe by case number, else by address+county.
export function dedupe(leads) {
  const seen = new Map();
  for (const l of leads) {
    const key = (l.caseNumber || `${l.address}|${l.county}`)
      .toUpperCase()
      .trim();
    const prev = seen.get(key);
    // keep the richer record (more filled fields)
    if (
      !prev ||
      Object.values(l).filter(Boolean).length >
        Object.values(prev).filter(Boolean).length
    )
      seen.set(key, l);
  }
  return [...seen.values()];
}
