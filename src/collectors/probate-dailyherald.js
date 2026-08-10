// Probate / dead-owner leads — Vince's #1 signal ("buy leads from dead people;
// heirs who inherit a house they don't want just want the money"). Daily Herald
// publishes IL suburban probate CLAIM notices as free, plain HTML (no login, no
// captcha) covering DuPage, Lake, Kane, McHenry + suburban/west Cook.
//
// Each notice hands us, for FREE, in one place:
//   - the DECEDENT + their property address ("whose address was <addr>")  = the house
//   - the ADMINISTRATOR/heir + mailing address ("to <name> of the address of <addr>") = the contact
//   - case# (20XX PR ####), letters date, attorney
// (verified live against a real McHenry 2026 PR 34 notice.)
import { fetchText } from "../http.js";

export const meta = {
  id: "probate-dailyherald",
  label: "Daily Herald — probate / deceased-owner estates",
  source: "marketplace.dailyherald.com",
  kind: "trigger",
  counties: ["DuPage", "Lake", "Kane", "McHenry", "Cook", "Will"],
  method: "http",
};

const BASE = "https://marketplace.dailyherald.com";
const INDEX = `${BASE}/il/probate/search`;
const MAX_PAGES = Number(process.env.PROBATE_PAGES || 3);

const _seen = new Map(); // id -> ts, so a monitor re-parses each notice once
const SEEN_TTL = 12 * 3600e3;

const clean = (s) =>
  String(s || "")
    .replace(/â&#x80;\S*/g, "-") // mangled em-dash
    .replace(/[ Â]/g, " ") // mangled non-breaking space
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();

// known IL metro/collar counties (+ a few neighbors) so the court-county parse
// never returns "Illinois"/"United States"; city→county fallback fills the rest.
const IL_COUNTIES = [
  "Cook",
  "DuPage",
  "Lake",
  "Will",
  "Kane",
  "McHenry",
  "Winnebago",
  "Kendall",
  "DeKalb",
  "Boone",
  "Grundy",
  "Kankakee",
];
const CITY_COUNTY = {
  ELMHURST: "DuPage",
  NAPERVILLE: "DuPage",
  "VILLA PARK": "DuPage",
  WHEATON: "DuPage",
  "DOWNERS GROVE": "DuPage",
  BERKELEY: "Cook",
  HILLSIDE: "Cook",
  NORTHLAKE: "Cook",
  BELLWOOD: "Cook",
  MAYWOOD: "Cook",
  MCHENRY: "McHenry",
  WOODSTOCK: "McHenry",
  WAUKEGAN: "Lake",
  JOLIET: "Will",
  AURORA: "Kane",
  ELGIN: "Kane",
  ROCKFORD: "Winnebago",
};
function pickCounty(text, city) {
  for (const c of IL_COUNTIES)
    if (new RegExp(`\\b${c}\\s+COUNTY\\b`, "i").test(text)) return c;
  if (city) return CITY_COUNTY[city.toUpperCase()] || null;
  return null;
}

// "4518 Spruce Lane, McHenry, IL" / "...IL 60098" -> {address, city, zip}
function splitAddr(raw) {
  const s = clean(raw).replace(/\.$/, "");
  const m = s.match(/^(.+?),\s*([A-Za-z .]+?),\s*(?:IL|Illinois)\s*(\d{5})?/i);
  if (!m) return { address: s || null, city: null, zip: null };
  return { address: m[1].trim(), city: m[2].trim(), zip: m[3] || null };
}

function bodyText(html) {
  const noTags = html
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ");
  const m = noTags.match(/Listed\s+\d+\s+\w+\s+ago(.{150,4000})/i);
  return m ? m[1] : noTags;
}

// Parse one notice into a probate lead, or null if it isn't an estate notice.
function parseNotice(html, url) {
  const t = bodyText(html);
  if (
    !/estate of|claims against the estate|letters (of office|testamentary)/i.test(
      t,
    )
  )
    return null;

  const decedent = clean(
    (t.match(/estate of:?\s*([^,]+?),?\s+deceased/i) || [])[1] ||
      (t.match(/death of\s+([^,]+?),?\s+whose/i) || [])[1],
  );
  // the decedent's own address = the property to buy. The address block runs from
  // "address was" up to the next sentence ("... Letters were issued", "... The
  // estate", or a bare period), so capture the whole street/city/state[/zip].
  const addrRaw =
    (t.match(
      /(?:whose|last known|last)\s*(?:place of )?(?:residence|address)\s+was[:,]?\s+(.+?)(?:\.\s+(?:Letters|The|Notice|Claims|An?\b)|\.\s*$)/i,
    ) || [])[1] ||
    (t.match(/(?:residing|resided)\s+at\s+(.+?)(?:\.\s|,?\s+(?:at|and)\b)/i) ||
      [])[1];
  const prop = splitAddr(addrRaw);
  const caseNumber = clean((t.match(/\b(20\d{2}\s*PR\s*\d{1,6})\b/i) || [])[1]);
  // administrator/executor (the heir contact) + their mailing address
  const rep = t.match(
    /issued.{0,40}?to\s+(.+?)\s+of the address of\s+(.+?)\s+as\s+(?:independent\s+)?(?:administrator|executor|representative)/i,
  );
  const heirName = rep ? clean(rep[1]) : null;
  const heirMailing = rep ? clean(rep[2]) : null;
  const attorney = clean(
    (t.match(/whose attorney is\s+(.+?)(?:\.|notice is hereby)/i) || [])[1],
  );
  const letters = clean(
    (t.match(
      /letters (?:of office|testamentary)?\s*were issued on\s+([A-Za-z]+ \d{1,2},? \d{4})/i,
    ) || [])[1],
  );

  if (!decedent && !prop.address) return null;
  const county = pickCounty(t, prop.city);
  const filingIso = letters ? isoDate(letters) : null;
  return {
    county,
    address: prop.address,
    city: prop.city,
    zip: prop.zip,
    owner: decedent || null, // record owner = the deceased (assessor match)
    heirName, // the actual person to contact
    heirMailing, // direct-mail target
    attorney: attorney || null,
    caseNumber: caseNumber || null,
    filing: filingIso,
    signal: "probate",
    stage: "probate",
    sourceUrl: url,
  };
}

function isoDate(s) {
  const d = new Date(s);
  return isNaN(d) ? null : d.toISOString().slice(0, 10);
}

export async function collect() {
  const links = new Set();
  for (let p = 1; p <= MAX_PAGES; p++) {
    let html;
    try {
      html = await fetchText(p === 1 ? INDEX : `${INDEX}?p=${p}`);
    } catch {
      break;
    }
    const found = html.match(/\/il\/probate\/[^"']+\/[A-Za-z0-9]{6,}/g) || [];
    const before = links.size;
    for (const l of found) links.add(l.split("#")[0]);
    if (links.size === before) break; // no new links → end of feed
  }

  const leads = [];
  let scanned = 0;
  for (const link of links) {
    const id = link.split("/").pop();
    const hit = _seen.get(id);
    if (hit && Date.now() - hit < SEEN_TTL) continue;
    _seen.set(id, Date.now());
    let html;
    try {
      html = await fetchText(BASE + link);
    } catch {
      continue;
    }
    scanned++;
    const lead = parseNotice(html, BASE + link);
    if (lead) leads.push(lead);
  }
  return {
    status: "ok",
    note: `${leads.length} probate estates (${scanned} notices scanned, ${links.size} in feed)`,
    leads,
  };
}
