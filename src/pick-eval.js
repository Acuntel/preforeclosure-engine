// Scores ONE lead for the one-a-day pick (spec P0-2..P0-4, P1-1, P1-3):
// hard gates, then EV = equity x P_stage x P_contact x P_conf x P_prox.
import { daysTo } from "./score.js";
import { valuation, assessorAnchor, num } from "./value-math.js";
import { ownerClass, isEstate } from "./owner.js";
import {
  leadDistanceMi,
  locationPrecision,
  proxFactor,
  RADIUS_MI,
} from "./proximity.js";
import { PROFILE } from "./profile.js";
import { gateReason, buildReasons } from "./pick-copy.js";

export const DEAD_STATUS = /cancel|plaintiff|third party|sold|vacat|dismiss/i;
const env = (k, d) =>
  process.env[k] != null && process.env[k] !== "" ? Number(process.env[k]) : d;

export const settings = () => ({
  radiusMi: RADIUS_MI,
  minRunway: env("VINCE_MIN_RUNWAY_DAYS", 10),
  minGap: env("VINCE_MIN_GAP", 50000),
  minGapPct: env("VINCE_MIN_GAP_PCT", 20),
  // Floor on the weighted score, so an exhausted pool sends the honest
  // no-deal line (D4) instead of a filler lead.
  minEv: env("VINCE_MIN_EV", 50000),
  probateMin: env("VINCE_PROBATE_MIN_VALUE", 150000),
  probateEquityPct: env("VINCE_PROBATE_EQUITY_PCT", 0.4),
});

const P_CONF = { high: 1, medium: 0.85, low: 0.6 };
const FORECLOSURE_SRC =
  /tjsc|intercounty|sheriff|recorder|public-notice|lis_pendens|judgment|auction|notice_of_sale|foreclos/i;
const TAX_SRC = /tax|treasurer/i;
const CODE_SRC = /violation|code_/i;
const PROBATE_SRC = /probate|death/i;

function allStatuses(lead) {
  return [lead.status, ...(lead.statuses || [])].filter(Boolean).map(String);
}

// Distinct distress CATEGORIES (not source count). Estate markers in a
// foreclosure caption are the x1.15 bonus, not a second category.
function categories(lead) {
  const tags = [lead.signal, ...(lead.sources || [])].filter(Boolean).map(String);
  const cats = new Set();
  const fcCase = /CH|FC/i.test(String(lead.caseNumber || ""));
  if (tags.some((t) => FORECLOSURE_SRC.test(t) && !PROBATE_SRC.test(t)) || lead.sale || fcCase)
    cats.add("foreclosure");
  if (tags.some((t) => PROBATE_SRC.test(t))) cats.add("probate");
  if (tags.some((t) => TAX_SRC.test(t)) || /delinq/i.test(lead.taxStatus || "")) cats.add("tax");
  if (tags.some((t) => CODE_SRC.test(t))) cats.add("code");
  if (tags.some((t) => /divorce/i.test(t))) cats.add("divorce");
  return cats;
}

function stageOf(lead, d) {
  if (d != null) {
    if (d > 90) return { stage: "sale_90_plus", w: 0.8 };
    if (d >= 22) return { stage: "sale_22_90", w: 1 };
    return { stage: "sale_10_21", w: 0.85 };
  }
  if (num(lead.judgmentAmount) || num(lead.judgment) || lead.judgmentDate)
    return { stage: "judgment", w: 0.9 };
  const cats = categories(lead);
  if (!cats.has("foreclosure") && cats.has("probate"))
    return { stage: "probate", w: 0.8 };
  return { stage: "lis_pendens", w: 0.8 };
}

// A probate notice gives the decedent's address, not proof the estate owns it.
// When the county tax bill names an owner, it must carry the decedent's surname
// (a sold house, a rental, or a wrong parcel match fails this).
const SUFFIX = /^(JR|SR|II|III|IV)$/;
export function estateOwnsHouse(lead) {
  const tax = String(lead.taxOwner || "").toUpperCase();
  const dec = String(lead.decedent || "").toUpperCase();
  if (!tax || !dec) return true; // nothing to compare against
  const words = dec.replace(/[^A-Z ]/g, " ").split(/\s+/).filter((w) => w && !SUFFIX.test(w));
  const surname = words.at(-1);
  return !!surname && new RegExp(`\\b${surname}\\b`).test(tax);
}

// Estate with no debt figure (P1-3): qualifies on a conservative equity
// estimate when the house is worth enough and carries no known recent loan.
function probatePath(lead, v, estate, cats, cfg, now) {
  if (!estate || v.payoff != null) return null;
  if (!estateOwnsHouse(lead)) return null;
  const anchor = assessorAnchor(lead);
  if (!anchor || anchor < cfg.probateMin) return null;
  const saleDate = String(lead.lastSaleDate || "");
  const tenYearsAgo = `${now.getUTCFullYear() - 10}${now.toISOString().slice(4, 10)}`;
  const oldPurchase = saleDate && saleDate <= tenYearsAgo;
  // a foreclosure means a mortgage is on record, so it needs the old purchase
  const noMortgage = !cats.has("foreclosure") && !saleDate;
  if (!oldPurchase && !noMortgage) return null;
  const equity = Math.round((anchor * cfg.probateEquityPct) / 1000) * 1000;
  return { market: anchor, payoff: anchor - equity, equity, oldPurchase };
}

