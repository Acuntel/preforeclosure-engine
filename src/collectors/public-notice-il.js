// publicnoticeillinois.com — statewide legal-notice search (Illinois Press Assn).
// ASP.NET WebForms with COOKIELESS sessions: the session id lives in the URL path
// segment `/(S(xxxx))/Search.aspx`, NOT in a cookie. Flow:
//   1) GET /Search.aspx -> 302 to /(S(<sid>))/Search.aspx  (capture the sid)
//   2) GET the session page -> scrape __VIEWSTATE/__VIEWSTATEGENERATOR (no
//      __EVENTVALIDATION is emitted on this page)
//   3) POST the search (txtSearch keyword, rdoType=EXACT, last-N-days) to the SAME
//      session URL with Content-Type application/x-www-form-urlencoded
//   4) postback ddlPerPage=50 (re-using the result-page viewstate) to pull 50/page
// The PUBLIC results list yields court/circuit, county, plaintiff(lender),
// defendant(owner), case number, publication date per notice. The full notice body
// on Details.aspx (street address, "commonly known as", sale date, PIN) is GATED
// behind a free login — fetching Details.aspx returns an empty shell + "Sign In",
// even inside a live session. So this trigger returns the un-gated list fields and
// leaves address/sale for the per-county enrich step (case# + owner are enough to
// match the county chancery/treasurer record).
import { fetchText } from "../http.js";

export const meta = {
  id: "public-notice-il",
  label: "Public Notice Illinois — statewide foreclosure notices",
  source: "publicnoticeillinois.com",
  kind: "trigger",
  counties: ["(statewide)"],
  method: "http",
};

const ORIGIN = "https://www.publicnoticeillinois.com";
const KEYWORD = "foreclosure"; // broad: matches sheriff's/judicial sale notices
const LAST_DAYS = 45;
const PER_PAGE = 50;
const MAX_PAGES = 40; // walk up to this many result pages (≈2000 notices) for completeness
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const blocked = (note) => ({ status: "blocked", note, leads: [] });

const hidden = (html, name) => {
  const m = html.match(
    new RegExp(`name="${name}"[^>]*\\bvalue="([^"]*)"`, "i"),
  );
  return m ? m[1] : "";
};

const fmtDate = (d) => `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;

// IL counties needing canonical casing the rest of the engine expects.
// prettier-ignore
const CASE_FIX = { Dupage:"DuPage", Mchenry:"McHenry", Mclean:"McLean", Dekalb:"DeKalb", Lasalle:"LaSalle", Stclair:"St. Clair" };
const titleCase = (s) =>
  s.toLowerCase().replace(/(^|\s)\S/g, (m) => m.toUpperCase());
const fixCounty = (c) => {
  if (!c) return null;
  const t = titleCase(c).replace(/\s+/g, " ").trim();
  return CASE_FIX[t] || t;
};

// Circuit numbers in IL notices are spelled out ("EIGHTEENTH JUDICIAL CIRCUIT").
// prettier-ignore
const ORDINAL = { first:1,second:2,third:3,fourth:4,fifth:5,sixth:6,seventh:7,eighth:8,ninth:9,tenth:10,eleventh:11,twelfth:12,thirteenth:13,fourteenth:14,fifteenth:15,sixteenth:16,seventeenth:17,eighteenth:18,nineteenth:19,twentieth:20,"twenty-first":21,"twenty-second":22,"twenty-third":23,"twenty-fourth":24 };

const STREET_TYPE =
  "STREET|ST|AVENUE|AVE|ROAD|RD|DRIVE|DR|LANE|LN|COURT|CT|PLACE|PL|BOULEVARD|BLVD|WAY|CIRCLE|CIR|TERRACE|TER|TRAIL|TRL|HIGHWAY|HWY|PARKWAY|PKWY|PIKE|POINTE?|ROW|RUN|PATH|CROSSING|XING|SQUARE|SQ";

const clean = (s) =>
  s
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();

// clean() a captured string, apply a list of [regex, replacement] fixes, -> null if empty
const cleanup = (raw, fixes) => {
  let s = clean(raw || "");
  for (const [re, rep] of fixes) s = s.replace(re, rep);
  return s.trim() || null;
};

function parseAddress(t) {
  const m = t.match(
    new RegExp(
      `\\b(\\d{1,6}[A-Z]?\\s+[A-Z0-9][A-Za-z0-9 .#-]*?\\b(?:${STREET_TYPE})\\.?(?:\\s+(?:UNIT|APT|#)\\s*\\w+)?)\\s*,?\\s+([A-Z][A-Za-z. ]+?),?\\s+IL\\.?\\s+(\\d{5})`,
      "i",
    ),
  );
  if (!m) return {};
  return {
    address: titleCase(clean(m[1])),
    city: titleCase(clean(m[2])),
    zip: m[3],
  };
}

