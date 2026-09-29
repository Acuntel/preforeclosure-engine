// Probate / dead-owner leads from Public Notice Illinois "claims notice" filings.
// Replaces the Daily Herald scrape (Cloudflare-blocked since about 09-10): PNI
// carries the same DuPage claims notices (DuPage County Daily Herald, Suburban
// Life, Chronicle) and works from Railway. The free result snippet is truncated
// near 350 chars, but it holds the decedent, the PR case# and, in the Daily
// Herald layout, the decedent's street + city ("death of Patricia M. Cerami, 347
// Galway Court, Bloomingdale, IL 601..."). Details.aspx is login-gated, so the
// snippet is all we parse. Search mechanics live in probate-pni-search.js (copied
// from public-notice-il.js, which exports only collect).
//
// Every pass re-runs the search and returns every parsed estate (no _seen skip).
// A failed pass serves the last good result as "partial"; with none, "blocked".
import { readFileSync } from "node:fs";
import { clean, searchNotices } from "./probate-pni-search.js";

export const meta = {
  id: "probate-pni",
  label: "Public Notice Illinois - probate claims notices (estates)",
  source: "publicnoticeillinois.com",
  kind: "trigger",
  counties: ["DuPage", "Cook", "Lake", "Will", "Kane", "McHenry"],
  method: "http",
};

const KEYWORD = process.env.PROBATE_PNI_KEYWORD || "claims notice";
const LAST_DAYS = Number(process.env.PROBATE_PNI_DAYS || 45);
const MAX_PAGES = 20;
const CACHE_MAX_AGE = 24 * 3600e3;
let _last = null; // { ts, leads } from the last good pass

