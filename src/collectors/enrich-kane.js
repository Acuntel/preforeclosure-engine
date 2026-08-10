// Kane County IL enrich collector — public ArcGIS REST MapServer, no auth.
// Source: Kane County GIS-Technologies — gistech.countyofkane.org/arcgis. The
// parcel service is KanePINList/MapServer, layer 0 "Kane.DBO.Parcels_v2025"
// (capabilities Map,Query,Data; maxRecordCount 1000; verified live 2026-06-07).
// It publishes, keyed by PIN: SiteAddress/City/Zip, TaxName (owner of record),
// the full Mailing* address, RecordedAcreage, UseCodeDescription (property
// class), LegalDesc, Township/Municipality, and DocNumber + DocDate (the most
// recent recorded deed = the best available last-sale signal).
//
// Match: SiteAddress is a single-line street that KEEPS the directional and can
// be a Fox-Valley grid number ("39W529 NORTON LAKE DR") or a plain number
// ("40 GRAY ST", "1028 DOUGLAS AVE", "2789 FARNSWORTH AVE"). We match
//   SiteAddress LIKE '<num> %<base>%'
// (trailing space anchors the house number; the % swallows an optional
// directional) — the same proven trick used for Lake's situs_addr_line_1 and
// DuPage's PROPSTNAME. Verified live against Geneva / Elgin / Aurora.
//
// NOTE: Kane's PUBLIC parcel layer carries NO assessed-value or billed-tax
// dollar figure (those live behind the Supervisor of Assessments' separate
// system, not this free REST service). `assessed`/`tax` are therefore omitted,
// never fabricated. The related tables (KanePINList, KaneAG) only hold PIN/AG
// flags, no money fields. Last-sale PRICE is likewise not published (deeds carry
// DocNumber/DocDate only), so lastSalePrice is omitted; lastSaleDate = DocDate.
import { fetchJson } from "../http.js";

export const meta = {
  id: "enrich-kane",
  label: "Kane County (GIS-Technologies) ArcGIS — parcel/owner enrich",
  source: "gistech.countyofkane.org",
  kind: "enrich",
  counties: ["Kane"],
  method: "http",
};

const LAYER =
  "https://gistech.countyofkane.org/arcgis/rest/services/" +
  "KanePINList/MapServer/0/query";

const STREET_SUFFIXES = new Set([
  "ST",
  "STREET",
  "RD",
  "ROAD",
  "AVE",
  "AVENUE",
  "DR",
  "DRIVE",
  "LN",
  "LANE",
  "CT",
  "COURT",
  "BLVD",
  "BOULEVARD",
  "PL",
  "PLACE",
  "WAY",
  "TER",
  "TERRACE",
  "CIR",
  "CIRCLE",
  "PKWY",
  "PARKWAY",
  "TRL",
  "TRAIL",
  "HWY",
  "HIGHWAY",
  "RUN",
  "PT",
  "POINT",
  "SQ",
  "SQUARE",
  "LOOP",
  "ROW",
  "WALK",
  "PATH",
  "XING",
  "CV",
  "COVE",
  "CRSE",
  "COURSE",
  "PASS",
  "BND",
  "BEND",
]);
const DIRECTIONALS = new Set(["N", "S", "E", "W", "NE", "NW", "SE", "SW"]);

