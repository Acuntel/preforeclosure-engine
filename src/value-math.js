// Pure value math for the Vince pick (spec P0-2). No I/O, safe to run on live
// leads and on archived pools. Market value is anchored to the county assessor
// and only trusts comps that agree with it; payoff uses the strongest real
// figure we hold and flags anything weaker as a guess.

export const num = (v) => {
  if (v == null || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) && v > 0 ? v : null;
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s) || /^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(s))
    return null; // a date, not money
  const n = Number(s.replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
};

export const median = (xs) => {
  const a = xs.filter((x) => x != null).sort((x, y) => x - y);
  if (!a.length) return null;
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : Math.round((a[m - 1] + a[m]) / 2);
};

const round1k = (n) => Math.round(n / 1000) * 1000;

const MIN_COMPS = Number(process.env.VINCE_MIN_COMPS || 5);
const BAND_LO = 0.55;
const BAND_HI = 1.8;
const GUESS_SINCE = "2008-01-01";

// Comps are whole-zip (MyDec) or PIN-block (Cook) medians with no sqft, so they
// run above the assessor anchor by the county's assessment lag plus a mix bias.
// The market is capped at anchor x this lag, set from the median comps/anchor
// ratio of in-radius leads in the Aug to Sep 2026 pools (Cook 1.15, Lake 1.14,
// Will 1.34, DuPage 1.07). Override with VINCE_MARKET_CAP_<COUNTY>=1.3.
const COUNTY_LAG = { Cook: 1.15, Lake: 1.15, Will: 1.35, DuPage: 1.1 };
const DEFAULT_LAG = 1.2;
export function countyLag(county) {
  const k = `VINCE_MARKET_CAP_${String(county || "").toUpperCase().replace(/[^A-Z]/g, "")}`;
  const v = Number(process.env[k]);
  if (Number.isFinite(v) && v > 0) return v;
  return COUNTY_LAG[county] ?? DEFAULT_LAG;
}

// A townhome, condo or PUD is compared against detached houses in a zip
// median, so its comps are not trusted. Unit numbers are caught in value.js.
const ATTACHED_RE = /\bTOWN ?HOMES?\b|\bTOWN ?HOUSES?\b|\bCONDO(MINIUM)?S?\b|\bP\.?\s?U\.?\s?D\b/i;
export function attachedHome(lead) {
  return [lead.owner, lead.defendant, lead.caption, lead.propertyClass, lead.propertyType]
    .filter(Boolean)
    .some((f) => ATTACHED_RE.test(String(f)));
}

// A court payoff this small next to the value is often a second loan or an
// association lien, with the first mortgage still owed on top of it.
const JUNIOR_SHARE = 0.25;
const JUNIOR_LENDER_RE = /\bMCLP\b|\bASSOCIATION\b|\bASSN\b|\bHOA\b|HOME ?EQUITY|\bHELOC\b|\bCONDOMINIUM\b/i;

// Cook assesses residential property at 10% of market; the collar counties
// (and DuPage's pre-exemption FCV total) sit at the statutory 33.33%.
export function assessorAnchor(lead) {
  const av = num(lead.fcvTotal) ?? num(lead.assessed);
  if (!av) return null;
  const mult = lead.county === "Cook" ? 10 : 3;
  const anchor = round1k(av * mult);
  // Placeholder parcels (exempt or unassessed, e.g. a $1 FCV) are not a value.
  return anchor >= 20000 ? anchor : null;
}

// Numeric judgment only. Some collectors write the dollar judgment into
// `judgment`, which CONTRACT.md defines as a date; `judgmentAmount` wins.
export function judgmentAmountOf(lead) {
  return num(lead.judgmentAmount) ?? num(lead.judgment);
}

const COMPLETED_SALE = /plaintiff|third party|sold/i;

// Intercounty stores the post-sale winning bid in openingBid once a sale has
// happened. That is not a payoff figure, so it is ignored for completed sales.
export function trueOpeningBid(lead) {
  const bid = num(lead.openingBid);
  if (!bid) return null;
  const statuses = [lead.status, ...(lead.statuses || [])].filter(Boolean);
  if (statuses.some((s) => COMPLETED_SALE.test(String(s)))) return null;
  return bid;
}

// Distinct sale events among the comps. Live leads carry `compsDistinct` from
// value.js. Archived leads only kept 5 sample comps, so we count distinct
// (price, date) pairs in the sample and assume the unseen rest are distinct.
export function distinctCompEvents(lead) {
  if (Number.isFinite(lead.compsDistinct)) return lead.compsDistinct;
  const comps = Array.isArray(lead.comps) ? lead.comps : [];
  const seen = new Set(comps.map((c) => `${num(c.price)}|${c.date}`));
  const total = Number(lead.compsCount) || comps.length;
  return seen.size + Math.max(0, total - comps.length);
}