// 1 -> "1st", 18 -> "18th", etc.
const ordinal = (n) => {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
};

// Parse one notice snippet (the truncated legal text in the results grid). IL
// notices come in two shapes: "...JUDICIAL CIRCUIT <COUNTY> COUNTY" (downstate)
// and "...CIRCUIT COURT OF COOK COUNTY ... COUNTY DEPARTMENT - CHANCERY DIVISION".
function parseSnippet(raw) {
  const t = clean(raw);
  const county = fixCounty(
    (t.match(
      /(?:JUDICIAL\s+CIRCUIT|CIRCUIT\s+COURT\s+(?:OF|FOR)(?:\s+THE)?)\s+([A-Z][A-Za-z.]+(?:\s[A-Z][A-Za-z.]+)?)\s+COUNTY/,
    ) || [])[1],
  );
  const circWord = (t.match(/\b([A-Z]+(?:-[A-Z]+)?)\s+JUDICIAL\s+CIRCUIT/i) ||
    [])[1];
  const circNum = circWord ? ORDINAL[circWord.toLowerCase()] : null;
  const court = circNum
    ? `${ordinal(circNum)} Judicial Circuit, ${county || "IL"}`
    : county
      ? `Circuit Court of ${county} County`
      : null;

  // Plaintiff (lender): party right before "Plaintiff". Anchor on the closest of
  // CHANCERY DIVISION / ILLINOIS so Cook's "COUNTY DEPARTMENT - CHANCERY DIVISION"
  // (and the "MORTGAGE FORECLOSURE/MECHANICS LIEN SECTION") boilerplate is dropped.
  const lender = cleanup(
    (t.match(/CHANCERY DIVISION[ ,]+(.+?)[ ,]+Plaintiff/i) ||
      t.match(/ILLINOIS[ ,]+(.+?)[ ,]+Plaintiff/i) ||
      [])[1],
    [
      [/-\s+/g, ""], // hyphenated line-break artifacts (INDEN- TURE)
      [
        /^.*?(?:MORTGAGE FORECLOSURE|MECHANICS LIEN|FORECLOSURE)\s*\/?\s*(?:MECHANICS LIEN)?\s*SECTION\s*/i,
        "",
      ],
      [/^COUNTY DEPARTMENT\s*[-–]?\s*/i, ""],
      [/,$/, ""],
    ],
  );

  // Defendant (owner): named party(ies) after "v." up to "Defendant"; trim the
  // catch-all "UNKNOWN OWNERS / NON-RECORD CLAIMANTS / et al" co-defendants.
  const owner = cleanup(
    (t.match(
      /Plaintiff[, ]*(?:-?v[s.]{1,2}\.?-?|VS\.?)\s+(.+?)[ ,]+Defendant/i,
    ) || [])[1],
    [
      [/-\s+/g, ""],
      [/,?\s*(?:UNKNOWN|NON-?RECORD|et\.?\s*al).*$/i, ""],
      [/\s+A\/K\/A\s+.*$/i, ""],
      [/;.*$/, ""],
    ],
  );

  const caseNumber =
    (t.match(
      /\b(?:Case\s+)?No\.?\s*([0-9]{2,4}-?[A-Z]{0,3}-?[0-9A-Z-]{2,})/i,
    ) || [])[1] || null;

  return { county, court, lender, owner, caseNumber, ...parseAddress(t) };
}

// prettier-ignore
const MONTHS = "january february march april may june july august september october november december".split(" ");
function parsePubDate(s) {
  const m = clean(s).match(/([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})/);
  if (!m) return null;
  const mo = MONTHS.indexOf(m[1].toLowerCase());
  if (mo < 0) return null;
  const p2 = (n) => String(n).padStart(2, "0");
  return `${m[3]}-${p2(mo + 1)}-${p2(+m[2])}`;
}

