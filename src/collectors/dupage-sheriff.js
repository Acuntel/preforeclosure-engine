// DuPage County Sheriff: upcoming judicial foreclosure SALES. The public page
// dupagesheriff.org/foreclosureListings is rendered from a free, unauthenticated
// JSON feed on the OCV app platform (no login, no captcha, works from Railway).
// Each row: title "PLAINTIFF VS DEFENDANT ET AL" plus an HTML blob with Sale Date,
// Case Number ("24FC514"), Opening Bid (usually "Not Provided"), Property Address
// ("132 SOUTH LINDEN AVE ELMHURST 60126", no comma before the city) and Attorney.
//
// Case numbers are emitted Intercounty style ("24 FC 514") so match.js normCase
// cross-confirms the ~20 sales Intercounty also lists. Stage is NOT hardcoded:
// like will-sheriff / lake-sheriff, score.js derives it from the sale date.
import { fetchJson } from "../http.js";

export const meta = {
  id: "dupage-sheriff",
  label: "DuPage County Sheriff - upcoming foreclosure sales",
  source: "dupagesheriff.org (apps.myocv.com feed)",
  kind: "trigger",
  counties: ["DuPage"],
  method: "http",
};

export const FEED =
  "https://apps.myocv.com/feed/rtjb/a36160187/foreclosureListings";
const PAGE = "https://www.dupagesheriff.org/foreclosureListings";
const COURT =
  "Circuit Court of DuPage County, Illinois (18th Judicial Circuit)";

// DuPage municipalities (plus border towns with DuPage parcels), longest first
// so "WEST CHICAGO" wins over "CHICAGO" and "OAKBROOK TERRACE" over "OAKBROOK".
// prettier-ignore
const CITIES = ["ADDISON","AURORA","BARTLETT","BENSENVILLE","BLOOMINGDALE","BOLINGBROOK","BURR RIDGE","CAROL STREAM","CLARENDON HILLS","DARIEN","DOWNERS GROVE","ELMHURST","GLEN ELLYN","GLENDALE HEIGHTS","HANOVER PARK","HINSDALE","ITASCA","LISLE","LOMBARD","MEDINAH","NAPERVILLE","OAK BROOK","OAKBROOK","OAKBROOK TERRACE","ROSELLE","VILLA PARK","WARRENVILLE","WAYNE","WEST CHICAGO","WESTMONT","WHEATON","WILLOWBROOK","WINFIELD","WOOD DALE","WOODRIDGE","ELK GROVE VILLAGE","SCHAUMBURG","STREAMWOOD","ELGIN","ST CHARLES","SAINT CHARLES","LEMONT","INDIAN HEAD PARK","WILLOW SPRINGS","HODGKINS","CHICAGO"]
  .sort((a, b) => b.length - a.length);
const CITY_FIX = {
  OAKBROOK: "Oak Brook",
  "SAINT CHARLES": "St. Charles",
  "ST CHARLES": "St. Charles",
};
const SUFFIX =
  /\b(?:STREET|ST|AVENUE|AVE|ROAD|RD|DRIVE|DR|LANE|LN|COURT|CT|PLACE|PL|BOULEVARD|BLVD|WAY|CIRCLE|CIR|TERRACE|TER|TRAIL|TRL|PARKWAY|PKWY|HIGHWAY|HWY|PATH|CROSSING|SQUARE)\.?$/;

