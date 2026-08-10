// Intercounty Judicial Sales Corp (intercountyjudicialsales.com) — statewide IL
// judicial-foreclosure SALES. The PRIMARY independent pair to TJSC: same kind of
// upcoming/past sheriff & judicial-sale rows, matched to us by CASE NUMBER + ADDRESS.
//
// The /sales/ page is WordPress + a "Ninja Tables" (footable) table. There's no
// clean wp-json feed for the data — the wp-json routes are only oEmbed/page meta,
// and the Ninja Tables admin-ajax action requires a server-issued nonce. BUT the
// full table is SERVER-RENDERED into the page <tbody> on GET (every row present),
// so we just fetch the page and parse the rows. ~590 rows, 50+ counties.
//
// Columns (verified live, in <td> order):
//  0 Sale Date | 1 Continued Date | 2 Sale Time | 3 County | 4 Case Number |
//  5 File Number | 6 Firm Name | 7 Property Address (full "street, city, IL zip") |
//  8 City (blank) | 9 Property Zip | 10 Status | 11 Bid Amount | 12 Successful Bidder |
//  13 Practice Area | 14 Alt Sale Time
// Like TJSC, Intercounty publishes the foreclosure law FIRM (attorney), not the
// plaintiff(lender)/defendant(owner) as separate fields. Bid Amount is the winning/
// opening bid where a sale has occurred; blank for future/cancelled sales.
import { fetchText } from "../http.js";

export const meta = {
  id: "intercounty",
  label: "Intercounty Judicial Sales Corp — sales (statewide)",
  source: "intercountyjudicialsales.com",
  kind: "trigger",
  counties: ["Winnebago", "Boone", "McHenry", "Lake", "Kane", "Will"],
  method: "http",
};

const URL = "https://intercountyjudicialsales.com/sales/";

// Proper-case county names the registry filters on (home turf). Everything is
// returned regardless; this just normalizes casing + records what appeared.
const TARGET = new Set([
  "Winnebago",
  "Boone",
  "McHenry",
  "Lake",
  "Kane",
  "Will",
]);