// Spec section 5: every pick's gap is backed by a judgment or bid, or by
// comps that agree with the assessor. The probate path (P1-3) is its own rule.
function backed(v, probate) {
  if (probate) return true;
  // A court figure backs the payoff only; the market side still needs the
  // county assessor, or a zip median stands in for the house (review 09-28).
  if (v.anchor == null) return false;
  if (v.payoffBasis === "judgment" || v.payoffBasis === "opening bid") return true;
  return v.marketBasis === "comps" && v.anchor != null;
}

export function evaluate(lead, ctx = {}) {
  const now = ctx.now || new Date();
  const cfg = { ...settings(), ...(ctx.settings || {}) };
  const d = daysTo(lead.sale, now);
  const v = valuation(lead);
  const owner = ownerClass(lead);
  const estate = isEstate(lead) || owner.kind === "estate";
  const cats = categories(lead);
  const mi = leadDistanceMi(lead);
  const precision = locationPrecision(lead);
  const probate = probatePath(lead, v, estate, cats, cfg, now);

  const market = probate ? probate.market : v.market;
  const payoff = probate ? probate.payoff : v.payoff;
  const equity = probate ? probate.equity : v.gap;
  const equityPct =
    market && equity != null ? Math.round((equity / market) * 100) : null;
  const confidence = probate ? "low" : v.confidence;

  const st = stageOf(lead, d);
  let pStage = st.w;
  // A dead owner's heirs need time to open probate before they can sell, so the
  // estate bonus only applies with real runway (or no sale set yet).
  if (estate && (d == null || d >= 21)) pStage *= 1.15;
  if (cats.size >= 2) pStage *= 1.1;
  if (owner.govCoParty) pStage *= 1.05; // D5: HUD/US next to a person
  const pContact = lead.phone ? 1.1 : owner.name ? 1 : 0;
  const pConf = P_CONF[confidence] ?? 0;
  const pProx = proxFactor(mi);
  const ev =
    equity > 0 ? Math.round(equity * pStage * pContact * pConf * pProx) : 0;

  const terms = {
    market,
    marketBasis: probate ? "assessor" : v.marketBasis,
    payoff,
    payoffBasis: probate ? "probate estimate" : v.payoffBasis,
    equity,
    equityPct,
    confidence,
    pStage: Math.round(pStage * 1000) / 1000,
    pContact,
    pConf,
    pProx,
    runwayDays: d,
    distanceMi: mi,
    estate,
    stage: st.stage,
    govCoParty: owner.govCoParty,
    anchor: v.anchor,
    compsEvents: v.compsEvents,
    compsRejected: v.compsRejected,
    owner: owner.name,
    ownerKind: owner.kind,
    probatePath: !!probate,
    evScore: ev,
  };

  const city = String(lead.city || "").toUpperCase();
  const excluded = (PROFILE.excludeCities || []).some((c) => city.includes(c));
  const chicago =
    lead.county === "Cook" &&
    city.includes("CHICAGO") &&
    !/CHICAGO (HEIGHTS|RIDGE)/.test(city);
  let gate = null;
  if (allStatuses(lead).some((s) => DEAD_STATUS.test(s))) gate = "dead_status";
  else if (d != null && d < 0) gate = "sale_passed";
  else if (d != null && d < cfg.minRunway) gate = "short_runway";
  else if (!lead.address || !/\d/.test(String(lead.address)))
    gate = "no_address";
  else if (owner.kind === "missing") gate = "no_owner";
  else if (owner.kind === "entity" || owner.kind === "gov")
    gate = "entity_owner";
  else if (
    excluded ||
    chicago ||
    mi == null ||
    precision === "county" ||
    mi > cfg.radiusMi
  )
    gate = "out_of_radius";
  else if (ctx.isSent && ctx.isSent(lead)) gate = "already_sent";
  else if (estate && v.payoff == null && !estateOwnsHouse(lead))
    gate = "estate_not_owner";
  else if (confidence === "suspect") gate = "suspect_value";
  else if (equity == null || equity <= 0) gate = "no_gap";
  else if (!backed(v, probate)) gate = "weak_value";
  else if (equity < cfg.minGap || equityPct < cfg.minGapPct) gate = "small_gap";
  else if (ev < cfg.minEv) gate = "low_ev";

  const ok = gate == null;
  const reasons = ok
    ? buildReasons(lead, terms)
    : [gateReason(gate, lead, terms, cfg)];
  return { ok, gate, ev, terms, reasons };
}
