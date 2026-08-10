// McHenry County IL enrich collector — public ArcGIS Online hosted FeatureServer.
// Source: McHenry County GIS (ArcGIS Online org "McHenryCounty", item
// 723960c3086940dd9784f69d897c1c7b). Layer:
//   services1.arcgis.com/6iYC5AXXYapRVNzl/.../McHenry_County_TaxParcels/
//   FeatureServer/0  ("McHenry County TaxParcels", capabilities Query,
//   maxRecordCount 2000). No auth. Verified live 2026-06-07 against real
//   Crystal Lake / Woodstock / McHenry addresses.
//
// Why AGOL and not the on-prem server: the county's own ArcGIS server at
// www.mchenrycountygis.org/arcgis (the "Athena" viewer backend, which carries
// assessed value + sales) is fronted by Cloudflare and returns HTTP 403 to any
// non-browser client. The AGOL hosted TaxParcels layer is the only ungated,
// free, machine-readable parcel source — it is the same authoritative county
// parcel layer, just without the assessment/sales attributes.
//
// Fields present (verified via ?f=json metadata): ParcelNumber (dashed PIN),
// Owner, MailToAddress1/2/City/State/Zip, SiteAddress + parsed
// SiteAddressHouseNumber / SiteAddressPrefixDirectional / SiteAddressStreetName
// / SiteAddressStreetSuffix / SiteAddressCity / SiteAddressZip, Township,
// TaxCode, TaxStatus, PropertyClass, LegalDescription, ParcelArea (sq ft).
//
// Fields the layer does NOT publish (so they are OMITTED, never fabricated):
// assessed value, billed tax dollars, taxYear, beds/baths/sqft/year built, and
// sale history (lastSaleDate/lastSalePrice). Those live only behind the
// Cloudflare-gated Athena server. We match on the parsed street fields
// (SiteAddressStreetName + SiteAddressHouseNumber), the cleanest match path,
// and fall back to the raw SiteAddress LIKE used by the sibling adapters.
import { fetchJson } from "../http.js";

export const meta = {
  id: "enrich-mchenry",
  label: "McHenry County ArcGIS — parcel/owner enrich",
  source: "services1.arcgis.com (McHenryCounty AGOL)",
  kind: "enrich",
  counties: ["McHenry"],
  method: "http",
};

const LAYER =
  "https://services1.arcgis.com/6iYC5AXXYapRVNzl/arcgis/rest/services/" +
  "McHenry_County_TaxParcels/FeatureServer/0/query";

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
  "CRES",
  "CRESCENT",
  "PASS",
  "RDG",
  "RIDGE",
  "GLN",
  "GLEN",
]);
const DIRECTIONALS = new Set(["N", "S", "E", "W", "NE", "NW", "SE", "SW"]);

const clean = (v) =>
  String(v ?? "")
    .replace(/\s+/g, " ")
    .trim();
