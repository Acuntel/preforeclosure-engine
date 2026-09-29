// Cook County Clerk — recorded LIS PENDENS FORECLOSURE ("CRS" Record of Deeds
// search). The EARLIEST Cook signal: the LP the lender records when it files the
// foreclosure suit — ~8-12 months before any judicial sale, and the index rows
// carry grantor (plaintiff/lender), grantee (homeowner/defendant), PIN AND the
// street address + city inline. Plain ASP.NET MVC over HTTPS — no Playwright, no
// WAF, no captcha (verified 2026-07-21: LISF ≈ 170-195/week, current to ~1 week;
// recordings take ~1-2 weeks to become searchable, so a fresh LP surfaces here
// well inside the ≤30d "brand new" scoring window).
//
// Flow (all with one cookie jar + the form's anti-forgery token):
//   GET  /Search/Additional                  -> antiforgery cookie + token
//   POST /Search/Additional?Index=#collapse3 -> 302 (criteria stored in session)
//        body: DocumentType=LISF, RecordedFromDate/RecordedToDate (mm/dd/yyyy)
//        ⚠️ do NOT send empty LowerLimit/UpperLimit — empty strings break model
//        binding server-side and the search silently returns "No Document(s)".
//   GET  /Search/ResultAddt?id1=#collapse3   -> results page 1
//   GET  /Search/SortResultAddt?...&page=N   -> partial HTML for further pages
import { fetchText, USER_AGENT } from "../http.js";

export const meta = {
  id: "recorder-cook",
  label: "Cook County Clerk — recorded LIS PENDENS (CRS)",
  source: "crs.cookcountyclerkil.gov",
  kind: "trigger",
  counties: ["Cook"],
  method: "http",
};

const BASE = "https://crs.cookcountyclerkil.gov";
const LOOKBACK_DAYS = Number(process.env.COOK_LP_LOOKBACK_DAYS || 45);
// LISF = "LIS PENDENS FORECLOSURE" (the live type — plain LISP returned 0 across
// probed months). AMLF amendments excluded: they re-notice existing suits.
const DOC_TYPES = ["LISF"];
const MAX_PAGES = 25;
// CRS returns at most 1000 rows per search (10 pages of 100; a 75-day window came
// back at exactly 1000 on 2026-09-28 while 14-day chunks of the same span gave
// 1612). The 45-day window is about 750 today, under the cap, but search in date
// chunks so volume growth can never silently truncate the pool.
const CHUNK_DAYS = Number(process.env.COOK_LP_CHUNK_DAYS || 14);
const CRS_CAP = 1000;
const COURT = "Cook County Circuit Court (Chancery) — recorded notice";

const mmddyyyy = (d) =>
  `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}/${d.getFullYear()}`;

// Minimal cookie jar: CRS only needs the antiforgery + session cookies echoed back.
function jarFrom(res, jar = {}) {
  for (const c of res.headers.getSetCookie?.() || []) {
    const [pair] = c.split(";");
    const eq = pair.indexOf("=");
    if (eq > 0) jar[pair.slice(0, eq).trim()] = pair.slice(eq + 1).trim();
  }
  return jar;
}
const cookieHeader = (jar) =>
  Object.entries(jar)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");

const HEADERS = (jar, extra = {}) => ({
  "User-Agent": USER_AGENT,
  Accept: "text/html,application/xhtml+xml",
  Referer: `${BASE}/Search/Additional`,
  ...(Object.keys(jar).length ? { Cookie: cookieHeader(jar) } : {}),
  ...extra,
});