// Split the results grid into per-notice blocks and extract every field we can.
function parseResults(html, sid) {
  const leads = [];
  const seen = new Set();
  const re =
    /Details\.aspx\?SID=[a-z0-9]+&amp;ID=(\d+)[\s\S]*?class="left"><strong>(.*?)<\/strong><br\s*\/?>\s*(.*?)<\/div>[\s\S]*?colspan="3"[^>]*>([\s\S]*?)<\/td>/g;
  let m;
  while ((m = re.exec(html))) {
    const [, id, pubRaw, dateRaw, snip] = m;
    if (seen.has(id)) continue;
    seen.add(id);
    const f = splitCookCase(parseSnippet(snip));
    leads.push({
      county: f.county || "(unknown)",
      address: f.address || null,
      city: f.city || null,
      zip: f.zip || null,
      owner: f.owner,
      caseNumber: f.caseNumber,
      court: f.court,
      lender: f.lender,
      attorney: null,
      filing: null,
      judgment: null,
      sale: null, // gated behind login on Details.aspx
      openingBid: null,
      publication: clean(pubRaw),
      published: parsePubDate(dateRaw),
      sourceUrl: `${ORIGIN}/Details.aspx?SID=${sid}&ID=${id}`,
    });
  }
  return leads;
}

// Cook County notices print the case as "2025 CH 09661" (CHancery) inline ahead
// of the street address; pull it out so it lands in caseNumber, not address.
function splitCookCase(f) {
  if (!f.address) return f;
  const m = f.address.match(/^(\d{4})\s+Ch\s+(\d{3,6})\s+(.+)$/i);
  if (!m) return f;
  return {
    ...f,
    caseNumber: f.caseNumber || `${m[1]} CH ${m[2]}`,
    address: titleCase(m[3]),
  };
}

function buildSearchForm(html, override = {}) {
  const fields = {
    __EVENTTARGET: "",
    __EVENTARGUMENT: "",
    __VIEWSTATE: hidden(html, "__VIEWSTATE"),
    __VIEWSTATEGENERATOR: hidden(html, "__VIEWSTATEGENERATOR"),
    ctl00$ContentPlaceHolder1$as1$txtSearch: KEYWORD,
    ctl00$ContentPlaceHolder1$as1$txtExclude: "",
    ctl00$ContentPlaceHolder1$as1$rdoType: "EXACT",
    ctl00$ContentPlaceHolder1$as1$dateRange: "rbLastNumDays",
    ctl00$ContentPlaceHolder1$as1$txtLastNumDays: String(LAST_DAYS),
    ctl00$ContentPlaceHolder1$as1$txtLastNumWeeks: "52",
    ctl00$ContentPlaceHolder1$as1$txtLastNumMonths: "12",
    ctl00$ContentPlaceHolder1$as1$txtDateFrom: fmtDate(
      new Date(Date.now() - LAST_DAYS * 864e5),
    ),
    ctl00$ContentPlaceHolder1$as1$txtDateTo: fmtDate(new Date()),
    ctl00$ContentPlaceHolder1$as1$btnGo1: "",
    ...override,
  };
  // a key set to undefined in `override` means "drop this field" (URLSearchParams
  // would otherwise serialize it as the literal string "undefined").
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(fields))
    if (v !== undefined) p.append(k, v);
  return p.toString();
}

