// Value-gap ranking for the Vince profile. Vince's gig: knock, offer ~$5k cash,
// step into the deal where the home is worth well MORE than what's owed — biggest
// under-market spread wins (NOT cheapest absolute price). So we rank by the dollar
// gap between an anchored market value and the debt/payoff, and back the market
// number with real neighborhood comps where we can pull them.
import { fetchJson } from "./http.js";

const COOK_BASE = "https://datacatalog.cookcountyil.gov/resource";
const SALES = `${COOK_BASE}/wvhk-k5uv.json`; // pin, sale_price, sale_date
// IL Dept of Revenue MyDec transfer declarations (PTAX-203) — real arms-length
// SOLD prices with address + PIN + county for EVERY IL county, one free Socrata
// endpoint, refreshed weekly. This is how we anchor ARV outside Cook.
const MYDEC = "https://data.illinois.gov/resource/it54-y4c6.json";
const APP_TOKEN = process.env.SOCRATA_APP_TOKEN || "";
const socrataOpts = APP_TOKEN ? { headers: { "X-App-Token": APP_TOKEN } } : {};

const num = (v) => {
  const n = Number(String(v ?? "").replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
};
const median = (xs) => {
  const a = xs.filter((x) => x != null).sort((x, y) => x - y);
  if (!a.length) return null;
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : Math.round((a[m - 1] + a[m]) / 2);
};

// Pure gap math. A real under-market gap needs BOTH a value AND a payoff/cost
// figure — with no debt we do NOT assume $0 owed (that's what produced fake "100%
// under market" $16M gaps). No debt basis → gap unknown, judged on other signals.
export function valueGap(lead) {
  const market = lead.estMarketComps || lead.estMarket || null;
  const debt = lead.estDebt || null; // numeric: opening bid, asking price, or ~80% last sale
  if (market == null)
    return {
      gap: null,
      gapPct: null,
      confidence: "unknown",
      basis: "no value data",
    };
  if (debt == null)
    return {
      gap: null,
      gapPct: null,
      confidence: "unknown",
      basis: "no payoff/cost figure",
    };
  const gap = market - debt;
  const gapPct = Math.round((gap / market) * 100);
  // a HARD cost figure (opening bid / asking price / mortgage) beats a guess
  const hardCost =
    lead.openingBid != null ||
    lead.askingPrice != null ||
    lead.mortgageBalance != null;
  let confidence = "low";
  if (lead.estMarketComps && hardCost) confidence = "high";
  else if (lead.estMarketComps || hardCost) confidence = "medium";
  // an implausible spread on soft data is almost always bad data, not a unicorn deal
  if ((gapPct > 85 || gap > 2_000_000) && confidence !== "high")
    confidence = "suspect";
  return {
    gap,
    gapPct,
    confidence,
    basis: `${lead.estMarketComps ? "comps" : "assessor"} value − ${
      lead.openingBid != null
        ? "opening bid"
        : lead.askingPrice != null
          ? "asking price"
          : lead.mortgageBalance != null
            ? "mortgage"
            : "est. cost"
    }`,
  };
}

// Cook neighborhood comps by PIN geography: parcels in the same block share the
// first 7 PIN digits (area-township-block). Recent nearby sales anchor the market
// value with real transactions rather than an assessment multiple. Best-effort;
// returns null on any miss so scoring degrades gracefully.
async function cookComps(lead) {
  const pin = String(lead.pin || "").replace(/\D/g, "");
  if (pin.length < 10) return null;
  const prefix = pin.slice(0, 7); // block-level neighborhood
  const since = new Date(Date.now() - 730 * 864e5).toISOString().slice(0, 10);
  const where = `starts_with(pin, '${prefix}') AND sale_date > '${since}' AND sale_price > 20000`;
  const url =
    `${SALES}?$where=${encodeURIComponent(where)}` +
    `&$order=${encodeURIComponent("sale_date DESC")}&$limit=60`;
  let rows;
  try {
    rows = await fetchJson(url);
  } catch {
    return null;
  }
  const prices = (rows || []).map((r) => num(r.sale_price)).filter(Boolean);
  if (prices.length < 3) return null;
  const med = median(prices);
  const comps = (rows || []).slice(0, 5).map((r) => ({
    pin: r.pin,
    price: num(r.sale_price),
    date: String(r.sale_date || "").slice(0, 10),
  }));
  return { median: med, n: prices.length, comps };
}

// MyDec ARV comps for ANY IL county — recent ARMS-LENGTH sold prices near the
// subject (same zip, else same PIN-section), last 24 months, EXCLUDING distressed
// sales (REO/short/auction/court-ordered) that would drag ARV down. Median = a
// defensible resale number Vince can stand behind at the door. Best-effort → null.
async function mydecComps(lead) {
  const zip = String(lead.zip || "").match(/\d{5}/)?.[0];
  const pin = String(lead.pin || "").replace(/\D/g, "");
  const county = lead.county;
  if (!county || (!zip && pin.length < 8 && !lead.city)) return null;
  const since = new Date(Date.now() - 730 * 864e5).toISOString().slice(0, 10);
  const geo = zip
    ? `line_1_zip_code like '${zip}%'`
    : pin.length >= 8
      ? `starts_with(line_1_primary_pin, '${pin.slice(0, 8)}')`
      : `upper(line_1_city)='${String(lead.city).toUpperCase()}'`;
  const where =
    `line_1_county='${county}' AND ${geo} AND date_recorded > '${since}' ` +
    `AND line_11_full_consideration > 20000 ` +
    `AND line_10h_bank_reo=false AND line_10i_auction_sale=false ` +
    `AND line_10g_short_sale=false AND line_10d_court_ordered_sale=false`;
  const url =
    `${MYDEC}?$where=${encodeURIComponent(where)}` +
    `&$order=${encodeURIComponent("date_recorded DESC")}&$limit=80`;
  let rows;
  try {
    rows = await fetchJson(url, socrataOpts);
  } catch {
    return null;
  }
  const priced = (rows || [])
    .map((r) => ({
      price: num(r.line_11_full_consideration),
      date: String(r.date_recorded || "").slice(0, 10),
      address: r.full_address || r.line_1_street,
    }))
    .filter((r) => r.price);
  if (priced.length < 3) return null;
  return {
    median: median(priced.map((r) => r.price)),
    n: priced.length,
    comps: priced.slice(0, 5),
  };
}

// Attach comps + a comps-anchored ARV + the value gap. Tries MyDec (statewide) for
// every metro county, then Cook's assessor-sales set as a Cook fallback; degrades
// to the assessor fair-cash basis if neither returns. Never throws.
export async function attachValue(lead) {
  try {
    let c = await mydecComps(lead);
    if (!c && lead.county === "Cook") c = await cookComps(lead);
    if (c) {
      lead.comps = c.comps;
      lead.compsMedian = c.median;
      lead.compsCount = c.n;
      lead.estMarketComps = c.median; // comps-backed ARV → high-confidence gap
    } else {
      lead.compsNote = "no comps returned — assessor fair-cash basis";
    }
  } catch {
    /* best-effort */
  }
  const vg = valueGap(lead);
  lead.valueGap = vg.gap;
  lead.valueGapPct = vg.gapPct;
  lead.valueConfidence = vg.confidence;
  lead.valueBasis = vg.basis;
  return lead;
}
