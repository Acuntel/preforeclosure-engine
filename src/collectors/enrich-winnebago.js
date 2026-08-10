// Winnebago property enrichment via the Supervisor of Assessments "Parcel
// Details Inquiry" — a server-rendered ASP.NET WebForms app at
// https://assessor.wincoil.gov/search/ (free, no key, no login).
//
// Flow (all real HTTP, parsed with regex/string ops):
//   1. POST the search form (txtNumber/txtStreet/...) with captured __VIEWSTATE /
//      __EVENTVALIDATION -> results grid of PIN | location | owner, each linking
//      AssessmentRecord.aspx?PIN=<pin>. Match the row to the lead's house number.
//   2. POST __doPostBack('ddlYears') to AssessmentRecord.aspx?PIN=<pin> to load
//      the tax year -> owner, taxpayer (mailing), township, assessed values
//      (land/dwelling/total), class code, acres.
//   3. Best-effort: the record links each township assessor's PropertyDetail.aspx
//      (e.g. rockfordtownshipassessor.net) which carries the sales history + chars
//      (year built, sqft) the assessor ASPX itself omits. Never fatal.
//
// NOTE: the WinGIS ArcGIS layer (wingis.org) is token-gated (HTTP 499) — not used.
import { fetchText } from "../http.js";

export const meta = {
  id: "enrich-winnebago",
  label: "Winnebago — Supervisor of Assessments (Parcel Details Inquiry)",
  source: "assessor.wincoil.gov",
  kind: "enrich",
  counties: ["Winnebago"],
  method: "http",
};

const SEARCH = "https://assessor.wincoil.gov/search/";
const RECORD = "https://assessor.wincoil.gov/search/AssessmentRecord.aspx";
// prettier-ignore
const STREET_TYPES = new Set("ST AVE RD DR LN CT BLVD PL WAY TER CIR PKWY HWY TRL PT LOOP RUN ROW PIKE PASS XING".split(" "));
const DIRS = new Set("N S E W NE NW SE SW".split(" "));

const grabHidden = (html, name) => {
  const m = html.match(new RegExp(`name="${name}"[^>]*value="([^"]*)"`, "i"));
  return m ? m[1] : "";
};

// urlencode an object into an ASP.NET form body, preserving key order.
const form = (obj) =>
  Object.entries(obj)
    .map(([k, v]) => `${k}=${encodeURIComponent(v ?? "")}`)
    .join("&");

// the three ASP.NET hidden tokens, pulled from a rendered form.
const tokens = (html) => ({
  __VIEWSTATE: grabHidden(html, "__VIEWSTATE"),
  __VIEWSTATEGENERATOR: grabHidden(html, "__VIEWSTATEGENERATOR"),
  __EVENTVALIDATION: grabHidden(html, "__EVENTVALIDATION"),
});

