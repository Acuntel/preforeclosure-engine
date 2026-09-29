// DuPage County enrich collector — public ArcGIS REST FeatureServer, no auth.
// Ported from ~/Desktop/property-intel/src/county/dupage.ts (proven, verified live).
// Given {address, city, zip} it queries the DuPage parcel layer matching
//   PROPSTNAME LIKE '<num> %<streetbase>%'
// (trailing space anchors the house number; the % swallows an optional
// directional, e.g. DuPage stores "675 S EDGEWOOD AVE" while the input is
// "675 EDGEWOOD AVE") and returns the assessor record: pin, owner, mailing,
// assessed, tax, fcvTotal, legalDescription.
//
// NOTE: the DuPage GIS layer publishes NO sale history (no last-sale date/price)
// and NO building characteristics (beds/baths/sqft). Those fields are therefore
// omitted, not faked. The assignment-named path
// (.../DuPage_County_IL_Parcels/MapServer) 404s; the real live layer is
// DuPage_County_IL/ParcelsWithRealEstateCC/MapServer/0 (verified 2026-06-07).
import { fetchJson } from "../http.js";

export const meta = {
  id: "enrich-dupage",
  label: "DuPage County ArcGIS — parcel/assessor enrich",
  source: "gis.dupageco.org",
  kind: "enrich",
  counties: ["DuPage"],
  method: "http",
};

const LAYER =
  "https://gis.dupageco.org/arcgis/rest/services/DuPage_County_IL/" +
  "ParcelsWithRealEstateCC/MapServer/0/query";

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
]);
const DIRECTIONALS = new Set(["N", "S", "E", "W", "NE", "NW", "SE", "SW"]);

const clean = (v) => String(v ?? "").trim();
const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && v !== null && v !== "" ? n : undefined;
};
// SQL-LIKE-escape (single quotes) for an ArcGIS where clause.
const sqlEscape = (v) => String(v).replace(/'/g, "''");

// Parse a street string into { number, streetBase } for a forgiving LIKE match.
// streetBase = core name word(s), dropping leading number + directional and
// trailing suffix (handles "RD" vs "ROAD", trailing unit, directionals).
function parseStreet(street) {
  const up = String(street || "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();
  const tokens = up.split(" ").filter(Boolean);
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

// Run a where-clause against the DuPage parcel layer; return raw attribute rows.
async function queryDuPage(where, limit = 10) {
  const url =
    `${LAYER}?where=${encodeURIComponent(where)}` +
    `&outFields=*&returnGeometry=false&resultRecordCount=${limit}&f=json`;
  const data = await fetchJson(url, { cache: true });
  if (data.error) {
    throw new Error(`DuPage ArcGIS: ${data.error.message || "query error"}`);
  }
  return (data.features || []).map((f) => f.attributes || {});
}

// Map a raw DuPage parcel attribute row to the enrich return shape.
function mapFeature(a) {
  const legal = Array.from({ length: 9 }, (_, i) =>
    clean(a[`LEGALDES${i + 1}`]),
  )
    .filter(Boolean)
    .join(" ");
  const mailing =
    [clean(a.BILLADDRL1), clean(a.BILLADDRL2)].filter(Boolean).join(", ") ||
    undefined;

  const out = {
    pin: clean(a.PIN) || undefined,
    owner: clean(a.BILLNAME) || undefined,
    mailing,
    assessed: num(a.BILLVALUE),
    tax: num(a.TAXAMOUNT),
    taxRate: num(a.TAXRATE),
    fcvTotal: num(a.REA017_FCV_TOTAL),
    fcvLand: num(a.REA017_FCV_LAND),
    fcvImprovement: num(a.REA017_FCV_IMP),
    legalDescription: legal || undefined,
    propertyClass: clean(a.REA017_PROP_CLASS) || undefined,
    municipality: clean(a.MUNICIPALITY) || undefined,
    // DuPage GIS publishes no sale history — left undefined, never fabricated.
    lastSaleDate: undefined,
    lastSalePrice: undefined,
  };
  // Format PIN with dashes (02-08-205-015) when it's a 10-digit numeric string.
  if (out.pin && /^\d{10}$/.test(out.pin)) {
    out.pin = `${out.pin.slice(0, 2)}-${out.pin.slice(2, 4)}-${out.pin.slice(
      4,
      7,
    )}-${out.pin.slice(7)}`;
  }
  // Drop undefineds so the registry's stripEmpty merge stays clean.
  for (const k of Object.keys(out)) if (out[k] === undefined) delete out[k];
  return out;
}

// enrich({ address, city, zip }) -> property fields (or {} if nothing / blocked).
// Never throws — catches and returns {} on any failure.
export async function enrich(lead = {}) {
  try {
    const { number, streetBase } = parseStreet(lead.address || "");
    if (!number || !streetBase) return {};

    const city = clean(lead.city);
    const where =
      `PROPSTNAME LIKE '${sqlEscape(number)} %${sqlEscape(streetBase)}%'` +
      (city ? ` AND PROPCITY LIKE '${sqlEscape(city.toUpperCase())}%'` : "");

    let feats = await queryDuPage(where, 10);
    // Fall back to a county-wide match if the city filter excluded everything
    // (DuPage PROPCITY can be a postal city that differs from the lead's city).
    // The fallback must still be the same house: same property zip when the lead
    // has one, else the only candidate. ("610 Catalpa Ave, Wood Dale" once matched
    // 610 N Catalpa in Itasca and took that house's owner and value.)
    if (!feats.length && city) {
      const all = await queryDuPage(
        `PROPSTNAME LIKE '${sqlEscape(number)} %${sqlEscape(streetBase)}%'`,
        10,
      );
      const zip = String(lead.zip || "").match(/\d{5}/)?.[0];
      feats = zip
        ? all.filter((a) => clean(a.PROPZIP).startsWith(zip))
        : all.length === 1
          ? all
          : [];
    }
    if (!feats.length) return {};

    // Prefer the row whose PROPSTNAME starts with the exact house number.
    const exact = feats.find((a) =>
      clean(a.PROPSTNAME).startsWith(`${number} `),
    );
    return mapFeature(exact || feats[0]);
  } catch (e) {
    // Honest failure: log, return nothing. The orchestrator keeps the lead.
    console.error(`enrich-dupage: ${e && e.message ? e.message : e}`);
    return {};
  }
}