// Title-case words, but keep grid addresses ("3S665", "21W205") and units upper.
export const titleCase = (s) =>
  String(s || "")
    .toLowerCase()
    .replace(/\b[a-z][a-z']*/g, (w) => w[0].toUpperCase() + w.slice(1))
    .replace(/\b\d+[a-z]\d*\b/gi, (t) => t.toUpperCase())
    .replace(/\b(Apt|Unit)\s+(\w+)/g, (_, u, n) => `${u} ${n.toUpperCase()}`);

// "$249,343.91" -> 249344 ; "Not Provided" -> null
export function money(s) {
  const v = String(s || "").replace(/[^0-9.]/g, "");
  const n = v ? Math.round(parseFloat(v)) : 0;
  return Number.isFinite(n) && n > 0 ? n : null;
}

// "10/01/2026" -> "2026-10-01"
export function isoDate(s) {
  const m = String(s || "").match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  return m ? `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}` : null;
}

// "24FC514" -> "24 FC 514" (the Intercounty spelling of the same DuPage case)
export function normCaseNo(s) {
  const t = String(s || "")
    .toUpperCase()
    .replace(/\s+/g, "");
  const m = t.match(/^(\d{2,4})-?([A-Z]{2})-?0*(\d+)$/);
  return m ? `${m[1]} ${m[2]} ${m[3]}` : t || null;
}

// "132 SOUTH LINDEN AVE ELMHURST 60126" -> { address, city, zip }
export function parseAddress(raw) {
  let s = String(raw || "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();
  const zm = s.match(/\s(\d{5})(?:-\d{4})?$/);
  let zip = zm ? zm[1] : null;
  if (zm) s = s.slice(0, zm.index).trim();
  if (zip && !/^6[0-2]\d{3}$/.test(zip)) zip = null; // e.g. typo "30101"
  s = s
    .replace(/,?\s*(?:IL|ILLINOIS)$/, "")
    .replace(/,$/, "")
    .trim();
  let city = null;
  for (const c of CITIES)
    if (s === c || s.endsWith(" " + c)) {
      city = c;
      s = s
        .slice(0, s.length - c.length)
        .replace(/,\s*$/, "")
        .trim();
      break;
    }
  if (!city) {
    // fallback: city = words after the last street suffix
    const words = s.split(" ");
    for (let i = words.length - 2; i > 0; i--)
      if (SUFFIX.test(words[i])) {
        city = words.slice(i + 1).join(" ");
        s = words.slice(0, i + 1).join(" ");
        break;
      }
  }
  // "18 WEST 151 KIRKLAND LANE" -> DuPage grid form "18W151 KIRKLAND LANE"
  s = s.replace(
    /^(\d+)\s+(NORTH|SOUTH|EAST|WEST)\s+(\d+)\s/,
    (_, a, d, b) => `${a}${d[0]}${b} `,
  );
  // a bare unit after the suffix ("FOUR LAKES AVENUE 4F") -> "... Unit 4F"
  s = s.replace(
    /(\b(?:AVENUE|AVE|STREET|ST|DRIVE|DR|LANE|LN|ROAD|RD|COURT|CT|CIRCLE|CIR|TRAIL)\.?)\s+(\d+[A-Z]?|[A-Z]\d*)$/,
    "$1 UNIT $2",
  );
  s = s.replace(/\s+#\s*(\w+)$/, " UNIT $1");
  return {
    address: s ? titleCase(s) : null,
    city: city ? CITY_FIX[city] || titleCase(city) : null,
    zip,
  };
}

// Title -> { lender, owner, defendant }. Owner keeps a DECEASED / heirs marker so
// the estate regex downstream fires; "HIERS" (sic, in the feed) is corrected.
export function parseTitle(title) {
  const t = String(title || "")
    .replace(/\s+/g, " ")
    .trim();
  const i = t.toUpperCase().lastIndexOf(" VS ");
  if (i < 0) return { lender: null, owner: null, defendant: null };
  const stripEtAl = (s) => s.replace(/,?\s*ET\.?\s*AL\.?\s*$/i, "").trim();
  const lender = stripEtAl(t.slice(0, i))
    .replace(/,?\s+NOT IN ITS\b.*$/i, "")
    .replace(/^(.*?)\s+THE$/i, "THE $1")
    .trim();
  const defendant = stripEtAl(t.slice(i + 4)).replace(/\bHIERS\b/gi, "HEIRS");
  const owner = defendant
    .replace(/\s+(?:UNKNOWN\s+HEIRS|AND\s+OR\s+LEGATEES|LEGATEES).*$/i, "")
    .replace(/\s+(?:AS\s+SUCCESSOR\s+TRUSTEE|AS\s+TRUSTEE).*$/i, "")
    .trim();
  return {
    lender: lender || null,
    owner: owner || null,
    defendant: defendant || null,
  };
}

// One feed row -> lead (or null when it has no address and no case#).
export function parseRow(row) {
  const body = String(row?.content || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ");
  const field = (k) =>
    (body.match(new RegExp(`${k}:[ \\t]*([^\\n]*)`, "i")) || [])[1]?.trim() ||
    null;
  const addr = parseAddress(field("Property Address"));
  const caseNumber = normCaseNo(field("Case Number"));
  if (!addr.address && !caseNumber) return null;
  const parties = parseTitle(row.title);
  return {
    county: "DuPage",
    address: addr.address,
    city: addr.city,
    zip: addr.zip,
    owner: parties.owner,
    defendant: parties.defendant,
    lender: parties.lender,
    caseNumber,
    court: COURT,
    attorney: field("Attorney"),
    attorneyPhone: field("Attorney Phone"),
    filing: null,
    judgment: null,
    sale: isoDate(field("Sale Date")),
    openingBid: money(field("Opening Bid")), // a true pre-sale opening bid
    sourceUrl: PAGE,
  };
}

export function parseFeed(json) {
  const rows = Array.isArray(json) ? json : json?.entries || json?.items || [];
  const seen = new Set();
  const leads = [];
  for (const r of rows) {
    if (r && r.status != null && Number(r.status) !== 1) continue; // unpublished
    const l = parseRow(r);
    if (!l) continue;
    const k = `${l.caseNumber}|${l.address}|${l.sale}`;
    if (seen.has(k)) continue; // the feed repeats some rows verbatim
    seen.add(k);
    leads.push(l);
  }
  return { rows: rows.length, leads };
}

// Cancellation signal for the caller's state: case#s seen on an earlier pass
// whose sale date has not arrived but which are now gone from the feed.
// prev = [{caseNumber, sale}], today = "YYYY-MM-DD" (Chicago).
export function vanishedCases(prev, leads, today) {
  const now = new Set(leads.map((l) => l.caseNumber));
  return (prev || []).filter(
    (p) => p.caseNumber && p.sale && p.sale >= today && !now.has(p.caseNumber),
  );
}

export async function collect() {
  let json;
  try {
    json = await fetchJson(FEED, { timeout: 30000 });
  } catch (e) {
    return {
      status: "blocked",
      note: `DuPage Sheriff feed unreachable: ${String(e.message || e)} (${FEED}).`,
      leads: [],
    };
  }
  const { rows, leads } = parseFeed(json);
  if (!leads.length)
    return {
      status: "blocked",
      note: `DuPage Sheriff feed returned ${rows} row(s) but 0 parsed sales. The row format (title "X VS Y", content "Sale Date / Case Number / Property Address") may have changed.`,
      leads: [],
    };
  const withBid = leads.filter((l) => l.openingBid).length;
  const noCity = leads.filter((l) => !l.city).length;
  return {
    status: "ok",
    note:
      `${leads.length} upcoming DuPage sheriff sales (${rows} feed rows), ` +
      `${withBid} with an opening bid${noCity ? `, ${noCity} without a parsed city` : ""}.`,
    leads,
  };
}