const GEO = JSON.parse(
  readFileSync(new URL("../data/il-geo.json", import.meta.url), "utf8"),
);
// prettier-ignore
const COUNTY_NAME = { DUPAGE: "DuPage", MCHENRY: "McHenry", MCLEAN: "McLean", MCDONOUGH: "McDonough", DEKALB: "DeKalb", LASALLE: "LaSalle", "ST. CLAIR": "St. Clair", "DE WITT": "De Witt", "JO DAVIESS": "Jo Daviess", "ROCK ISLAND": "Rock Island" };
const COUNTY_KEYS = Object.keys(GEO.counties).sort(
  (a, b) => b.length - a.length,
);
const titleCase = (s) =>
  String(s || "")
    .toLowerCase()
    .replace(/(^|[\s(-])([a-z])/g, (m, p, c) => p + c.toUpperCase());
const countyName = (k) => COUNTY_NAME[k] || titleCase(k);

// Newspaper line-break hyphens: "Blooming- dale" -> "Bloomingdale".
const dehyphen = (s) => s.replace(/([A-Za-z])- ([A-Za-z])/g, "$1$2");

// "Du Page"/"DUPAGEIN THE" glue -> canonical county, earliest mention wins.
export function parseCounty(text) {
  const t = String(text || "")
    .toUpperCase()
    .replace(/\bDU\s+PAGE/g, "DUPAGE")
    .replace(/\bMC\s+(HENRY|LEAN|DONOUGH)/g, "MC$1")
    .replace(/\bLA\s+SALLE/g, "LASALLE")
    .replace(/\bDE\s+KALB/g, "DEKALB")
    .replace(/\b(?:ST\.?|SAINT)\s+CLAIR/g, "ST. CLAIR");
  let best = null;
  for (const k of COUNTY_KEYS) {
    const esc = k.replace(/[.]/g, "\\.");
    const re = new RegExp(`COUNTY\\s*OF\\s*${esc}|\\b${esc}\\s+COUNTY\\b`);
    const m = re.exec(t);
    if (m && (!best || m.index < best.i)) best = { i: m.index, k };
  }
  return best ? countyName(best.k) : null;
}

// "2026PR000566" / "2026 PR 548" / "26-PR-296" / Cook "2024P008117" -> canonical
export function normProbateCase(text) {
  const m = String(text || "").match(
    /\b(\d{4}|\d{2})\s*-?\s*(PR|P)\s*-?\s*(\d{1,7})(?!\d)/i,
  );
  if (!m) return null;
  const y = m[1].length === 2 ? "20" + m[1] : m[1];
  const seq = String(parseInt(m[3], 10)).padStart(6, "0");
  return `${y}${m[2].toUpperCase()}${seq}`;
}

function lev(a, b) {
  const d = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = d[0];
    d[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const t = d[j];
      d[j] = Math.min(
        d[j] + 1,
        d[j - 1] + 1,
        prev + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      prev = t;
    }
  }
  return d[b.length];
}
// Known IL city (or a 1-2 letter typo of one, "Bloomingalde"), else null.
function knownCity(raw) {
  const c = String(raw || "")
    .toUpperCase()
    .replace(/\./g, "")
    .trim();
  if (!c) return null;
  if (GEO.cities[c]) return c;
  if (c.length < 6) return null;
  let best = null;
  for (const k of Object.keys(GEO.cities)) {
    if (k[0] !== c[0] || Math.abs(k.length - c.length) > 2) continue;
    const d = lev(c, k);
    if (d <= 2 && (!best || d < best.d)) best = { k, d };
  }
  return best ? best.k : null;
}

const UNIT_RE =
  /^(?:(?:Unit|Apt|Apartment|Suite|Ste)\.?\s*#?\s*|#\s*)?([A-Z]?\d{1,5}[A-Z]?|[A-Z])$/i;
const STATE_RE = /^I(?:L|l|llinois|llinoi|llino|llin|lli|ll)?\.?\b|^\d{3,5}$/;

// The part after the decedent's name -> { address, city, zip } (all or nothing
// on the street: a street cut off by the snippet end is not emitted).
export function parseDecedentAddress(rest) {
  const s = String(rest || "").replace(/\s*\.\.\.\s*click.*$/i, "");
  const parts = s.split(/\s*,\s*/);
  if (parts.length < 2 || !/^\d{1,6}[A-Z]?\s+\S+/i.test(parts[0])) return {};
  let street = parts[0].replace(/\./g, "").trim();
  let i = 1;
  while (i < parts.length && UNIT_RE.test(parts[i])) {
    street += ` Unit ${parts[i].match(UNIT_RE)[1].toUpperCase()}`;
    i++;
  }
  street = street.replace(/\s+#\s*(\w+)$/, " Unit $1");
  const cityRaw = (parts[i] || "")
    .replace(/\s+(?:IL|Illinois)\b.*$/i, "")
    .trim();
  const next =
    parts[i + 1] || (parts[i] || "").replace(/^.*?\s(?=IL\b|Illinois\b)/i, "");
  const confirmed =
    parts.length > i + 1 || /\s(?:IL|Illinois)\b/i.test(parts[i] || "");
  const city =
    knownCity(cityRaw) ||
    (confirmed && STATE_RE.test(next) && cityRaw
      ? cityRaw.toUpperCase()
      : null);
  const zip = (s.match(/\b(?:IL|Illinois)\.?\s*(\d{5})\b/i) || [])[1] || null;
  return {
    address: titleCase(street),
    city: city ? titleCase(city) : null,
    zip,
  };
}

// Strip case numbers, "No.", ")" and ", a.k.a. ..." glued onto a caption name.
function cleanName(n) {
  return clean(n || "")
    .replace(/^(?:the\s+)?estate\s+of:?\s*/i, "")
    .replace(/\bNo\.?\s*(?=\d)/gi, "")
    .replace(/\b\d{2,4}\s*-?\s*PR?\s*-?\s*\d+/gi, "")
    .replace(/[()]/g, " ")
    .replace(/,\s*(?:a\.?k\.?a\.?|f\.?k\.?a\.?|n\.?k\.?a\.?)\b.*$/i, "")
    .replace(/[\s,]+$/, "")
    .replace(/^[\s,]+/, "")
    .replace(/\s+/g, " ")
    .trim();
}

// One snippet -> lead fields (null when it is not an estate notice).
export function parseProbateSnippet(raw) {
  const raw0 = clean(raw);
  const t = dehyphen(raw0);
  if (!/estate\s+of|death\s+of/i.test(t)) return null;
  const county = parseCounty(raw0) || parseCounty(t);
  const caseNumber = normProbateCase(t);
  const byEstate = (t.match(
    /(?:estate|matter)\s+of:?\s*\)?\s*(.+?)\s*,?\s*\)?\s*,?\s*deceased\b/i,
  ) || [])[1];
  const byDeath = (t.match(
    /death\s+of\s+(.+?)(?:,|\.\s+(?:Letters|The|Notice|Claims)\b|\s+whose|\s+who|\s+on\s|\s+of\s)/i,
  ) || [])[1];
  const decedent = [byEstate, byDeath]
    .map(cleanName)
    .find((n) => n && n.length <= 60 && !/said decedent|above/i.test(n));
  let addr = {};
  const tail = t.match(
    /death\s+of\s+(?:(?!\s(?:on|who|died)\s)[^,\d]){3,80}?(?:,\s*|\s+)(?:(?:whose\s+(?:last\s+)?(?:known\s+)?(?:residence|address)\s+(?:was|is)|formerly\s+of|late\s+of|of|residing\s+at)[:,]?\s+(?:at\s+)?)?(\d{1,6}[A-Z]?\s.*)$/i,
  );
  if (tail) addr = parseDecedentAddress(tail[1]);
  const heir =
    (t.match(
      /issued\b.{0,60}?\bto:?\s+([A-Z][A-Za-z.' -]{3,60}?)(?:\s*,|\s+of\s)/,
    ) || [])[1] ||
    (t.match(
      /representative of the estate is\s+([A-Z][A-Za-z.' -]{3,60}?)\s*,/i,
    ) || [])[1];
  const heirName = heir && /\S+\s+\S+/.test(heir) ? clean(heir) : null;
  if (!decedent && !caseNumber) return null;
  return {
    county,
    address: addr.address || null,
    city: addr.city || null,
    zip: addr.zip || null,
    decedent: decedent || null,
    owner: decedent ? `ESTATE OF ${decedent.toUpperCase()}` : null,
    heirName,
    caseNumber,
    court: county ? `Circuit Court of ${county} County, Probate` : null,
  };
}

// Many estates are published 3x across several papers: merge by county+case#
// (else county+decedent), keeping the richest fields and the FIRST publication.
export function toLeads(rows) {
  const by = new Map();
  for (const r of rows) {
    const f = parseProbateSnippet(r.snippet);
    if (!f) continue;
    const key = `${f.county}|${f.caseNumber || f.decedent}`.toUpperCase();
    const prev = by.get(key);
    const lead = {
      ...f,
      attorney: null,
      filing: null,
      judgment: null,
      sale: null,
      openingBid: null,
      signal: "probate",
      distress: "probate",
      stage: "probate",
      published: r.published,
      publication: r.publication,
      notices: 1,
      sourceUrl: r.url,
    };
    if (!prev) {
      by.set(key, lead);
      continue;
    }
    prev.notices++;
    for (const k of [
      "address",
      "city",
      "zip",
      "decedent",
      "owner",
      "heirName",
      "caseNumber",
    ])
      if (!prev[k] && lead[k]) prev[k] = lead[k];
    if (lead.published && (!prev.published || lead.published < prev.published))
      prev.published = lead.published;
  }
  return [...by.values()];
}

export async function collect() {
  let res;
  try {
    res = await searchNotices({
      keyword: KEYWORD,
      days: LAST_DAYS,
      maxPages: MAX_PAGES,
    });
  } catch (e) {
    const why = String(e.message || e);
    if (_last && Date.now() - _last.ts < CACHE_MAX_AGE)
      return {
        status: "partial",
        note: `Search failed (${why}); serving ${_last.leads.length} estates from the last good pass.`,
        leads: _last.leads,
      };
    return {
      status: "blocked",
      note: `Public Notice Illinois probate search failed: ${why}.`,
      leads: [],
    };
  }
  const leads = toLeads(res.rows);
  if (!leads.length)
    return {
      status: res.rows.length ? "partial" : "blocked",
      note: `"${KEYWORD}" search returned ${res.rows.length} notices but 0 parsed estates.`,
      leads: [],
    };
  const dupage = leads.filter((l) => l.county === "DuPage");
  const note =
    `${leads.length} estates from ${res.rows.length} "${KEYWORD}" notices (last ${LAST_DAYS}d, ${res.pages} pages); ` +
    `${dupage.length} DuPage estates (${dupage.filter((l) => l.address).length} with the decedent's address), ` +
    `${leads.filter((l) => l.address).length} with an address overall.`;
  _last = { ts: Date.now(), leads };
  return { status: "ok", note, leads };
}
