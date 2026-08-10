// The Judicial Sales Corporation (tjsc.com) — multi-county IL judicial-foreclosure SALES.
// Highest-value trigger: one HTML page lists every upcoming sheriff/judicial sale TJSC runs
// for Cook + collar + downstate counties, ~90 days out. It's an ASP.NET page that renders the
// full results table on GET to /Sales/UpcomingSales (no AJAX/JSON endpoint exists — the
// DataTable is server-rendered), so we fetch the page and parse the <tbody> rows.
//
// Table columns (verified live): Sale Date | Sale Time | File Number | Case Number |
// Firm Name | Address | City | County | Zip Code | Opening Bid | Required % Down |
// Sale Amount | Continuance | Sold To.
// NOTE: TJSC does NOT publish plaintiff(lender)/defendant(owner) — only the foreclosure
// attorney firm. Opening Bid is "TBD" until ~1 day before the sale, so it's usually null here.
import { fetchText } from "../http.js";

export const meta = {
  id: "tjsc",
  label: "The Judicial Sales Corp — upcoming sales (multi-county)",
  source: "tjsc.com",
  kind: "trigger",
  counties: [
    "Cook",
    "DuPage",
    "Lake",
    "Will",
    "Kane",
    "McHenry",
    "Winnebago",
    "Boone",
  ],
  method: "http",
};

const URL = "https://www.tjsc.com/Sales/UpcomingSales";

// Counties the engine actively works (collar + Rockford area). Everything TJSC lists is
// returned, but we tag meta.counties with the in-scope ones that actually appeared.
const IN_SCOPE = new Set([
  "Cook",
  "DuPage",
  "Lake",
  "Will",
  "Kane",
  "McHenry",
  "Winnebago",
  "Boone",
]);

function decode(s) {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function cell(html) {
  return decode(
    html
      .replace(/<[^>]+>/g, " ") // strip <a>…</a> wrappers around address
      .replace(/\s+/g, " ")
      .trim(),
  );
}

// "6/8/2026" -> "2026-06-08"
function toIso(d) {
  const m = (d || "").match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!m) return null;
  const [, mo, da, yr] = m;
  return `${yr}-${mo.padStart(2, "0")}-${da.padStart(2, "0")}`;
}

// "$329,530.30" / "TBD" / "$0.00" -> number | null
function toMoney(s) {
  const v = (s || "").replace(/[^0-9.]/g, "");
  if (!v) return null;
  const n = Math.round(parseFloat(v));
  return n > 0 ? n : null;
}

// 17th-circuit-ish court label per county (best-effort; TJSC doesn't print the circuit).
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
      note: `tjsc.com unreachable: ${String(e.message || e)} (endpoint ${URL})`,
      leads: [],
    };
  }

  const tbody = html.match(/<tbody>([\s\S]*?)<\/tbody>/i);
  if (!tbody) {
    return {
      status: "blocked",
      note: `No results table found at ${URL} — page layout changed (cols expected: Sale Date|Sale Time|File Number|Case Number|Firm Name|Address|City|County|Zip|Opening Bid).`,
      leads: [],
    };
  }

  // Date range from the panel title, e.g. "Upcoming Sales from 6/7/2026 to 9/5/2026"
  const range = html.match(/Upcoming Sales from\s*([\d/]+)\s*to\s*([\d/]+)/i);

  const rows = tbody[1].match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) || [];
  const leads = [];
  const countySet = new Set();

  for (const row of rows) {
    const tds = row.match(/<td[^>]*>([\s\S]*?)<\/td>/gi);
    if (!tds || tds.length < 10) continue;
    const c = tds.map((td) =>
      cell(td.replace(/^<td[^>]*>/i, "").replace(/<\/td>$/i, "")),
    );

    const sale = toIso(c[0]);
    const caseNumber = c[3] || null;
    const firm = c[4] || null;
    const address = c[5] || null;
    const city = c[6] || null;
    const county = c[7] || null;
    const zip = (c[8] || "").match(/\d{5}/)?.[0] || null;
    const openingBid = toMoney(c[9]);

    if (!address || !county) continue;
    countySet.add(county);

    leads.push({
      county,
      address,
      city: city || null,
      zip,
      caseNumber,
      court: courtFor(county),
      // TJSC publishes the foreclosure attorney firm, NOT plaintiff(lender)/defendant(owner).
      attorney: firm,
      sale,
      openingBid,
      sourceUrl: URL,
    });
  }

  if (!leads.length) {
    return {
      status: "blocked",
      note: `Parsed ${URL} but extracted 0 sale rows (table present, ${rows.length} <tr>). Selector/column layout likely changed.`,
      leads: [],
    };
  }

  const appeared = [...countySet].sort();
  const inScope = appeared.filter((c) => IN_SCOPE.has(c));
  meta.counties = inScope.length ? inScope : appeared;

  const withBid = leads.filter((l) => l.openingBid != null).length;
  const rangeStr = range ? ` (${toIso(range[1])} → ${toIso(range[2])})` : "";
  const note =
    `${leads.length} upcoming judicial sales across ${appeared.length} counties${rangeStr}: ` +
    `${appeared.join(", ")}. ${withBid} have a published opening bid (rest TBD until ~1 day before sale). ` +
    `Plaintiff/defendant not published by TJSC; attorney firm captured instead.`;

  return { status: "ok", note, leads };
}