const clean = (s) =>
  (s || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();

// "1030 N MAIN ST" -> { number, direction, street, suffix }
function splitAddress(addr) {
  const toks = String(addr || "")
    .trim()
    .toUpperCase()
    .replace(/[.,]/g, "")
    .split(/\s+/);
  let number = "";
  if (toks.length && /^\d+[A-Z]?$/.test(toks[0])) number = toks.shift();
  let direction = "";
  if (toks.length && DIRS.has(toks[0])) direction = toks.shift();
  let suffix = "";
  if (toks.length && STREET_TYPES.has(toks[toks.length - 1]))
    suffix = toks.pop();
  return { number, direction, street: toks.join(" ").slice(0, 15), suffix };
}

function toNum(s) {
  const n = Number(String(s || "").replace(/[$,\s]/g, ""));
  return Number.isFinite(n) && n !== 0 ? n : null;
}

// Resolve address -> { pin, loc, owner } by posting the search form.
async function resolvePin(addr) {
  const { number, direction, street, suffix } = splitAddress(addr);
  if (!street) return null;
  const page = await fetchText(SEARCH, { cache: false });
  const body = form({
    __LASTFOCUS: "",
    __EVENTTARGET: "",
    __EVENTARGUMENT: "",
    ...tokens(page),
    txtPin1: "",
    txtPin2: "",
    txtPin3: "",
    txtPin4: "",
    txtNumber: number,
    txtDirection: direction,
    txtStreet: street,
    txtSuffix: suffix,
    txtLName: "",
    txtFName: "",
    btnSubmit: "Submit",
  });
  const res = await fetchText(SEARCH, {
    method: "POST",
    cache: false,
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const gi = res.indexOf('id="grdList"');
  if (gi < 0) return null;
  const grid = res.slice(gi, res.indexOf("</table>", gi));
  const rows = grid.split("<tr").slice(1);
  const candidates = [];
  for (const row of rows) {
    const pin = (row.match(/PIN=([\d-]+)/) || [])[1];
    if (!pin) continue;
    const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((c) =>
      clean(c[1]),
    );
    const loc = cells[1] || "";
    candidates.push({ pin, loc, owner: cells[2] || "" });
  }
  if (!candidates.length) return null;
  // Prefer an exact house-number match; fall back to first result.
  if (number) {
    const exact = candidates.find((c) => c.loc.split(/\s+/)[0] === number);
    if (exact) return exact;
  }
  return candidates[0];
}

// Load AssessmentRecord for a PIN + year (a ddlYears postback). The dropdown only
// offers certified years, so clamp out-of-range years (a 2026 post 500s).
async function loadRecord(pin, year) {
  const url = `${RECORD}?PIN=${encodeURIComponent(pin)}`;
  const first = await fetchText(url, { cache: false });
  const years = [...first.matchAll(/<option[^>]*value="(\d{4})"/gi)].map((m) =>
    Number(m[1]),
  );
  let pick = Number(year);
  if (years.length && !years.includes(pick)) pick = Math.max(...years);
  const body = form({
    __EVENTTARGET: "ddlYears",
    __EVENTARGUMENT: "",
    __LASTFOCUS: "",
    ...tokens(first),
    ddlYears: String(pick),
  });
  return fetchText(url, {
    method: "POST",
    cache: false,
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
}

// Parse owner / mailing / site / assessed values out of the record HTML.
function parseRecord(html) {
  const lines = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, "\n")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/[ \t]+/g, " ")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  const at = (kw) => lines.findIndex((l) => l === kw || l.startsWith(kw));
  const out = {};

  // Identity block. The header row is Parcel# / AltParcel# / Location / Township,
  // but blank optional values collapse the value block, so anchor independently:
  // PIN = first nn-nn-nnn-nnn line; township = the value just before "Taxpayer".
  const pinLine = lines.find((l) => /^\d{2}-\d{2}-\d{3}-\d{3}$/.test(l));
  if (pinLine) out.pin = pinLine;
  const tp = at("Taxpayer");
  if (tp > 0) out.township = lines[tp - 1]; // last value in the identity block

  // Owner + mailing. After the "Owner" header the block repeats taxpayer then
  // owner: [0]=taxpayer name, [1]=owner name, [2]=tax street, [3]=owner street,
  // [4]=tax city/state/zip, [5]=owner city/state/zip. Mailing = street + csz.
  const oi = at("Owner");
  if (oi > -1) {
    const blk = lines.slice(oi + 1, oi + 7);
    if (blk[0]) out.owner = blk[0];
    const street = blk[2];
    const csz = blk[4];
    if (street && csz) out.mailing = `${street}, ${csz}`;
  }

  // Assessed values row: Land/Lot Dwelling FarmLand FarmBuilding Total CNST/DEM
  const ci = at("Current Available Assessed Value");
  if (ci > -1) {
    const land = toNum(lines[ci + 1]);
    const dwelling = toNum(lines[ci + 2]);
    const total = toNum(lines[ci + 5]);
    if (land != null) out.assessedLand = land;
    if (dwelling != null) out.assessedDwelling = dwelling;
    if (total != null) out.assessed = total;
  }
  const cc = at("Class Code:");
  if (cc > -1 && lines[cc + 1]) out.classCode = lines[cc + 1];
  const ac = at("Acres:");
  if (ac > -1) {
    const a = Number(lines[ac + 1]);
    if (Number.isFinite(a) && a > 0) out.acres = a;
  }
  const yr = at("Assessment year:");
  if (yr > -1 && /^\d{4}$/.test(lines[yr + 1] || ""))
    out.taxYear = Number(lines[yr + 1]);

  // Township-assessor detail link (has sales + structural data).
  const tl = html.match(/href="([^"]*PropertyDetail\.aspx[^"]*)"/i);
  if (tl) out._townshipUrl = tl[1].replace(/&amp;/g, "&");
  return out;
}

// Best-effort: township assessor detail page -> year built, sqft, last sale.
async function parseTownship(url) {
  const out = {};
  try {
    const html = await fetchText(url, {
      cache: false,
      retries: 1,
      timeout: 15000,
    });
    const lines = html
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<[^>]+>/g, "\n")
      .replace(/&nbsp;/g, " ")
      .replace(/[ \t]+/g, " ")
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    const after = (kw) => {
      const i = lines.findIndex((l) => l.startsWith(kw));
      return i > -1 ? lines[i + 1] : "";
    };
    const yb = Number(after("Year Built:"));
    if (Number.isFinite(yb) && yb > 1700) out.year = yb;
    const sf = toNum(after("Gross Building SF:"));
    if (sf) out.sqft = sf;
    // Sales history: rows of "MM/YYYY  TYPE  $amount". Take the most recent.
    const sales = [];
    for (let i = 0; i < lines.length; i++) {
      const dm = lines[i].match(/^(\d{2})\/(\d{4})$/);
      if (!dm) continue;
      const amt = lines
        .slice(i + 1, i + 4)
        .map(toNum)
        .find((n) => n != null);
      sales.push({ y: dm[2], m: dm[1], price: amt });
    }
    if (sales.length) {
      sales.sort((a, b) => `${b.y}${b.m}`.localeCompare(`${a.y}${a.m}`));
      const s = sales[0];
      out.lastSaleDate = `${s.y}-${s.m}-01`;
      if (s.price) out.lastSalePrice = s.price;
    }
  } catch {
    /* township site optional — assessor data already returned */
  }
  return out;
}

export async function enrich(lead = {}) {
  try {
    if (!/winnebago/i.test(lead.county || "")) return {};
    const year = lead.year || new Date().getFullYear();
    const hit = await resolvePin(lead.address || "");
    if (!hit) return {};
    // loadRecord clamps to the latest certified year offered by the dropdown.
    const html = await loadRecord(hit.pin, year);
    const rec = parseRecord(html);
    const townshipUrl = rec._townshipUrl;
    delete rec._townshipUrl;
    const fields = {
      pin: rec.pin || hit.pin,
      owner: rec.owner,
      mailing: rec.mailing,
      siteAddress: hit.loc || undefined, // from the search grid (always present)
      township: rec.township,
      classCode: rec.classCode,
      acres: rec.acres,
      assessed: rec.assessed,
      assessedLand: rec.assessedLand,
      assessedDwelling: rec.assessedDwelling,
      taxYear: rec.taxYear,
    };
    if (townshipUrl) Object.assign(fields, await parseTownship(townshipUrl));
    return Object.fromEntries(
      // drop undefined/empty keys
      Object.entries(fields).filter(([, v]) => v != null && v !== ""),
    );
  } catch (e) {
    console.error("[enrich-winnebago]", e.message);
    return {};
  }
}
