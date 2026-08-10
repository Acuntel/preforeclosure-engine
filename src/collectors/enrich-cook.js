// Cook County enrich — CCAO open data (Socrata SoDA API), free, no auth, no login.
// Ported from ~/Desktop/property-intel/src/county/cook.ts. Joins datasets by PIN
// (public lookup, NOT scraping):
//   3723-97qp  Parcel Addresses   address -> PIN, owner, mailing
//   x54s-btds  Improvement Chars  year built, building sqft, beds, full/half baths
//   wvhk-k5uv  Parcel Sales       sale price/date history
//   uzyt-m557  Assessed Values    board/certified/mailed assessed totals
// Billed-tax dollars are NOT in Cook open data (those live at the Cook Treasurer,
// not the CCAO) — so `tax` is left undefined rather than fabricated.
import { fetchJson } from "../http.js";

export const meta = {
  id: "enrich-cook",
  label: "Cook County CCAO (open data)",
  source: "datacatalog.cookcountyil.gov",
  kind: "enrich",
  counties: ["Cook"],
  method: "http",
};

const BASE = "https://datacatalog.cookcountyil.gov/resource";
const D = {
  addr: `${BASE}/3723-97qp.json`,
  chars: `${BASE}/x54s-btds.json`,
  sales: `${BASE}/wvhk-k5uv.json`,
  values: `${BASE}/uzyt-m557.json`,
};

const num = (v) => {
  if (v == null || v === "") return undefined;
  const n = Number(String(v).replace(/,/g, ""));
  return Number.isFinite(n) ? n : undefined;
};
const int = (v) => {
  const n = num(v);
  return n == null ? undefined : Math.round(n);
};
const str = (v) => {
  const s = String(v ?? "").trim();
  return s || undefined;
};

const sqlEscape = (v) => String(v).replace(/'/g, "''");

// Minimal address parser (mirrors property-intel/src/address.ts): pulls the house
// number + the core street-name word(s), skipping leading directional + trailing
// suffix so a forgiving LIKE handles "RD" vs "ROAD", units, directionals, etc.
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
]);
const DIRS = new Set(["N", "S", "E", "W", "NE", "NW", "SE", "SW"]);

function parseAddress(raw) {
  const street = String(raw || "")
    .replace(/\s+/g, " ")
    .trim();
  const upStreet = street.toUpperCase();
  const tokens = upStreet.split(" ").filter(Boolean);
  const number = /^\d/.test(tokens[0] || "") ? tokens[0] : "";
  const nameTokens = tokens.slice(number ? 1 : 0);
  while (nameTokens.length > 1 && DIRS.has(nameTokens[0])) nameTokens.shift();
  while (
    nameTokens.length > 1 &&
    SUFFIXES.has(nameTokens[nameTokens.length - 1])
  )
    nameTokens.pop();
  return { number, street: upStreet, streetBase: nameTokens.join(" ") };
}

async function q(url, where, order, limit = 1) {
  const parts = [`$where=${encodeURIComponent(where)}`, `$limit=${limit}`];
  if (order) parts.push(`$order=${encodeURIComponent(order)}`);
  return fetchJson(`${url}?${parts.join("&")}`, { cache: true });
}

export async function enrich(lead) {
  try {
    const addr = parseAddress(lead?.address);
    const city = str(lead?.city)?.toUpperCase();
    if (!addr.number || !addr.streetBase) return {};

    // 1) address -> PIN (latest year wins)
    let where = `upper(prop_address_full) like '${sqlEscape(addr.number)}% ${sqlEscape(addr.streetBase)}%'`;
    if (city)
      where += ` AND upper(prop_address_city_name)='${sqlEscape(city)}'`;
    const addrRows = await q(D.addr, where, "year DESC", 10);
    if (!addrRows.length) return {};

    // prefer exact street equality, then a clean house-number start (skipping
    // REAR/garden/unit parcels), else the first (latest-year) row.
    const up = (r) => (r.prop_address_full ?? "").trim().toUpperCase();
    const hit =
      addrRows.find((r) => up(r) === addr.street) ??
      addrRows.find(
        (r) =>
          up(r).startsWith(`${addr.number} `) &&
          !/\b(REAR|GARDEN|UNIT)\b/.test(up(r)),
      ) ??
      addrRows.find((r) => up(r).startsWith(`${addr.number} `)) ??
      addrRows[0];

    const pinRaw = (hit.pin ?? hit.pin10 ?? "").trim();
    if (!pinRaw) return {};
    const pin = pinRaw.padStart(14, "0");

    const propAddr = str(hit.prop_address_full);
    const mailing = [
      str(hit.mail_address_full),
      str(hit.mail_address_city_name),
      [str(hit.mail_address_state), str(hit.mail_address_zipcode_1)]
        .filter(Boolean)
        .join(" "),
    ]
      .filter(Boolean)
      .join(", ");

    const out = {
      pin,
      owner: str(hit.owner_address_name) ?? str(hit.mail_address_name),
      mailing: mailing || undefined,
    };

    // 2) building characteristics (latest year)
    try {
      const c = (await q(D.chars, `pin='${pin}'`, "year DESC"))[0];
      if (c) {
        out.beds = int(c.char_beds);
        const fb = int(c.char_fbath);
        const hb = int(c.char_hbath);
        if (fb != null || hb != null) out.baths = (fb || 0) + (hb || 0) * 0.5;
        out.sqft = int(c.char_bldg_sf);
        out.year = int(c.char_yrblt);
      }
    } catch {
      /* best-effort */
    }

    // 3) most-recent sale
    try {
      const s = (await q(D.sales, `pin='${pin}'`, "sale_date DESC", 1))[0];
      if (s) {
        out.lastSaleDate = str(s.sale_date)?.slice(0, 10);
        out.lastSalePrice = num(s.sale_price);
      }
    } catch {
      /* best-effort */
    }

    // 4) assessed value — latest year that actually has a value (current year is
    // often null until the Board acts). board > certified > mailed.
    try {
      const rows = await q(D.values, `pin='${pin}'`, "year DESC", 6);
      for (const v of rows) {
        const av =
          num(v.board_tot) ?? num(v.certified_tot) ?? num(v.mailed_tot);
        if (av != null) {
          out.assessed = av;
          out.taxYear = int(v.year);
          break;
        }
      }
    } catch {
      /* best-effort */
    }

    // `tax` (billed dollars) intentionally omitted: not published in Cook open
    // data — it lives at the Cook County Treasurer, which has no per-PIN open API.

    // drop empties so trigger-provided values aren't clobbered by undefined
    for (const k of Object.keys(out)) if (out[k] === undefined) delete out[k];
    return out;
  } catch (e) {
    console.error(`[enrich-cook] ${e?.message || e}`);
    return {};
  }
}