const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && v !== null && v !== "" ? n : undefined;
};
const sqlEscape = (v) => String(v).replace(/'/g, "''");

// Parse a street string into { number, streetBase } for a forgiving match:
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

// Run a where-clause against the McHenry parcel layer; return attribute rows.
async function queryMcHenry(where, limit = 10) {
  const url =
    `${LAYER}?where=${encodeURIComponent(where)}` +
    `&outFields=*&returnGeometry=false&resultRecordCount=${limit}&f=json`;
  const data = await fetchJson(url, { cache: true });
  if (data.error) {
    throw new Error(`McHenry ArcGIS: ${data.error.message || "query error"}`);
  }
  return (data.features || []).map((f) => f.attributes || {});
}

// Format a 12-digit numeric PIN as McHenry's dashed form: 19-05-101-027 (the
// layer already stores it dashed, but normalize a stray all-digit value).
function formatPin(pin) {
  const p = clean(pin);
  if (/^\d{12}$/.test(p)) {
    return `${p.slice(0, 2)}-${p.slice(2, 4)}-${p.slice(4, 7)}-${p.slice(7, 10)}-${p.slice(10)}`;
  }
  if (/^\d{10}$/.test(p)) {
    return `${p.slice(0, 2)}-${p.slice(2, 4)}-${p.slice(4, 7)}-${p.slice(7)}`;
  }
  return p || undefined;
}

// Map a raw McHenry parcel attribute row to the enrich return shape.
function mapFeature(a) {
  const mailing =
    [
      clean(a.MailToAddress1),
      clean(a.MailToAddress2),
      [clean(a.MailToCity), clean(a.MailToState), clean(a.MailToZip)]
        .filter(Boolean)
        .join(" "),
    ]
      .filter(Boolean)
      .join(", ") || undefined;

  const out = {
    pin: formatPin(a.ParcelNumber),
    owner: clean(a.Owner) || undefined,
    mailing,
    township: clean(a.Township) || undefined,
    taxCode: clean(a.TaxCode) || undefined,
    taxStatus: clean(a.TaxStatus) || undefined,
    propertyClass: clean(a.PropertyClass) || undefined,
    municipality: clean(a.Location) || clean(a.SiteCity) || undefined,
    legalDescription: clean(a.LegalDescription) || undefined,
    lotSqft: num(a.ParcelArea),
    siteAddress:
      [
        clean(a.SiteAddress),
        clean(a.SiteCity),
        clean(a.SiteState),
        clean(a.SiteZip),
      ]
        .filter(Boolean)
        .join(" ") || undefined,
    // McHenry's public AGOL parcel layer carries NO assessed value, billed-tax
    // dollar amount, building characteristics, or sale history (those live only
    // behind the Cloudflare-gated Athena server). Intentionally omitted, never
    // fabricated: assessed, tax, taxYear, beds, baths, sqft, year,
    // lastSaleDate, lastSalePrice.
  };
  for (const k of Object.keys(out)) if (out[k] === undefined) delete out[k];
  return out;
}

// enrich({ address, city, zip }) -> property fields (or {} if nothing found).
// Never throws — catches and returns {} on any failure.
export async function enrich(lead = {}) {
  try {
    const { number, streetBase } = parseStreet(lead.address || "");
    if (!number || !streetBase) return {};

    const city = clean(lead.city).toUpperCase();
    // Primary: parsed street-name fields (cleanest; directional lives in its own
    // column so we don't have to guess it).
    const nameBase =
      `SiteAddressStreetName LIKE '${sqlEscape(streetBase)}%'` +
      ` AND SiteAddressHouseNumber = '${sqlEscape(number)}'`;
    const whereName =
      nameBase +
      (city ? ` AND SiteAddressCity LIKE '${sqlEscape(city)}%'` : "");

    let feats = await queryMcHenry(whereName, 10);
    if (!feats.length) feats = await queryMcHenry(nameBase, 10);

    // Fallback: raw SiteAddress LIKE (the layer double-spaces the house number,
    // e.g. "32  DOLE AVE"; the % between number and base swallows that).
    if (!feats.length) {
      const raw =
        `SiteAddress LIKE '${sqlEscape(number)} %${sqlEscape(streetBase)}%'` +
        (city ? ` AND SiteCity LIKE '${sqlEscape(city)}%'` : "");
      feats = await queryMcHenry(raw, 10);
      if (!feats.length && city) {
        feats = await queryMcHenry(
          `SiteAddress LIKE '${sqlEscape(number)} %${sqlEscape(streetBase)}%'`,
          10,
        );
      }
    }
    if (!feats.length) return {};

    // Prefer the row whose parsed house number exactly equals the lead's.
    const exact = feats.find((a) => clean(a.SiteAddressHouseNumber) === number);
    return mapFeature(exact || feats[0]);
  } catch (e) {
    console.error(`enrich-mchenry: ${e && e.message ? e.message : e}`);
    return {};
  }
}
