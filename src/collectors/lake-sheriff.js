// Lake County, IL Sheriff foreclosure sales — CivilView / RealAuction (salesweb.civilview.com).
// countyId=58 is Lake County, ILLINOIS (verified: page title "Lake County, IL - Foreclosure Sale";
// rows are IL cities Waukegan/Gurnee/Mundelein with IL zips). Server-rendered HTML table, no login.
//
// Flow: GET the SalesSearch list page (server issues ASP.NET_SessionId + AWSALB stickiness cookies),
// parse the Sheriff# | Sales Date | Plaintiff | Defendant | Address columns, then fetch a bounded
// number of /Sales/SaleDetails?PropertyId=<id> pages (which REQUIRE that session cookie — a fresh
// request 302s to an aspxerrorpath) to pull the Court Case # (e.g. "22FC751"), PIN, full address,
// attorney, and Plaintiff Opening Bid. caseNumber (our #1 cross-confirm key) only lives on detail.
import { fetchText, USER_AGENT } from "../http.js";

export const meta = {
  id: "lake-sheriff",
  label: "Lake County Sheriff — CivilView foreclosure sales",
  source: "salesweb.civilview.com",
  kind: "trigger",
  counties: ["Lake"],
  method: "http",
};

const BASE = "https://salesweb.civilview.com";
const LIST_URL = `${BASE}/Sales/SalesSearch?countyId=58`;
// caseNumber + the clean street/city/zip ONLY exist on the detail page, and it is
// our #1 cross-confirm key — so fetch a detail for every row (cached by http.js).
const DETAIL_CAP = 400;

const decode = (s) =>
  (s || "")
    .replace(/&amp;/g, "&")
    .replace(/&colon;/g, ":")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();

// "6/9/2026" -> "2026-06-09"
function toISO(d) {
  const m = (d || "").match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!m) return null;
  return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
}