const clean = (v) => String(v ?? "").trim();
const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && v !== null && v !== "" ? n : undefined;
};
// SQL-LIKE-escape (single quotes) for an ArcGIS where clause.
const sqlEscape = (v) => String(v).replace(/'/g, "''");

// DocDate is a string "YYYY-MM-DD 00:00:00" (or sometimes epoch ms). Normalize
// to "YYYY-MM-DD"; return undefined if blank/unparseable. Never fabricates.
function normDate(v) {
  const s = clean(v);
  if (!s) return undefined;
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  const n = Number(s);
  if (Number.isFinite(n) && n > 0) {
    const d = new Date(n);
    if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  }
  return undefined;
}

// Parse a street string into { number, streetBase } for a forgiving LIKE match:
// keep the leading house number (incl. Fox-Valley grid like "39W529"), drop a
// leading directional and the trailing suffix.
function parseStreet(street) {
  const up = String(street || "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();
  const tokens = up.split(" ").filter(Boolean);
  // Grid ("39W529") or plain ("40") leading number token.
  const number = /^\d/.test(tokens[0] || "") ? tokens[0] : "";
  const nameTokens = tokens.slice(number ? 1 : 0);
  while (nameTokens.length > 1 && DIRECTIONALS.has(nameTokens[0])) {
    nameTokens.shift();
  }
  while (
    nameTokens.length > 1 &&
    STREET_SUFFIXES.has(nameTokens[nameTokens.length - 1])
  ) {
    nameTokens.pop();
  }
  return { number, streetBase: nameTokens.join(" ") };
}

// Run a where-clause against the Kane parcel layer; return raw attribute rows.
async function queryKane(where, limit = 10) {
  const url =
    `${LAYER}?where=${encodeURIComponent(where)}` +
    `&outFields=*&returnGeometry=false&resultRecordCount=${limit}&f=json`;
  const data = await fetchJson(url, { cache: true });
  if (data.error) {
    throw new Error(`Kane ArcGIS: ${data.error.message || "query error"}`);
  }
  return (data.features || []).map((f) => f.attributes || {});
}

// Format a 10-digit numeric PIN as Kane's dashed form: 08-24-350-010.
function formatPin(pin) {
  const p = clean(pin).replace(/-/g, "");
  if (/^\d{10}$/.test(p)) {
    return `${p.slice(0, 2)}-${p.slice(2, 4)}-${p.slice(4, 7)}-${p.slice(7)}`;
  }
  return clean(pin) || undefined;
}

// Map a raw Kane parcel attribute row to the enrich return shape.
function mapFeature(a) {
  const mailing =
    [
      clean(a.MailingAddress),
      clean(a.MailingAddress2),
      [clean(a.MailingCity), clean(a.MailingState), clean(a.MailingZip)]
        .filter(Boolean)
        .join(" "),
    ]
      .filter(Boolean)
      .join(", ") || undefined;

  const out = {
    pin: formatPin(a.PIN),
    owner: clean(a.TaxName) || undefined,
    mailing,
    propertyClass: clean(a.UseCodeDescription) || undefined,
    municipality: clean(a.Municipality) || undefined,
    township: clean(a.Township) || undefined,
    legalDescription: clean(a.LegalDesc) || undefined,
    lotAcres: num(a.RecordedAcreage),
    taxCode: clean(a.TaxCode) || undefined,
    // Most recent recorded deed — the only sale signal Kane's free layer
    // publishes. DocNumber = the recording number, DocDate = the recording date.
    deedDocNumber: clean(a.DocNumber) || undefined,
    lastSaleDate: normDate(a.DocDate),
    // Kane's PUBLIC parcel service exposes no assessed value, billed tax, or
    // sale price. Those fields are intentionally omitted, never fabricated.
  };
  if (out.lotAcres === 0) delete out.lotAcres; // "0.00" placeholder rows
  for (const k of Object.keys(out)) if (out[k] === undefined) delete out[k];
  return out;
}

// enrich({ address, city, zip }) -> property fields (or {} if nothing/blocked).
// Never throws — catches and returns {} on any failure.
export async function enrich(lead = {}) {
  try {
    const { number, streetBase } = parseStreet(lead.address || "");
    if (!number || !streetBase) return {};

    const city = clean(lead.city).toUpperCase();
    const base = `SiteAddress LIKE '${sqlEscape(number)} %${sqlEscape(streetBase)}%'`;
    const where =
      base + (city ? ` AND SiteCity LIKE '${sqlEscape(city)}%'` : "");

    let feats = await queryKane(where, 10);
    // Fall back county-wide if the postal/site city differs from the lead's city.
    if (!feats.length && city) feats = await queryKane(base, 10);
    if (!feats.length) return {};

    // Prefer the row whose SiteAddress starts with the exact house number.
    const exact = feats.find((a) =>
      clean(a.SiteAddress).startsWith(`${number} `),
    );
    return mapFeature(exact || feats[0]);
  } catch (e) {
    console.error(`enrich-kane: ${e && e.message ? e.message : e}`);
    return {};
  }
}
