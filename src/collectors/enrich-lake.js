// Lake County IL enrich collector — public ArcGIS REST MapServer, no auth.
// Source: Lake County (CCAO) GIS — maps.lakecountyil.gov/arcgis. The richest
// public layer is GISMapping/WABParcels/MapServer/12 "Tax Parcel Information"
// (capabilities Map,Query,Data; maxRecordCount 1000), which publishes the full
// assessor record keyed by PIN: situs address, taxpayer (owner) name + mailing,
// assessed value (land/bldg/total), building characteristics (beds/baths/sqft/
// year), property class, legal description, and TWO most-recent sales
// (sale_amt1/sale_date1 newest). Verified live 2026-06-07 against a Gurnee and a
// Waukegan address.
//
// Match: situs_addr_line_1 is a clean single-line street ("4221 BERTRAND LN",
// "3350 W CRESCENT AVE"). Lake stores the directional, the Census-normalized
// input often drops it, so we match `situs_addr_line_1 LIKE '<num> %<base>%'`
// (trailing space anchors the house number; the % swallows an optional
// directional) — the same proven trick used for DuPage's PROPSTNAME.
//
// NOTE: this layer publishes assessed value (= ~1/3 market, Lake's 33.33% level)
// but NOT a billed-tax-dollar amount (only `tax_code`, the rate area). `tax` is
// therefore omitted, never fabricated. Assessed value is returned as `assessed`.
import { fetchJson } from "../http.js";

export const meta = {
  id: "enrich-lake",
  label: "Lake County (CCAO) ArcGIS — parcel/assessor enrich",
  source: "maps.lakecountyil.gov",
  kind: "enrich",
  counties: ["Lake"],
  method: "http",
};

const LAYER =
  "https://maps.lakecountyil.gov/arcgis/rest/services/GISMapping/" +
  "WABParcels/MapServer/12/query";

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
]);
const DIRECTIONALS = new Set(["N", "S", "E", "W", "NE", "NW", "SE", "SW"]);

const clean = (v) => String(v ?? "").trim();
const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && v !== null && v !== "" ? n : undefined;
};
const sqlEscape = (v) => String(v).replace(/'/g, "''");
// ArcGIS esriFieldTypeDate -> "YYYY-MM-DD" (epoch ms; UTC to avoid TZ drift).
const epochToDate = (v) => {
  const n = Number(v);
  if (!Number.isFinite(n) || !n) return undefined;
  const d = new Date(n);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString().slice(0, 10);
};

// Parse a street string into { number, streetBase } for a forgiving LIKE match:
// drop leading house number + directional and the trailing suffix.
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

// Run a where-clause against the Lake parcel layer; return raw attribute rows.
async function queryLake(where, limit = 10) {
  const url =
    `${LAYER}?where=${encodeURIComponent(where)}` +
    `&outFields=*&returnGeometry=false&resultRecordCount=${limit}&f=json`;
  const data = await fetchJson(url, { cache: true });
  if (data.error) {
    throw new Error(`Lake ArcGIS: ${data.error.message || "query error"}`);
  }
  return (data.features || []).map((f) => f.attributes || {});
}

// Format a 10-digit numeric PIN as Lake's dashed form: 08-18-301-012.
function formatPin(pin) {
  const p = clean(pin);
  if (/^\d{10}$/.test(p)) {
    return `${p.slice(0, 2)}-${p.slice(2, 4)}-${p.slice(4, 7)}-${p.slice(7)}`;
  }
  return p || undefined;
}

// Map a raw Lake parcel attribute row to the enrich return shape.
function mapFeature(a) {
  const owner =
    clean(a.taxpayer_name) || clean(a.taxpayer_org_name) || undefined;
  const mailing =
    [
      clean(a.taxpayer_addr_line_1),
      clean(a.taxpayer_addr_line_2),
      [
        clean(a.taxpayer_addr_city),
        clean(a.taxpayer_addr_state),
        clean(a.taxpayer_addr_zip),
      ]
        .filter(Boolean)
        .join(" "),
    ]
      .filter(Boolean)
      .join(", ") || undefined;

  const legal =
    [clean(a.legdesc1), clean(a.legdesc2), clean(a.legdesc3)]
      .filter(Boolean)
      .join(" ") || undefined;

  const fb = num(a.full_baths) ?? 0;
  const hb = num(a.half_baths) ?? 0;
  const baths = fb || hb ? fb + hb * 0.5 : undefined;

  const out = {
    pin: formatPin(a.PIN),
    owner,
    mailing,
    beds: num(a.bedroom_count),
    baths,
    sqft: num(a.liv_sq_ft) || num(a.bldg_sq_ft),
    year: num(a.improve_year_built),
    // Lake assesses at 33.33%; `assess_total_taxyr` is the assessed (not market) value.
    assessed: num(a.assess_total_taxyr) ?? num(a.assess_total_assyr),
    assessedLand: num(a.assess_land_taxyr) ?? num(a.assess_land_assyr),
    assessedBldg: num(a.assess_bldg_taxyr) ?? num(a.assess_bldg_assyr),
    taxCode: clean(a.tax_code) || undefined,
    propertyClass:
      clean(a.class_desc_pardat) || clean(a.prop_class_pardat) || undefined,
    municipality: clean(a.MUNI_NAME) || undefined,
    township: clean(a.TOWNSHIPNAME) || clean(a.township) || undefined,
    legalDescription: legal,
    lotAcres: num(a.lot_area_acres) ?? num(a.CALCACRE),
    lastSaleDate: epochToDate(a.sale_date1),
    lastSalePrice: num(a.sale_amt1),
    // Lake's parcel layer carries no billed-tax dollar amount (only tax_code, the
    // rate area). `tax` is intentionally omitted, not fabricated.
  };
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
    const base = `situs_addr_line_1 LIKE '${sqlEscape(number)} %${sqlEscape(streetBase)}%'`;
    const where =
      base + (city ? ` AND situs_addr_city LIKE '${sqlEscape(city)}%'` : "");

    let feats = await queryLake(where, 10);
    // Fall back county-wide if the postal/situs city differs from the lead's city.
    if (!feats.length && city) feats = await queryLake(base, 10);
    if (!feats.length) return {};

    // Prefer the row whose situs starts with the exact house number.
    const exact = feats.find((a) =>
      clean(a.situs_addr_line_1).startsWith(`${number} `),
    );
    return mapFeature(exact || feats[0]);
  } catch (e) {
    console.error(`enrich-lake: ${e && e.message ? e.message : e}`);
    return {};
  }
}
