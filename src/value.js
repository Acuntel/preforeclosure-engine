// Value-gap inputs for the Vince profile. Vince's gig: knock, offer ~$5k cash,
// step into the deal where the home is worth well MORE than what's owed. The
// biggest under-market spread wins (NOT cheapest absolute price). This module
// pulls neighborhood comps (network); the pure math lives in value-math.js.
import { fetchJson } from "./http.js";
import { median, num, valuation } from "./value-math.js";
import { leadDistanceMi, RADIUS_MI } from "./proximity.js";

const COOK_BASE = "https://datacatalog.cookcountyil.gov/resource";
const SALES = `${COOK_BASE}/wvhk-k5uv.json`; // pin, sale_price, sale_date
// IL Dept of Revenue MyDec transfer declarations (PTAX-203): real sold prices
// with address + PIN + county for EVERY IL county, one free Socrata endpoint.
const MYDEC = "https://data.illinois.gov/resource/it54-y4c6.json";
const APP_TOKEN = process.env.SOCRATA_APP_TOKEN || "";
const socrataOpts = APP_TOKEN ? { headers: { "X-App-Token": APP_TOKEN } } : {};

const isTrue = (v) => v === true || String(v).toLowerCase() === "true";

// Collapse one multi-PIN deal into ONE sale event (dedupe on price + date).
export function dedupeSales(rows) {
  const seen = new Set();
  const out = [];
  for (const r of rows) {
    const k = `${r.price}|${r.date}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(r);
  }
  return out;
}

const hasUnit = (a) => /#|\b(UNIT|APT|STE|SUITE)\b/i.test(String(a || ""));

// Pure filter for MyDec rows: arm's-length, single-parcel, residential, and the
// same building type as the subject (condo unit vs house) when we can tell.
export function cleanMydecRows(rows, subjectAddress) {
  const subjUnit = hasUnit(subjectAddress);
  const priced = (rows || [])
    .filter((r) => (Number(r.line_2_total_parcels) || 1) <= 1)
    .filter((r) => !isTrue(r.line_3_additional_pins))
    .filter((r) => !isTrue(r.line_10b_sale_between_related))
    .filter((r) => !isTrue(r.line_10c_transfer_of_100))
    .filter((r) => !isTrue(r.line_10e_sale_in_lieu_of))
    .filter((r) => !r.line_8_current_use || /^[BD]$/.test(r.line_8_current_use))
    .map((r) => ({
      price: num(r.line_11_full_consideration),
      date: String(r.date_recorded || "").slice(0, 10),
      address: r.full_address || r.line_1_street,
    }))
    .filter((r) => r.price);
  const sameType = priced.filter((r) => hasUnit(r.address) === subjUnit);
  return dedupeSales(sameType.length >= 5 ? sameType : priced);
}

// Pure filter for Cook assessor sales rows: one parcel, not flagged, residential.
export function cleanCookRows(rows) {
  const priced = (rows || [])
    .filter((r) => !isTrue(r.is_multisale))
    .filter((r) => (Number(r.num_parcels_sale) || 1) <= 1)
    .filter((r) => !isTrue(r.sale_filter_same_sale_within_365))
    .filter((r) => !isTrue(r.sale_filter_deed_type))
    .filter((r) => !isTrue(r.sale_filter_less_than_10k))
    .filter((r) => !r.class || String(r.class).startsWith("2"))
    .map((r) => ({
      pin: r.pin,
      price: num(r.sale_price),
      date: String(r.sale_date || "").slice(0, 10),
    }))
    .filter((r) => r.price);
  return dedupeSales(priced);
}

const summarize = (events) =>
  events.length
    ? {
        median: median(events.map((r) => r.price)),
        n: events.length,
        comps: events.slice(0, 5),
      }
    : null;

// Cook neighborhood comps by PIN block (first 7 PIN digits). Best-effort.
async function cookComps(lead) {
  const pin = String(lead.pin || "").replace(/\D/g, "");
  if (pin.length < 10) return null;
  const since = new Date(Date.now() - 730 * 864e5).toISOString().slice(0, 10);
  const where = `starts_with(pin, '${pin.slice(0, 7)}') AND sale_date > '${since}' AND sale_price > 20000`;
  const url =
    `${SALES}?$where=${encodeURIComponent(where)}` +
    `&$order=${encodeURIComponent("sale_date DESC")}&$limit=100`;
  try {
    return summarize(cleanCookRows(await fetchJson(url)));
  } catch {
    return null;
  }
}

// MyDec comps for ANY IL county: recent arm's-length sold prices near the
// subject (same zip, else PIN section, else city), last 24 months, excluding
// distressed sales (REO, short, auction, court-ordered). Best-effort.
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
      : `upper(line_1_city)='${String(lead.city).toUpperCase().replace(/'/g, "''")}'`;
  const where =
    `line_1_county='${county}' AND ${geo} AND date_recorded > '${since}' ` +
    `AND line_11_full_consideration > 20000 ` +
    `AND line_10h_bank_reo=false AND line_10i_auction_sale=false ` +
    `AND line_10g_short_sale=false AND line_10d_court_ordered_sale=false`;
  const url =
    `${MYDEC}?$where=${encodeURIComponent(where)}` +
    `&$order=${encodeURIComponent("date_recorded DESC")}&$limit=120`;
  try {
    return summarize(cleanMydecRows(await fetchJson(url, socrataOpts), lead.address));
  } catch {
    return null;
  }
}

