// Will County enrich collector — public Will County GIS ArcGIS REST, no auth.
// The county's live MapServer (gis.willcountyillinois.com/server/rest/services)
// publishes a parcel/assessor layer under the Eagleview folder that carries the
// PIN, the full situs address (broken into components), the equalized assessed
// value (EAV), property class, tax code and acreage:
//   Eagleview/Parcels_24/MapServer/0   (verified live 2026-06-07 via ?f=json)
// Fields confirmed: PIN, HOUSENUMBE, PREFIXDIRE, STREETNAME, SUFFIXTYPE,
//   SUFFIXDIRE, CITY, ZIP_CODE, Equalized_Value, Property_Class, Tax_Code,
//   Tax_Exempt_Code, Acres, Valuation_Date.
//
// What this layer does NOT have (so it is NOT fabricated here): owner name,
// mailing address, billed-tax dollars, beds/baths/sqft/year, last-sale.
// Owner + mailing live ONLY in the Will treasurer "Wildfire" API, which is WAF-
// blocked (403) from a residential IP (see will-treasurer.js). We make a single
// best-effort attempt at it to backfill owner/mailing; on the expected 403 we
// quietly keep the ArcGIS fields rather than failing the enrich.
import { fetchJson } from "../http.js";

export const meta = {
  id: "enrich-will",
  label: "Will County GIS (ArcGIS) — parcel/assessor enrich",
  source: "gis.willcountyillinois.com",
  kind: "enrich",
  counties: ["Will"],
  method: "http",
};

const LAYER =
  "https://gis.willcountyillinois.com/server/rest/services/" +
  "Eagleview/Parcels_24/MapServer/0/query";

// Will treasurer Wildfire API (owner + mailing); WAF-prone, best-effort only.
const TREAS_API =
  "https://d1ebsyxxbc7tep.cloudfront.net/data/" +
  "8ee9867e-b26c-4662-aa13-cdbbbe647ea9/Wildfire/Records";
const TREAS_HEADERS = {
  "Content-Type": "application/json;charset=UTF-8",
  Referer: "https://willcountytreasurer.us/",
  Origin: "https://willcountytreasurer.us",
  Accept: "application/json, text/plain, */*",
};

const SUFFIXES = new Set([
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
  "SQ",
  "SQUARE",
  "RUN",
  "PT",
  "POINT",
  "PASS",
  "ROW",
  "XING",
  "CROSSING",
]);
const DIRS = new Set(["N", "S", "E", "W", "NE", "NW", "SE", "SW"]);

