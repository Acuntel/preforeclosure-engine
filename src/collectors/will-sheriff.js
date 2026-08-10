// Will County Sheriff — upcoming judicial-foreclosure SALES.
// Public Joomla "com_fabrik" list, fully server-rendered HTML (no login, no JSON
// SPA). The list page (paginated via GET ?limitstart5=0/25/50/75/100, 25/page)
// gives case#, common address, city, sale date, opening bid + a data-rowid that
// links to /details/5/{id}. The detail page (also public HTML) adds ZIP, PIN,
// Plaintiff (lender), Defendant (owner), judgment amount/date, attorney firm.
//
// This is a SECOND/THIRD independent free confirm source for Will-county sales we
// already see in TJSC + Public Notice IL — cross-matched by CASE NUMBER + ADDRESS.
// caseNumber here is the chancery/FC number e.g. "22 FC 1275-0" (the engine
// canonicalizes "22FC1275"/"2022-FC-0001275" itself).
import { fetchText } from "../http.js";

export const meta = {
  id: "will-sheriff",
  label: "Will County Sheriff — upcoming foreclosure sales",
  source: "willcosheriff.org",
  kind: "trigger",
  counties: ["Will"],
  method: "http",
};

const BASE =
  "https://www.willcosheriff.org/foreclosures/index.php/upcoming-sales";
const PAGE_SIZE = 25;
const MAX_PAGES = 12; // safety cap (~300 sales); real list is ~5 pages
const MAX_DETAILS = 60; // bound detail fetches per run; rest keep list-only fields