function decode(s) {
  return (s || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&#8217;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// "6/18/2026" -> "2026-06-18"
function toIso(d) {
  const m = (d || "").match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!m) return null;
  const [, mo, da, yr] = m;
  return `${yr}-${mo.padStart(2, "0")}-${da.padStart(2, "0")}`;
}

// "$430,001.00" / "" / "$0.00" -> number | null
function toMoney(s) {
  const v = (s || "").replace(/[^0-9.]/g, "");
  if (!v) return null;
  const n = Math.round(parseFloat(v));
  return Number.isFinite(n) && n > 0 ? n : null;
}

// Title-case a county that arrives oddly cased; keep "St. Clair"/"McHenry"/"DeKalb"
// style intact when it already matches a target, else best-effort title-case.
function normCounty(raw) {
  const c = decode(raw);
  if (!c) return null;
  for (const t of TARGET) if (t.toLowerCase() === c.toLowerCase()) return t;
  return c.replace(/\b([a-z])/g, (m) => m.toUpperCase());
}

// "6N934 WOODLAWN AVENUE, SAINT CHARLES, IL 60174" or
// "1717 Roslyn Rd., Roselle IL 60172" or
// "6806 South Crandon Avenue, Unit 2, Chicago, IL 60649" or
// "3363 West Church Street, Evanston, Illinois 60203"
// -> { address (street only), city, zip }
function parseAddress(full) {
  const s = decode(full);
  if (!s) return { address: null, city: null, zip: null };
  const zip = (s.match(/\b(\d{5})(?:-\d{4})?\b\s*$/) || [])[1] || null;

  // Cut off the trailing "<city> IL <zip>" / "<city>, Illinois <zip>" tail.
  // Match the state token (IL / Illinois) and grab the word(s) before it as city.
  const tail = s.match(
    /^(.*?),?\s*([A-Za-z][A-Za-z.\s'-]*?)\s*,?\s*(?:IL|Illinois)\.?\s*(\d{5})(?:-\d{4})?\s*$/i,
  );
  if (tail) {
    let street = tail[1].trim().replace(/,\s*$/, "");
    let city = tail[2].trim().replace(/,\s*$/, "");
    // If a trailing "Unit X" / "Apt X" got captured as the city, pull the real
    // city from the token before it instead.
    if (/^(unit|apt|ste|suite|#)\b/i.test(city)) {
      const m2 = street.match(/^(.*?),\s*([A-Za-z][A-Za-z.\s'-]*?)$/);
      if (m2) {
        street = m2[1].trim();
        // keep the unit on the street, drop the bogus city
      }
      city = (street.match(/,\s*([A-Za-z .'-]+)$/) || [])[1] || city;
    }
    return {
      address: street || null,
      city: city || null,
      zip: zip || tail[3] || null,
    };
  }
  // Fallback: split on commas, last comma-chunk is the city/state/zip blob.
  const parts = s.split(",").map((p) => p.trim());
  if (parts.length >= 2) {
    const street = parts.slice(0, -1).join(", ").trim() || null;
    const cityBlob = parts[parts.length - 1]
      .replace(/\b(IL|Illinois)\b/i, "")
      .replace(/\d{5}(?:-\d{4})?/, "")
      .trim();
    return { address: street, city: cityBlob || null, zip };
  }
  return { address: s || null, city: null, zip };
}

function courtFor(county) {
  return `Circuit Court of ${county} County, Illinois`;
}

export async function collect() {
  let html;
  try {
    html = await fetchText(URL);
  } catch (e) {
    return {
      status: "blocked",
      note: `intercountyjudicialsales.com unreachable: ${String(
        e.message || e,
      )} (endpoint ${URL})`,
      leads: [],
    };
  }

  const tbody = html.match(/<tbody[^>]*>([\s\S]*?)<\/tbody>/i);
  if (!tbody) {
    return {
      status: "blocked",
      note: `No Ninja-Tables <tbody> found at ${URL} — page now lazy-loads rows via admin-ajax (needs a server nonce). Cols expected: Sale Date|Continued|Time|County|Case#|File#|Firm|Address|City|Zip|Status|Bid.`,
      leads: [],
    };
  }

  const rows = tbody[1].match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) || [];
  const leads = [];
  const countySet = new Set();

  for (const row of rows) {
    const tds = row.match(/<td[^>]*>([\s\S]*?)<\/td>/gi);
    if (!tds || tds.length < 12) continue;
    const c = tds.map((td) =>
      decode(td.replace(/^<td[^>]*>/i, "").replace(/<\/td>$/i, "")),
    );

    const sale = toIso(c[1]) || toIso(c[0]); // prefer continued date if set
    const county = normCounty(c[3]);
    const caseNumber = c[4] || null;
    const firm = c[6] || null;
    const { address, city, zip } = parseAddress(c[7]);
    const zipFinal = zip || (c[9] || "").match(/\d{5}/)?.[0] || null;
    const cityFinal = city || c[8] || null;
    const status = c[10] || null;
    const openingBid = toMoney(c[11]);

    if (!county || !address) continue;
    countySet.add(county);

    leads.push({
      county,
      address,
      city: cityFinal,
      zip: zipFinal,
      caseNumber, // CRITICAL cross-confirm key (e.g. "23 FC 553")
      court: courtFor(county),
      // Intercounty publishes the foreclosure FIRM, not plaintiff/defendant.
      attorney: firm,
      sale,
      openingBid,
      status,
      sourceUrl: URL,
    });
  }

  if (!leads.length) {
    return {
      status: "blocked",
      note: `Parsed ${URL} but extracted 0 sale rows (tbody present, ${rows.length} <tr>). Ninja-Tables column layout likely changed.`,
      leads: [],
    };
  }

  const appeared = [...countySet].sort();
  const inScope = appeared.filter((c) => TARGET.has(c));
  meta.counties = inScope.length
    ? inScope
    : ["Winnebago", "Boone", "McHenry", "Lake", "Kane", "Will"];

  const inTarget = leads.filter((l) => TARGET.has(l.county)).length;
  const withCase = leads.filter((l) => l.caseNumber).length;
  const withBid = leads.filter((l) => l.openingBid != null).length;
  const note =
    `${leads.length} judicial sales statewide across ${appeared.length} counties ` +
    `(${inTarget} in target: ${inScope.join(", ") || "none"}). ` +
    `${withCase} have a case# (cross-confirm key), ${withBid} a bid amount. ` +
    `Firm/attorney captured (Intercounty doesn't publish plaintiff/defendant separately).`;

  return { status: "ok", note, leads };
}