export async function collect() {
  try {
    // 1) GET base; manual-follow the cookieless 302 to capture the session id.
    const res = await fetch(`${ORIGIN}/Search.aspx`, {
      redirect: "manual",
      headers: { "User-Agent": UA },
    });
    const loc = res.headers.get("location") || "";
    const sid = (loc.match(/\(S\(([a-z0-9]+)\)\)/) || [])[1];
    if (!sid)
      return blocked(
        `No cookieless session id in 302 Location (${loc.slice(0, 80)}). Endpoint: ${ORIGIN}/Search.aspx`,
      );
    const sessUrl = `${ORIGIN}/(S(${sid}))/Search.aspx`;

    // 2) GET the session page for the viewstate (per-session — never cache it).
    const page = await fetchText(sessUrl, { cache: false });
    if (!hidden(page, "__VIEWSTATE"))
      return blocked(
        `Session ${sid} but no __VIEWSTATE on ${sessUrl}. Expected hidden: __VIEWSTATE,__VIEWSTATEGENERATOR (no __EVENTVALIDATION). Search field ctl00$ContentPlaceHolder1$as1$txtSearch; submit ctl00$ContentPlaceHolder1$as1$btnGo1; action ./Search.aspx`,
      );

    // 3) POST the search.
    const headers = {
      "User-Agent": UA,
      "Content-Type": "application/x-www-form-urlencoded",
    };
    let result = await fetchText(sessUrl, {
      method: "POST",
      body: buildSearchForm(page),
      headers,
      cache: false,
    });
    if (!/wsResultsGrid|GridView1/.test(result))
      return blocked(
        `POST to ${sessUrl} returned no results grid (ctl00_ContentPlaceHolder1_WSExtendedGridNP1_GridView1). Posted txtSearch="${KEYWORD}" rdoType=EXACT dateRange=rbLastNumDays/${LAST_DAYS}.`,
      );

    // 4) Bump to 50/page via the grid's ddlPerPage postback (fewer round-trips).
    const pp =
      "ctl00$ContentPlaceHolder1$WSExtendedGridNP1$GridView1$ctl01$ddlPerPage";
    const sb =
      "ctl00$ContentPlaceHolder1$WSExtendedGridNP1$GridView1$ctl01$ddlSortBy";
    try {
      const wide = await fetchText(sessUrl, {
        method: "POST",
        headers,
        cache: false,
        body: buildSearchForm(result, {
          __EVENTTARGET: pp,
          [pp]: String(PER_PAGE),
          [sb]: "DatePublishedDate DESC",
          ctl00$ContentPlaceHolder1$as1$btnGo1: undefined, // drop the search submit
        }),
      });
      if (/wsResultsGrid|GridView1/.test(wide)) result = wide;
    } catch {}

    const pages = +(
      (result.match(/lblTotalPages">\s*of\s*([\d,]+)\s*Pages/) || [])[1] || "1"
    ).replace(/,/g, "");
    const leads = parseResults(result, sid);
    if (!leads.length)
      return {
        status: "partial",
        note: `Reached the grid (~${pages} pages of "${KEYWORD}", last ${LAST_DAYS}d) but parsed 0 rows — snippet markup may have changed. SID=${sid}.`,
        leads: [],
      };

    // 5) PAGINATE — walk every page (Next postback) to get ALL notices, not just
    // page 1. Dedupe by notice id and stop early if a page yields nothing new.
    const NEXT =
      "ctl00$ContentPlaceHolder1$WSExtendedGridNP1$GridView1$ctl01$btnNext";
    const seen = new Set(
      leads.map((l) => l.sourceUrl || l.caseNumber || l.owner),
    );
    const maxPages = Math.min(pages, MAX_PAGES);
    let cur = result;
    for (let p = 2; p <= maxPages; p++) {
      try {
        const nxt = await fetchText(sessUrl, {
          method: "POST",
          headers,
          cache: false,
          body: buildSearchForm(cur, {
            __EVENTTARGET: NEXT,
            [pp]: String(PER_PAGE),
            [sb]: "DatePublishedDate DESC",
            ctl00$ContentPlaceHolder1$as1$btnGo1: undefined,
          }),
        });
        if (!/wsResultsGrid|GridView1/.test(nxt)) break;
        const more = parseResults(nxt, sid).filter(
          (l) => !seen.has(l.sourceUrl || l.caseNumber || l.owner),
        );
        if (!more.length) break; // no new rows -> at the end (or Next didn't advance)
        more.forEach((l) => seen.add(l.sourceUrl || l.caseNumber || l.owner));
        leads.push(...more);
        cur = nxt;
      } catch {
        break;
      }
    }

    return {
      status: "ok",
      note: `${leads.length} foreclosure notices across ${Math.min(pages, maxPages)} of ~${pages} pages ("${KEYWORD}" exact, last ${LAST_DAYS}d). List fields only; street address + sale date are login-gated on Details.aspx.`,
      leads,
    };
  } catch (e) {
    return blocked(
      `Request failed: ${String(e.message || e)}. Endpoint: ${ORIGIN}/Search.aspx (cookieless session + WebForms postback).`,
    );
  }
}
