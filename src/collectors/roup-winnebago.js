// Roup.com — Winnebago County Sheriff foreclosure auctions.
// The site is server-rendered ASP.NET (NOT a JSON SPA, despite the brief). The
// public /Auctions page embeds every auction as an HTML card; there is no public
// JSON feed — the only $.ajax endpoints are /Auctions/SaveSearch and login, both
// gated. So we parse the public HTML (listing + per-auction detail pages). The
// detail pages carry the rich foreclosure fields (Court Case, Plaintiff/lender,
// Defendant/owner, Judgment Amount, Sale Start, Parcel ID) — all public, no login.
import { fetchText } from "../http.js";

export const meta = {
  id: "roup-winnebago",
  label: "Roup.com — Winnebago sheriff sales",
  source: "winnebagocountysheriff-il.roup.com",
  kind: "trigger",
  counties: ["Winnebago"],
  method: "http",
};

const BASE = "https://winnebagocountysheriff-il.roup.com";

const decode = (s = "") =>
  s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&ldquo;|&rdquo;/g, '"')
    .replace(/&rsquo;/g, "'")
    .trim();

const clean = (s = "") =>
  decode(s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " "));

// "$57,397.87" -> 57397.87 ; "" / "TBD" -> null
function money(s) {
  if (!s) return null;
  const m = String(s)
    .replace(/<[^>]+>/g, "")
    .match(/\$?\s*([\d,]+(?:\.\d+)?)/);
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

// "Mon 6/8/2026 10:00 AM CDT" or "6/8/2026 10:00 AM CDT" -> "2026-06-08"
function isoDate(s) {
  if (!s) return null;
  const m = clean(s).match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!m) return null;
  const [, mo, d, y] = m;
  return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
}

// Pull "<label ...>Name</label> <div> value </div>" off a detail page.
function field(html, label) {
  const re = new RegExp(
    `<label[^>]*>\\s*${label}\\s*</label>\\s*<div>([\\s\\S]*?)</div>`,
    "i",
  );
  const m = html.match(re);
  return m ? clean(m[1]) : null;
}

// Split each auction <div class="card shadow h-100"> ... block out of the list.
function splitCards(html) {
  const cards = [];
  const re = /class="card shadow h-100"/g;
  let m;
  const idxs = [];
  while ((m = re.exec(html))) idxs.push(m.index);
  for (let i = 0; i < idxs.length; i++) {
    cards.push(html.slice(idxs[i], idxs[i + 1] ?? html.length));
  }
  return cards;
}

function parseCard(card) {
  const link = card.match(/href="(https?:\/\/[^"]*\/Auctions\/(\d+)\/[^"]+)"/i);
  if (!link) return null;
  const sourceUrl = link[1];
  const auctionId = link[2];

  const status = (card.match(/<span class="badge[^"]*">([^<]+)<\/span>/i) ||
    [])[1]
    ?.trim()
    ?.toUpperCase();

  const title = (card.match(
    /<h5 class="card-title[^>]*>[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/i,
  ) || [])[1];
  const address = title ? decode(title.replace(/\s+/g, " ").trim()) : null;

  // city/state/zip live in the .text-muted block: <span>City</span><span>IL,</span><span>zip</span>
  const muted = (card.match(/fa-map-marker[\s\S]*?<\/div>/i) || [""])[0];
  const spans = [...muted.matchAll(/<span>([^<]+)<\/span>/g)].map((x) =>
    x[1].trim(),
  );
  const city = spans[0] ? decode(spans[0]) : null;
  const zip = (muted.match(/\b(\d{5})\b/) || [])[1] || null;

  const openingBid = money(
    (card.match(/Opening Bid<\/label>\s*<div>([\s\S]*?)<\/div>/i) || [])[1],
  );

  // footer: "Starts: 6/8/2026 ..." (upcoming) or "Ended: ..." (past)
  const footer = (card.match(/card-footer[\s\S]*?<\/div>/i) || [""])[0];
  const sale = isoDate(footer);

  return { auctionId, sourceUrl, status, address, city, zip, openingBid, sale };
}

async function enrichDetail(lead) {
  try {
    const html = await fetchText(lead.sourceUrl, { timeout: 30000 });
    const caseNumber = field(html, "Court Case");
    const court = field(html, "Court");
    const lender = field(html, "Plaintiff");
    const owner = field(html, "Defendant");
    const judgment = money(field(html, "Judgment Amount"));
    const obAmt = money(field(html, "Opening Bid Amount"));
    const start = field(html, "Start") || field(html, "End");
    const saleDate = isoDate(start);
    return {
      caseNumber: caseNumber || null,
      court: court || null,
      lender: lender || null,
      owner: owner || null,
      judgment: judgment ?? null,
      openingBid: obAmt ?? lead.openingBid ?? null,
      sale: saleDate || lead.sale || null,
    };
  } catch {
    return {};
  }
}

export async function collect() {
  let html;
  try {
    html = await fetchText(`${BASE}/Auctions`, { timeout: 30000 });
  } catch (e) {
    return {
      status: "blocked",
      note: `GET ${BASE}/Auctions failed: ${String(
        e.message || e,
      )}. Public auction list is HTML-rendered (no public JSON feed; only gated /Auctions/SaveSearch + login $.ajax exist).`,
      leads: [],
    };
  }

  const cards = splitCards(html);
  if (!cards.length) {
    return {
      status: "blocked",
      note: `Fetched ${BASE}/Auctions (${html.length}b) but found 0 auction cards — markup may have changed. Cards keyed on class "card shadow h-100"; address in h5.card-title, city/zip in .text-muted spans, status in .badge, date in .card-footer.`,
      leads: [],
    };
  }

  // Trigger = pre-foreclosure signal: keep UPCOMING (live) auctions only.
  const parsed = cards.map(parseCard).filter(Boolean);
  const upcoming = parsed.filter((c) => c.status === "UPCOMING");

  const leads = [];
  for (const c of upcoming) {
    const det = await enrichDetail(c);
    leads.push({
      county: "Winnebago",
      address: c.address,
      city: c.city,
      zip: c.zip,
      owner: det.owner || null,
      caseNumber: det.caseNumber || null,
      court:
        det.court || "Winnebago County Circuit Court (17th Judicial Circuit)",
      lender: det.lender || null,
      attorney: null,
      filing: null,
      judgment: det.judgment ?? null,
      sale: det.sale || c.sale || null,
      openingBid: det.openingBid ?? c.openingBid ?? null,
      status: "UPCOMING",
      sourceUrl: c.sourceUrl,
    });
  }

  if (!leads.length) {
    return {
      status: "ok",
      note: `Parsed ${parsed.length} Roup auctions; 0 currently UPCOMING (rest are SOLD/closed). No live Winnebago sheriff sales right now.`,
      leads: [],
    };
  }

  return {
    status: "ok",
    note: `${leads.length} upcoming Winnebago sheriff foreclosure sale(s) from public Roup.com listing + detail pages (of ${parsed.length} total auctions).`,
    leads,
  };
}
