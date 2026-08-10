// Judici — Boone County (IL004015J) chancery / mortgage-foreclosure filings.
// Earliest 90-day signal: a CH/FC case FILED is months ahead of any sheriff sale.
//
// LIVE SOURCE FACTS (confirmed by fetching judici.com on 2026-06-07):
//   - Court list (https://www.judici.com/courts/index.jsp) lists
//       <option value="IL004015J">Boone County, IL</option>   <- real court code
//   - Case search:  https://www.judici.com/courts/cases/case_search.jsp?court=IL004015J
//   - That page is GATED by hCaptcha ("Please verify your humanity",
//     sitekey 6f611af1-aadc-4b61-84f0-2f79f0bc628c, <form action="/verifyCaptcha">).
//     A solved hCaptcha token + session cookie is required before any case list
//     is served. There is no public unauthenticated JSON/GET search endpoint.
//
// This module hits the REAL endpoint. If the captcha wall (or a per-IP throttle,
// which judici applies after a few requests) is present it returns an honest
// status:"blocked" — it NEVER fabricates cases. If a session is ever served the
// real case-list table (e.g. judici relaxes for a given IP, or a future
// playwright relay supplies a solved-captcha cookie via opts.cookie), it parses
// the rows into the contract schema.
import { fetchText } from "../http.js";

const COURT = "IL004015J"; // Boone County, IL — confirmed live from court list
const BASE = "https://www.judici.com";
const SEARCH = `${BASE}/courts/cases/case_search.jsp?court=${COURT}`;
const COURT_LABEL = "17th Judicial Circuit, Boone County";

export const meta = {
  id: "judici-boone",
  label: "Judici — Boone chancery",
  source: "judici.com",
  kind: "trigger",
  counties: ["Boone"],
  method: "http",
};

const isCaptcha = (html) =>
  /Judici Captcha Page|h-captcha|verify your humanity|verifyCaptcha/i.test(
    html,
  );

const clean = (s) =>
  (s || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, " ")
    .trim();

// "10/07/2025" | "2025-10-07" | "Oct 7, 2025" -> "YYYY-MM-DD" | null
function toISO(raw) {
  const s = clean(raw);
  let m = s.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/);
  if (m) return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  m = s.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  const MO = {
    jan: "01",
    feb: "02",
    mar: "03",
    apr: "04",
    may: "05",
    jun: "06",
    jul: "07",
    aug: "08",
    sep: "09",
    oct: "10",
    nov: "11",
    dec: "12",
  };
  m = s.match(/\b([A-Za-z]{3})[a-z]*\s+(\d{1,2}),?\s+(\d{4})\b/);
  if (m && MO[m[1].toLowerCase()])
    return `${m[3]}-${MO[m[1].toLowerCase()]}-${m[2].padStart(2, "0")}`;
  return null;
}

// Judici classifies foreclosures as CH (Chancery) or FC, displayed with the
// statutory description "Mortgage Foreclosure".
// Judici displays the statutory case-TYPE text. Match foreclosure by that type
// description ("Mortgage Foreclosure" / "Foreclosure" / "Chancery"), NOT by a
// bare "CH" token — a Small Claims case numbered e.g. 2026-CH-0052 must not match.
const FORECLOSURE_RE = /mortgage\s*foreclosure|foreclosure|chancery/i;
// A real chancery/foreclosure case number uses a -CH-/-FC- class code.
const CASE_NUM_RE = /\b(\d{2,4}\s*-\s*(?:CH|FC)\s*-\s*\d{1,6})\b/i;