function decode(s = "") {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

// strip tags + collapse whitespace
function clean(s = "") {
  return decode(s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ")).trim();
}

// "06-11-2026" (MM-DD-YYYY) -> "2026-06-11"
function isoDate(s) {
  const m = (s || "").match(/(\d{1,2})-(\d{1,2})-(\d{4})/);
  if (!m) return null;
  const [, mo, d, y] = m;
  return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
}

// "943167.78" / "$943,167.78" / "0.00" -> number | null (drops 0)
function money(s) {
  if (!s) return null;
  const v = String(s).replace(/[^0-9.]/g, "");
  if (!v) return null;
  const n = Math.round(parseFloat(v));
  return n > 0 ? n : null;
}

// Pull one fabrik list <td> cell value by its element-class suffix.
function listCell(row, suffix) {
  const re = new RegExp(
    `<td[^>]*attorneyentry___${suffix}\\b[^>]*>([\\s\\S]*?)</td>`,
    "i",
  );
  const m = row.match(re);
  return m ? clean(m[1]) : null;
}

// Pull a detail-page readonly value: <div ... id="attorneyentry___{field}_ro">VALUE</div>
function detailField(html, field) {
  const re = new RegExp(
    `id="attorneyentry___${field}_ro"[^>]*>([\\s\\S]*?)</div>`,
    "i",
  );
  const m = html.match(re);
  const v = m ? clean(m[1]) : null;
  return v || null;
}

// Split the list <tbody> into per-sale rows (each carries a data-rowid).
function parseList(html) {
  const tb = html.match(/<tbody[^>]*>([\s\S]*?)<\/tbody>/i);
  if (!tb) return [];
  const rows = tb[1].match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) || [];
  const out = [];
  for (const row of rows) {
    const idm = row.match(/data-rowid="(\d+)"/i);
    if (!idm) continue; // skips the hidden "No records" row
    const rowid = idm[1];
    const caseNumber = listCell(row, "CaseNumber");
    const address = listCell(row, "CommonAddress");
    const city = listCell(row, "City");
    const sale = isoDate(listCell(row, "SaleDate"));
    const openingBid = money(listCell(row, "OpeningBidAmount"));
    if (!caseNumber && !address) continue;
    out.push({
      rowid,
      caseNumber: caseNumber || null,
      address: address || null,
      city: city || null,
      sale,
      openingBid,
      sourceUrl: `${BASE}/details/5/${rowid}`,
    });
  }
  return out;
}

// Fetch a detail page and merge richer fields onto a list lead.
async function enrichDetail(lead) {
  try {
    const html = await fetchText(lead.sourceUrl, { timeout: 30000 });
    const zip =
      (detailField(html, "ZipCode") || "").match(/\d{5}/)?.[0] || null;
    const pin = detailField(html, "TaxID_PIN");
    const lender = detailField(html, "Plaintiff");
    const owner = detailField(html, "Defendant");
    const judgment = money(detailField(html, "JudgmentAmount"));
    const judgmentDate = isoDate(detailField(html, "JudgmentDate"));
    const attorney = detailField(html, "AttorneyFirm");
    const obAmt = money(detailField(html, "OpeningBidAmount"));
    return {
      zip,
      pin: pin || null,
      lender: lender || null,
      owner: owner || null,
      judgment: judgment ?? null,
      judgmentDate: judgmentDate || null,
      attorney: attorney || null,
      openingBid: obAmt ?? lead.openingBid ?? null,
    };
  } catch {
    return {};
  }
}

export async function collect() {
  // 1) Page through the public list until a page repeats / runs short / empties.
  const seen = new Set();
  const rows = [];
  let firstError = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const url = `${BASE}?limitstart5=${page * PAGE_SIZE}`;
    let html;
    try {
      html = await fetchText(url, { timeout: 30000 });
    } catch (e) {
      firstError = e;
      break;
    }
    const parsed = parseList(html);
    const fresh = parsed.filter((r) => !seen.has(r.rowid));
    if (!fresh.length) break; // no new rows -> past the end
    for (const r of fresh) {
      seen.add(r.rowid);
      rows.push(r);
    }
    if (parsed.length < PAGE_SIZE) break; // short page -> last page
  }

  if (!rows.length) {
    if (firstError) {
      return {
        status: "blocked",
        note: `Will County Sheriff list unreachable: ${String(
          firstError.message || firstError,
        )} (endpoint ${BASE}?limitstart5=0).`,
        leads: [],
      };
    }
    return {
      status: "blocked",
      note: `Fetched ${BASE} but parsed 0 sale rows — Joomla/com_fabrik markup may have changed (rows keyed on data-rowid; cells on class attorneyentry___CaseNumber/CommonAddress/City/SaleDate/OpeningBidAmount).`,
      leads: [],
    };
  }

  // 2) Enrich a bounded number of detail pages for PIN / parties / zip / judgment.
  let detailFailures = 0;
  const leads = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    let det = {};
    if (i < MAX_DETAILS) {
      det = await enrichDetail(r);
      if (det && Object.keys(det).length === 0) detailFailures++;
    }
    leads.push({
      county: "Will",
      address: r.address,
      city: r.city,
      zip: det.zip || null,
      owner: det.owner || null,
      caseNumber: r.caseNumber,
      court: "Circuit Court of Will County, Illinois (12th Judicial Circuit)",
      lender: det.lender || null,
      attorney: det.attorney || null,
      filing: null,
      judgment: det.judgment ?? null,
      judgmentDate: det.judgmentDate || null,
      pin: det.pin || null,
      sale: r.sale,
      openingBid: det.openingBid ?? r.openingBid ?? null,
      sourceUrl: r.sourceUrl,
    });
  }

  const enriched = Math.min(rows.length, MAX_DETAILS);
  const withCase = leads.filter((l) => l.caseNumber).length;
  const withParties = leads.filter((l) => l.owner || l.lender).length;
  const status =
    detailFailures > 0 && detailFailures === enriched ? "partial" : "ok";
  const note =
    `${leads.length} upcoming Will County sheriff foreclosure sale(s) from the public ` +
    `Joomla/com_fabrik list (${Math.ceil(rows.length / PAGE_SIZE)} page(s)); ` +
    `${withCase} have a case#, ${withParties} have plaintiff/defendant from ${enriched} detail page(s)` +
    `${detailFailures ? ` (${detailFailures} detail fetch(es) failed)` : ""}. ` +
    `Cross-confirms TJSC + Public Notice IL by case# + address.`;

  return { status, note, leads };
}