// "$138,649.06" -> 138649.06 ; "" -> null
function toBid(s) {
  const t = (s || "").replace(/[^0-9.]/g, "");
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// "29583 N GOSSELL ROAD WAUCONDA IL 60084" -> {address, city, zip}
// Split an address blob into {address (street only), city, zip}.
// Detail pages give "STREET|CITY IL ZIP" ("|" = the original <br/>); list rows
// give one flat "STREET CITY IL ZIP" line. Prefer the "|" boundary when present.
const cityZip = (s) => {
  const m = (s || "").match(/^(.*?)\s+IL\s+(\d{5})(?:-\d{4})?\s*$/);
  return m ? { city: m[1].trim(), zip: m[2] } : { city: null, zip: null };
};
function splitAddress(full) {
  const raw = decode(full);
  const out = { address: null, city: null, zip: null };
  if (!raw) return out;
  if (raw.includes("|")) {
    const parts = raw.split("|").map((p) => p.trim());
    out.address = parts[0].replace(/\s+/g, " ").trim() || null;
    const cz = cityZip(parts.slice(1).join(" "));
    out.city = cz.city;
    out.zip = cz.zip;
    return out;
  }
  // flat list line: street is everything before " <CITY> IL <ZIP>".
  const tail = raw.match(
    /^(.*?)\s+([A-Z][A-Za-z .'-]+?)\s+IL\s+(\d{5})(?:-\d{4})?\s*$/,
  );
  if (tail) {
    out.address = tail[1].trim();
    out.city = tail[2].trim();
    out.zip = tail[3];
  } else {
    out.address = raw;
  }
  return out;
}

const VALUE_RE = (label) =>
  new RegExp(
    `sale-detail-label">\\s*${label}[^<]*</div>\\s*<div class="sale-detail-value">([\\s\\S]*?)</div>`,
    "i",
  );

function detailValue(html, label) {
  const m = html.match(VALUE_RE(label));
  if (!m) return "";
  // address value wraps an <a ...>STREET<br/>CITY ST ZIP</a>; keep the <br/>
  // as "|" so splitAddress can use the real street/city line boundary.
  let v = m[1].replace(/<br\s*\/?>/gi, "|").replace(/<[^>]+>/g, " ");
  return decode(v);
}

// Establish a session: hit the list page with a raw fetch so we can read Set-Cookie,
// then return both the list HTML and the cookie string for detail requests.
async function openSession() {
  const res = await fetch(LIST_URL, {
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "text/html,application/xhtml+xml,*/*",
    },
  });
  const html = await res.text();
  if (!res.ok) throw new Error(`list HTTP ${res.status}`);
  const raw =
    typeof res.headers.getSetCookie === "function"
      ? res.headers.getSetCookie()
      : [res.headers.get("set-cookie")].filter(Boolean);
  const cookie = raw
    .map((c) => (c || "").split(";")[0])
    .filter(Boolean)
    .join("; ");
  return { html, cookie };
}

// Parse the list table -> [{propertyId, sheriff, saleDate, plaintiff, defendant, address}]
function parseList(html) {
  const rows = [];
  // each row: a "View Details" link then five <td>s (the first <td> is the hidden-print link cell)
  const re =
    /PropertyId=(\d+)[\s\S]*?<td>([\s\S]*?)<\/td>\s*<td>([\s\S]*?)<\/td>\s*<td>([\s\S]*?)<\/td>\s*<td>([\s\S]*?)<\/td>\s*<td>([\s\S]*?)<\/td>/g;
  let m;
  while ((m = re.exec(html))) {
    rows.push({
      propertyId: m[1],
      sheriff: decode(m[2]),
      saleDate: decode(m[3]),
      plaintiff: decode(m[4]),
      defendant: decode(m[5]),
      address: decode(m[6]),
    });
  }
  return rows;
}

export async function collect() {
  let session;
  try {
    session = await openSession();
  } catch (e) {
    return {
      status: "blocked",
      note: `Lake CivilView list unreachable: ${e.message}`,
      leads: [],
    };
  }

  const rows = parseList(session.html);
  if (!rows.length) {
    return {
      status: "blocked",
      note: "Lake CivilView list returned 0 parseable rows (layout changed?)",
      leads: [],
    };
  }

  const leads = [];
  let enriched = 0;
  let detailFails = 0;

  for (const r of rows) {
    const a = splitAddress(r.address);
    const lead = {
      county: "Lake",
      address: a.address,
      city: a.city,
      zip: a.zip,
      owner: r.defendant || null,
      caseNumber: null,
      lender: r.plaintiff || null,
      court: "19th Judicial Circuit, Lake County",
      sale: toISO(r.saleDate),
      openingBid: null,
      sourceUrl: `${BASE}/Sales/SaleDetails?PropertyId=${r.propertyId}`,
    };

    if (enriched < DETAIL_CAP) {
      try {
        const dhtml = await fetchText(lead.sourceUrl, {
          headers: {
            Cookie: session.cookie,
            Referer: LIST_URL,
            Accept: "text/html,application/xhtml+xml,*/*",
          },
        });
        if (/sale-detail-label/.test(dhtml)) {
          const caseNo = detailValue(dhtml, "Court Case #");
          if (caseNo) lead.caseNumber = caseNo;
          const da = detailValue(dhtml, "Address");
          if (da) {
            const s = splitAddress(da);
            lead.address = s.address || lead.address;
            lead.city = s.city || lead.city;
            lead.zip = s.zip || lead.zip;
          }
          const att = detailValue(dhtml, "Attorney");
          if (att) lead.attorney = att;
          const pin = detailValue(dhtml, "Pin#");
          if (pin) lead.pin = pin;
          const bid = toBid(detailValue(dhtml, "Plaintiff Opening Bid"));
          if (bid != null) lead.openingBid = bid;
          enriched++;
        } else {
          detailFails++;
        }
      } catch {
        detailFails++;
      }
    }

    leads.push(lead);
  }

  const withCase = leads.filter((l) => l.caseNumber).length;
  const status = withCase ? "ok" : detailFails ? "partial" : "ok";
  return {
    status,
    note: `Lake CivilView: ${leads.length} sales, ${withCase} with case# (${enriched} detail pages fetched, ${detailFails} detail fails)`,
    leads,
  };
}