// The subject's OWN last arm's-length sale from MyDec, for collar counties whose
// assessor feed carries no sale history (DuPage GIS has none). Without it a
// DuPage sheriff lead has no payoff figure and can never be picked. In-radius
// leads only, cached a day so hourly passes don't re-query.
const OWN_SALE_TTL = 24 * 3600e3;
const ownSaleCache = new Map();
async function ownSale(lead) {
  const street = String(lead.address || "").split(",")[0].toUpperCase().replace(/[^A-Z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  const m = street.match(/^(\d+)\s+(?:[NSEW]\s+)?([A-Z0-9]+)/);
  if (!m || !lead.city) return null;
  const key = `${lead.county}|${street}|${String(lead.city).toUpperCase()}`;
  const hit = ownSaleCache.get(key);
  if (hit && Date.now() - hit.at < OWN_SALE_TTL) return hit.v;
  const where =
    `line_1_county='${lead.county}' AND upper(line_1_city)='${String(lead.city).toUpperCase().replace(/'/g, "''")}' ` +
    `AND upper(line_1_street) like '${m[1]} %${m[2]}%' AND line_11_full_consideration > 20000 ` +
    `AND line_10b_sale_between_related=false AND line_10d_court_ordered_sale=false ` +
    `AND line_10e_sale_in_lieu_of=false AND line_10h_bank_reo=false AND line_10i_auction_sale=false`;
  const url = `${MYDEC}?$where=${encodeURIComponent(where)}&$order=${encodeURIComponent("date_recorded DESC")}&$limit=3`;
  try {
    const rows = await fetchJson(url, socrataOpts);
    const r = (rows || []).find((x) => String(x.line_1_street || "").toUpperCase().startsWith(`${m[1]} `));
    const v = r ? { price: Number(r.line_11_full_consideration), date: String(r.date_recorded).slice(0, 10) } : null;
    ownSaleCache.set(key, { at: Date.now(), v });
    return v;
  } catch {
    return null; // not cached: retry next pass
  }
}

// Legacy shape kept for any caller that still reads it.
export function valueGap(lead) {
  const v = valuation(lead);
  return { gap: v.gap, gapPct: v.gapPct, confidence: v.confidence, basis: v.basis };
}

// Write the valuation onto the lead (fields the card and email already read).
export function applyValuation(lead) {
  const v = valuation(lead);
  lead.estMarket = v.market;
  lead.estDebt = v.payoff;
  lead.estEquity = v.gap ?? 0;
  lead.marketBasis = v.marketBasis;
  lead.payoffBasis = v.payoffBasis;
  lead.assessorAnchor = v.anchor;
  // only show a comps figure when the comps were actually trusted
  if (v.marketBasis === "comps") lead.estMarketComps = v.market;
  else delete lead.estMarketComps;
  if (v.compsRejected) lead.compsNote = `comps not used: ${v.compsRejected}`;
  lead.valueGap = v.gap;
  lead.valueGapPct = v.gapPct;
  lead.valueConfidence = v.confidence;
  lead.valueBasis = v.basis;
  return lead;
}

// Attach comps + the anchored valuation. Tries MyDec (statewide) first, then
// Cook's assessor-sales set as a Cook fallback. Never throws.
export async function attachValue(lead) {
  try {
    if (!num(lead.lastSalePrice) && lead.county && lead.county !== "Cook") {
      const mi = leadDistanceMi(lead);
      if (mi != null && mi <= RADIUS_MI) {
        const own = await ownSale(lead);
        if (own) {
          lead.lastSalePrice = own.price;
          lead.lastSaleDate = own.date;
          lead.lastSaleSource = "mydec";
        }
      }
    }
    let c = await mydecComps(lead);
    if ((!c || c.n < 5) && lead.county === "Cook") c = (await cookComps(lead)) || c;
    if (c) {
      lead.comps = c.comps;
      lead.compsMedian = c.median;
      lead.compsCount = c.n;
      lead.compsDistinct = c.n;
    } else {
      lead.compsNote = "no comps returned, assessor basis";
    }
  } catch {
    /* best-effort */
  }
  return applyValuation(lead);
}