// Parse the judici case-list results table. Each result row links to
// case_information.jsp?court=...&ocl=<case-key> and carries case#, type,
// caption (Plaintiff v. Defendant) and filed date in adjacent cells.
function parseCaseList(html) {
  const leads = [];
  const seen = new Set();
  const rows = html.split(/<tr[\s>]/i).slice(1);
  for (const row of rows) {
    const link = row.match(
      /case_information\.jsp\?[^"']*?ocl=([^"'&]+)[^"']*/i,
    );
    if (!link) continue;
    const cells = (row.match(/<td[^>]*>([\s\S]*?)<\/td>/gi) || []).map(clean);
    const joined = cells.join(" | ");
    // Foreclosure only: type text must say foreclosure/chancery. Strip the case
    // number first so a "-CH-" in the number can't satisfy the type test.
    const caseNumMatch = joined.match(CASE_NUM_RE);
    const typeText = caseNumMatch
      ? joined.replace(caseNumMatch[1], " ")
      : joined;
    if (!FORECLOSURE_RE.test(typeText)) continue;

    const caseNumber = caseNumMatch
      ? caseNumMatch[1].replace(/\s*-\s*/g, "-").replace(/\s+/g, "")
      : clean(link[1]);
    const caseType = /foreclosure/i.test(joined)
      ? "Mortgage Foreclosure"
      : /\bFC\b/i.test(caseNumber)
        ? "FC"
        : "CH";

    // Caption "Plaintiff v. Defendant" -> lender / owner
    let lender = null,
      owner = null;
    const vs = joined.match(/([^|]+?)\s+v(?:s|\.|\s)\.?\s+([^|]+)/i);
    if (vs) {
      lender = clean(vs[1]).replace(/^.*?:/, "").trim() || null;
      owner =
        clean(vs[2])
          .split(/\bet\s*al\b/i)[0]
          .trim() || null;
    }

    let filing = null;
    for (const c of cells) {
      const d = toISO(c);
      if (d) {
        filing = d;
        break;
      }
    }

    const key = caseNumber + "|" + (owner || "");
    if (seen.has(key)) continue;
    seen.add(key);

    leads.push({
      county: "Boone",
      address: null, // judici case list has no property address; enrich-boone fills it
      city: null,
      zip: null,
      owner: owner || null,
      caseNumber,
      caseType,
      court: COURT_LABEL,
      lender: lender || null,
      attorney: null,
      filing,
      judgment: null,
      sale: null,
      openingBid: null,
      sourceUrl: `${BASE}/courts/cases/case_information.jsp?court=${COURT}&ocl=${encodeURIComponent(
        link[1],
      )}`,
    });
  }
  return leads;
}

export async function collect(opts = {}) {
  // A solved-captcha session cookie can be injected by a future playwright relay.
  const headers = opts.cookie ? { Cookie: opts.cookie } : {};
  let html;
  try {
    html = await fetchText(SEARCH, { headers, cache: false, retries: 2 });
  } catch (e) {
    return {
      status: "blocked",
      note:
        `judici.com unreachable for Boone (${COURT}) at ${SEARCH} — ` +
        `${String(e.message || e).slice(0, 120)}. judici throttles per-IP and ` +
        `gates case_search.jsp behind hCaptcha; needs a solved-captcha session.`,
      leads: [],
    };
  }

  if (isCaptcha(html)) {
    return {
      status: "blocked",
      note:
        `Boone County IS on Judici (court ${COURT}, ${COURT_LABEL}). ` +
        `case_search.jsp is gated by hCaptcha ("Please verify your humanity", ` +
        `sitekey 6f611af1-aadc-4b61-84f0-2f79f0bc628c, POST /verifyCaptcha). ` +
        `No public unauthenticated GET/JSON search exists — a solved hCaptcha ` +
        `token + session cookie (headless browser / 2captcha relay) is required ` +
        `before any CH/FC case list is served. Endpoint: ${SEARCH}`,
      leads: [],
    };
  }

  const leads = parseCaseList(html);
  if (!leads.length) {
    return {
      status: "blocked",
      note:
        `Reached Boone case_search.jsp (no captcha) but found 0 parseable ` +
        `CH/FC rows. Page likely needs the search POST (case type CH/FC, date ` +
        `range) executed against the form. Endpoint: ${SEARCH}`,
      leads: [],
    };
  }

  return {
    status: "ok",
    note: `${leads.length} Boone CH/FC foreclosure filings parsed from judici (${COURT}).`,
    leads,
  };
}