// Market value + where it came from.
export function marketValue(lead) {
  const anchor = assessorAnchor(lead);
  const events = distinctCompEvents(lead);
  const comps = Array.isArray(lead.comps) ? lead.comps : [];
  const sqft = num(lead.sqft);
  let compsMed = null;
  const ppsf = comps
    .filter((c) => num(c.sqft) && num(c.price))
    .map((c) => num(c.price) / num(c.sqft));
  if (sqft && ppsf.length >= MIN_COMPS) compsMed = round1k(median(ppsf) * sqft);
  else compsMed = num(lead.compsMedian);
  const out = { anchor, compsMedian: compsMed, compsEvents: events };
  const ratio = compsMed && anchor ? Math.round((compsMed / anchor) * 100) / 100 : null;
  out.ratio = ratio;
  if (anchor && compsMed && attachedHome(lead))
    return { ...out, market: anchor, basis: "assessor", anchored: true, compsRejected: "attached home" };
  if (compsMed && events >= MIN_COMPS) {
    if (!anchor)
      return { ...out, market: compsMed, basis: "comps", anchored: false };
    if (ratio >= BAND_LO && ratio <= BAND_HI) {
      const cap = round1k(anchor * countyLag(lead.county));
      if (compsMed > cap)
        return { ...out, market: cap, basis: "comps", anchored: true, capped: true };
      return { ...out, market: compsMed, basis: "comps", anchored: true };
    }
    return {
      ...out,
      market: anchor,
      basis: "assessor",
      anchored: true,
      compsRejected: "out of band",
    };
  }
  if (anchor)
    return {
      ...out,
      market: anchor,
      basis: "assessor",
      anchored: true,
      compsRejected: compsMed ? "too few distinct sales" : null,
    };
  return { ...out, market: null, basis: null, anchored: false };
}

// Payoff, strongest figure first. `guess` marks the last-sale estimate.
export function payoffEstimate(lead, market) {
  const j = judgmentAmountOf(lead);
  if (j)
    return { payoff: Math.round(j * 1.1), basis: "judgment", guess: false };
  const bid = trueOpeningBid(lead);
  if (bid)
    return { payoff: Math.round(bid), basis: "opening bid", guess: false };
  const mort = num(lead.mortgageBalance) ?? num(lead.mortgageAmount);
  if (mort)
    return { payoff: Math.round(mort), basis: "mortgage", guess: false };
  const ask = num(lead.askingPrice);
  if (ask)
    return { payoff: Math.round(ask), basis: "asking price", guess: false };
  const sale = num(lead.lastSalePrice);
  const date = String(lead.lastSaleDate || "");
  // An old or tiny "sale" (quitclaim, family transfer) is not arm's length.
  if (sale && date >= GUESS_SINCE && (!market || sale >= market * 0.35))
    return { payoff: Math.round(sale * 0.9), basis: "last sale", guess: true };
  return { payoff: null, basis: null, guess: false };
}

// Full valuation: market, payoff, gap, confidence tier.
//   high    judgment or real bid payoff, plus an assessor-anchored market
//   medium  a real payoff (mortgage, asking, or court figure on unanchored comps)
//   low     payoff is the last-sale guess, or a court figure under a quarter
//           of the value (it may be a second loan; juniorRisk is set)
//   suspect gap over $2M, or over 60% on an unanchored market, with no court
//           figure behind it,
//           or a small court figure from a second-lien or association plaintiff
export function valuation(lead) {
  const m = marketValue(lead);
  const p = payoffEstimate(lead, m.market);
  const base = {
    market: m.market,
    marketBasis: m.basis,
    anchor: m.anchor,
    compsEvents: m.compsEvents,
    compsRejected: m.compsRejected || null,
    compsRatio: m.ratio ?? null,
    marketCapped: !!m.capped,
    juniorRisk: false,
    payoff: p.payoff,
    payoffBasis: p.basis,
    payoffGuess: p.guess,
  };
  if (m.market == null)
    return {
      ...base,
      gap: null,
      gapPct: null,
      confidence: "unknown",
      basis: "no value data",
    };
  if (p.payoff == null)
    return {
      ...base,
      gap: null,
      gapPct: null,
      confidence: "unknown",
      basis: "no payoff figure",
    };
  const gap = Math.round(m.market - p.payoff);
  const gapPct = Math.round((gap / m.market) * 100);
  const hard = p.basis === "judgment" || p.basis === "opening bid";
  let confidence;
  if (p.guess) confidence = "low";
  else if (hard && m.anchored) confidence = "high";
  else confidence = "medium";
  // A long-held owner with an assessor-anchored value is the deal Vince wants,
  // so a big gap is only suspect when the market side is not anchored.
  if (!hard && (gap > 2_000_000 || (gapPct > 60 && !m.anchored)))
    confidence = "suspect";
  // A hard payoff under a quarter of the value may be a junior lien. A known
  // second-lien or association plaintiff makes that likely, so it is suspect.
  if (hard && p.payoff < m.market * JUNIOR_SHARE) {
    base.juniorRisk = true;
    if (JUNIOR_LENDER_RE.test(String(lead.lender || lead.plaintiff || "")))
      confidence = "suspect";
    else if (confidence !== "suspect") confidence = "low";
  }
  const payLabel = p.guess ? "last sale estimate" : p.basis;
  return {
    ...base,
    gap,
    gapPct,
    confidence,
    basis: `${m.basis} value minus ${payLabel}`,
  };
}