const clean = (v) => String(v ?? "").trim();
const num = (v) => {
  if (v == null || v === "") return undefined;
  const n = Number(String(v).replace(/[,$]/g, ""));
  return Number.isFinite(n) ? n : undefined;
};
const sqlEscape = (v) => String(v).replace(/'/g, "''");

// Parse "21917 W HELEN DR" -> { number, streetBase } dropping leading number +
// directional and trailing suffix so a forgiving LIKE survives "RD" vs "ROAD",
// units, etc. Will's STREETNAME usually already includes the suffix.
function parseStreet(street) {
  const up = String(street || "")
    .toUpperCase()
    .replace(/[.,]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const tokens = up.split(" ").filter(Boolean);
  const number = /^\d/.test(tokens[0] || "") ? tokens[0] : "";
  const nameTokens = tokens.slice(number ? 1 : 0);
  while (nameTokens.length > 1 && DIRS.has(nameTokens[0])) nameTokens.shift();
  while (
    nameTokens.length > 1 &&
    SUFFIXES.has(nameTokens[nameTokens.length - 1])
  )
    nameTokens.pop();
  return { number, streetBase: nameTokens.join(" ") };
}

// Canonical Will display PIN is the layer's PIN_RECORDER (e.g.
// 06-03-25-406-002-0000). When that's absent, dash-format the 16-digit raw PIN
// the same way: NN-NN-NN-NNN-NNN-NNNN (2-2-2-3-3-4).
function fmtPin(raw, recorder) {
  const r = clean(recorder);
  if (r) return r;
  const d = String(raw || "").replace(/\D/g, "");
  if (d.length !== 16) return clean(raw) || undefined;
  return `${d.slice(0, 2)}-${d.slice(2, 4)}-${d.slice(4, 6)}-${d.slice(
    6,
    9,
  )}-${d.slice(9, 12)}-${d.slice(12)}`;
}

// Run a where-clause against the parcel layer; return raw attribute rows.
async function queryWill(where, limit = 10) {
  const url =
    `${LAYER}?where=${encodeURIComponent(where)}` +
    `&outFields=${encodeURIComponent(
      "PIN,PIN_RECORDER,HOUSENUMBE,PREFIXDIRE,STREETNAME,SUFFIXTYPE,SUFFIXDIRE,CITY," +
        "ZIP_CODE,Equalized_Value,Property_Class,Tax_Code,Tax_Exempt_Code,Acres,Valuation_Date",
    )}` +
    `&returnGeometry=false&resultRecordCount=${limit}&f=json`;
  const data = await fetchJson(url, { cache: true });
  if (data.error)
    throw new Error(`Will ArcGIS: ${data.error.message || "query error"}`);
  return (data.features || []).map((f) => f.attributes || {});
}

// Compose the situs address string from the parcel attribute components.
function situs(a) {
  return [
    clean(a.HOUSENUMBE),
    clean(a.PREFIXDIRE),
    clean(a.STREETNAME),
    clean(a.SUFFIXTYPE),
    clean(a.SUFFIXDIRE),
  ]
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function mapFeature(a) {
  const eav = num(a.Equalized_Value);
  const out = {
    pin: fmtPin(a.PIN, a.PIN_RECORDER),
    // Equalized assessed value (EAV) — the county's published assessed total.
    assessed: eav && eav > 0 ? eav : undefined,
    propertyClass: clean(a.Property_Class) || undefined,
    taxCode: clean(a.Tax_Code) || undefined,
    acres: num(a.Acres),
    situsAddress: situs(a) || undefined,
    situsCity: clean(a.CITY) || undefined,
    situsZip: clean(a.ZIP_CODE) || undefined,
    // owner / mailing / billed-tax / sale / beds-baths-sqft-year are NOT in this
    // public ArcGIS layer — left undefined, never fabricated. (owner/mailing are
    // backfilled best-effort from the treasurer Wildfire API below.)
  };
  for (const k of Object.keys(out)) if (out[k] === undefined) delete out[k];
  return out;
}

// Best-effort owner+mailing from the treasurer Wildfire API (WAF-prone 403).
// Returns {} on any failure (the expected case from a non-relay IP).
async function tryOwner(pinDigits) {
  try {
    const body = JSON.stringify({ value: pinDigits, skip: 0, direct: false });
    const data = await fetchJson(TREAS_API, {
      method: "POST",
      headers: TREAS_HEADERS,
      body,
      retries: 0,
      cache: true,
    });
    const rec = (data.Records || []).find(
      (r) => (r.ParcelNumber || "").replace(/\D/g, "") === pinDigits,
    );
    if (!rec) return {};
    const oa = rec.OwnerAddress || {};
    const mailing = clean(oa.Line1)
      ? `${clean(oa.Line1)}, ${clean(oa.City)} ${clean(oa.State) || "IL"} ${clean(
          oa.Zip,
        )}`
          .replace(/\s+/g, " ")
          .trim()
      : undefined;
    const out = { owner: clean(rec.OwnerName1) || undefined, mailing };
    for (const k of Object.keys(out)) if (out[k] === undefined) delete out[k];
    return out;
  } catch {
    return {}; // expected WAF 403 from a residential IP — keep ArcGIS fields.
  }
}

// enrich({ address, city, zip }) -> property fields (or {} if nothing).
// Never throws — catches and returns {} on any failure.
export async function enrich(lead = {}) {
  try {
    const { number, streetBase } = parseStreet(lead.address || "");
    if (!number || !streetBase) return {};

    const city = clean(lead.city).toUpperCase();
    // HOUSENUMBE is an exact field; STREETNAME holds the core name (often with
    // suffix). Match house number exactly + a forgiving street-name LIKE.
    const baseWhere =
      `HOUSENUMBE='${sqlEscape(number)}' AND ` +
      `STREETNAME LIKE '%${sqlEscape(streetBase)}%'`;
    let feats = await queryWill(
      city ? `${baseWhere} AND CITY='${sqlEscape(city)}'` : baseWhere,
      10,
    );
    // Fall back to county-wide if the postal city differs from the situs CITY.
    if (!feats.length && city) feats = await queryWill(baseWhere, 10);
    if (!feats.length) return {};

    // Prefer the row whose STREETNAME starts with the parsed base name.
    const exact = feats.find((a) =>
      clean(a.STREETNAME).toUpperCase().startsWith(streetBase),
    );
    const a = exact || feats[0];
    const out = mapFeature(a);

    // Best-effort owner/mailing backfill (expected to 403 under WAF).
    if (out.pin) {
      const owner = await tryOwner(String(a.PIN || "").replace(/\D/g, ""));
      Object.assign(out, owner);
    }
    return out;
  } catch (e) {
    console.error(`enrich-will: ${e && e.message ? e.message : e}`);
    return {};
  }
}