// Anti-forgery token of the #collapse3 (document-type + date-range) form.
function collapse3Token(html) {
  const m = html.match(
    /Index=%23collapse3"[^>]*>\s*<input[^>]*__RequestVerificationToken[^>]*value="([^"]+)"/,
  );
  return m ? m[1] : null;
}

const strip = (s) =>
  String(s || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();

// One results <tr> -> lead. Cells are read by content shape, not position, so a
// column shuffle doesn't silently misfile names:
//   docNumber = first long digit run · dates = m/d/yyyy spans (recorded first)
//   pin + address = the ResultByPin cell · grantor/grantee = the two name cells
//   in DOM order (grantor column precedes grantee, per the sort-header order).
function parseRow(tr) {
  const tds = [...tr.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => m[1]);
  if (!tds.length) return null;

  const detail = tr.match(/href="(\/Document\/Detail[^"]+)"/);
  const pinM = tr.match(/ResultByPin\?id1=\d+"[^>]*>([\d-]+)</);
  const addrM = tr.match(/<span class="small"><span>([^<]+)<\/span>/);

  let docNumber = null;
  const dates = [];
  const names = [];
  let docType = null;
  for (const td of tds) {
    if (/ResultByPin|Document\/Detail|type="checkbox"/.test(td)) continue;
    const text = strip(td);
    if (!text) continue;
    if (/^\d{8,}$/.test(text)) docNumber = docNumber || text;
    else if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(text)) dates.push(text);
    else if (/LIS ?PENDENS|FORECLOS/i.test(text)) docType = text;
    else if (/^[\d,.$]+$/.test(text))
      continue; // consideration amount
    else names.push(text);
  }

  const recorded = dates[0] || null;
  const iso = recorded
    ? recorded.replace(
        /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/,
        (_, mo, d, y) => `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`,
      )
    : null;

  // address cell reads "360 MERRILL AVE, CALUMET CITY"
  let address = null;
  let city = null;
  if (addrM) {
    const parts = strip(addrM[1]).split(",");
    address = parts.slice(0, -1).join(",").trim() || strip(addrM[1]);
    city = parts.length > 1 ? parts[parts.length - 1].trim() : null;
  }

  return {
    county: "Cook",
    address,
    city,
    zip: null,
    owner: names[1] || null, // grantee = homeowner/defendant
    lender: names[0] || null, // grantor = plaintiff/lender
    docNumber,
    pin: pinM ? pinM[1].replace(/-/g, "") : null,
    court: COURT,
    filing: iso,
    stage: "lis_pendens",
    kind: "trigger",
    docType: docType || "LIS PENDENS FORECLOSURE",
    sourceUrl: detail ? BASE + detail[1] : `${BASE}/Search/Additional`,
  };
}

function parseRows(html) {
  const body = html.match(/<tbody[^>]*>([\s\S]*?)<\/tbody>/);
  if (!body) return [];
  return [...body[1].matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)]
    .map((m) => parseRow(m[1]))
    .filter(Boolean);
}

async function fetchRaw(url, opts = {}) {
  const res = await fetch(url, { redirect: "manual", ...opts });
  return res;
}

export async function collect() {
  const jar = {};
  let formHtml;
  try {
    const res = await fetchRaw(`${BASE}/Search/Additional`, {
      headers: HEADERS(jar),
    });
    jarFrom(res, jar);
    formHtml = await res.text();
  } catch (e) {
    return {
      status: "blocked",
      note: `GET ${BASE}/Search/Additional failed: ${String(e.message || e)}`,
      leads: [],
    };
  }
  const token = collapse3Token(formHtml);
  if (!token)
    return {
      status: "blocked",
      note: "CRS advanced-search form loaded but no #collapse3 anti-forgery token found — form layout changed, re-inspect",
      leads: [],
    };

  const today = new Date();
  const windows = [];
  const totalDays = LOOKBACK_DAYS + 1; // today back to today-LOOKBACK, inclusive
  for (let back = 0; back < totalDays; back += CHUNK_DAYS) {
    const to = new Date(today.getTime() - back * 86400e3);
    const span = Math.min(CHUNK_DAYS, totalDays - back);
    // inclusive dates: this window starts the day after the next one ends
    windows.push({ to, from: new Date(to.getTime() - (span - 1) * 86400e3) });
  }
  const byKey = new Map();
  let failures = 0;
  let noDocs = 0;
  let capped = 0;
  const searches = DOC_TYPES.flatMap((docType) =>
    windows.map((w) => ({ docType, ...w })),
  );

  for (const { docType, from, to } of searches) {
    try {
      const body = new URLSearchParams({
        __RequestVerificationToken: token,
        DocumentType: docType,
        RecordedFromDate: mmddyyyy(from),
        RecordedToDate: mmddyyyy(to),
        submitButton: "search",
      }).toString();
      const post = await fetchRaw(
        `${BASE}/Search/Additional?Index=%23collapse3`,
        {
          method: "POST",
          headers: HEADERS(jar, {
            "Content-Type": "application/x-www-form-urlencoded",
          }),
          body,
        },
      );
      jarFrom(post, jar);

      const page1 = await fetchText(
        `${BASE}/Search/ResultAddt?id1=%23collapse3`,
        { headers: HEADERS(jar), cache: false, retries: 1 },
      );
      if (/No Document\(s\) found/i.test(page1)) {
        noDocs++;
        continue;
      }
      let rows = parseRows(page1);
      const totalPages = Number(
        (page1.match(/Page \d+ of (\d+)/) || [])[1] || 1,
      );
      for (let p = 2; p <= Math.min(totalPages, MAX_PAGES); p++) {
        const part = await fetchText(
          `${BASE}/Search/SortResultAddt?id1=%23collapse3&column=DateRecorded&direction=desc&page=${p}`,
          { headers: HEADERS(jar), cache: false, retries: 1 },
        );
        rows = rows.concat(parseRows(part));
      }
      if (rows.length >= CRS_CAP) capped++;
      for (const lead of rows) {
        const key = lead.docNumber || `${lead.pin}|${lead.filing}`;
        if (!byKey.has(key)) byKey.set(key, lead);
      }
    } catch (e) {
      failures++;
    }
  }

  const leads = [...byKey.values()].sort((a, b) =>
    (b.filing || "").localeCompare(a.filing || ""),
  );

  if (!leads.length) {
    if (failures)
      return {
        status: "blocked",
        note: `CRS search flow failed for ${failures}/${searches.length} search(es) — token/cookie or layout change likely`,
        leads: [],
      };
    return {
      status: "ok",
      note: `0 LIS PENDENS FORECLOSURE recorded in the last ${LOOKBACK_DAYS}d window (${noDocs} type(s) confirmed empty — note CRS indexes recordings ~1-2 weeks behind)`,
      leads: [],
    };
  }

  const withAddr = leads.filter((l) => l.address).length;
  return {
    status: failures ? "partial" : "ok",
    note: `${leads.length} recorded LIS PENDENS FORECLOSURE in Cook over last ${LOOKBACK_DAYS}d in ${searches.length} date chunks${capped ? ` (${capped} chunk(s) hit the ${CRS_CAP}-row CRS cap; lower COOK_LP_CHUNK_DAYS)` : ""}${failures ? `, ${failures} chunk(s) failed` : ""} (${withAddr} with street address+city inline, PIN on ${leads.filter((l) => l.pin).length}; index lags recording ~1-2wk)`,
    leads,
  };
}
