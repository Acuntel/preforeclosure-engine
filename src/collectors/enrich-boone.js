// Boone County property enrichment via DEVNET wEdge (free public records).
// Flow (no CSRF, ASP.NET session cookie required):
//   1. GET /                         -> ASP.NET_SessionId cookie
//   2. POST /Search/ExecuteParcelSearch (form: street_name, community_name) -> 302
//      (stores the criteria in session; house_number_min/max filter is buggy
//       server-side, so we filter house number client-side instead)
//   3. POST /Search/Results          -> DataTables JSON (property_key + year + owner)
//   4. GET  /parcel/view/<PIN>/<year> -> detail HTML (label/value divs + tables)
// Returns owner, mailing + site address, PIN, tax, assessed, full sales history, township.
import { fetchText } from "../http.js";

const BASE = "https://booneil.devnetwedge.com";

export const meta = {
  id: "enrich-boone",
  label: "DEVNET wEdge — Boone parcel enrichment",
  source: "booneil.devnetwedge.com",
  kind: "enrich",
  counties: ["Boone"],
  method: "http",
};

// --- tiny HTML helpers ----------------------------------------------------
const strip = (s) =>
  s
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();

// Pull the value div that immediately follows an inner-label "<label>".
function labelValue(html, label) {
  const re = new RegExp(
    `inner-label["'][^>]*>\\s*${label}\\s*</div>\\s*<div class="inner-value[^"]*"[^>]*>([\\s\\S]*?)</div>`,
    "i",
  );
  const m = html.match(re);
  return m ? strip(m[1]) : null;
}

function num(s) {
  if (!s) return null;
  const n = Number(String(s).replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}

function isoDate(s) {
  if (!s) return null;
  const m = String(s).match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!m) return null;
  return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
}

// Grab a section table by its anchor id and return rows as cell-arrays. Clip
// to the panel: if the panel has no <table> (e.g. "No Sales History"), the
// search must NOT bleed into the next panel's table.
function tableRows(html, anchorId) {
  const start = html.search(new RegExp(`id="${anchorId}`));
  if (start < 0) return [];
  // next panel boundary (panels are <div ... class="...panel panel-info"> / id="...1">)
  const nextPanel = html
    .slice(start + 1)
    .search(/id="[A-Za-z]+\d+"\s+class="panel/);
  const limit = nextPanel < 0 ? html.length : start + 1 + nextPanel;
  const tableStart = html.indexOf("<table", start);
  if (tableStart < 0 || tableStart >= limit) return [];
  const tableEnd = html.indexOf("</table>", tableStart);
  if (tableEnd < 0) return [];
  const block = html.slice(tableStart, tableEnd);
  return [...block.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map((r) =>
    [...r[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((c) => strip(c[1])),
  );
}

// --- session search -------------------------------------------------------
function cookiesFrom(headers) {
  const sc = headers.getSetCookie ? headers.getSetCookie() : [];
  return sc.map((c) => c.split(";")[0]).filter(Boolean);
}

// Run a parcel search, returning the DataTables data array (we filter locally).
async function searchParcels(street, community) {
  // 1. session cookie
  const home = await fetch(BASE + "/", {
    headers: { "User-Agent": "Mozilla/5.0" },
  });
  let cookie = cookiesFrom(home.headers).join("; ");
  if (!cookie) cookie = "ASP.NET_SessionId=preforeclosure-engine";

  // 2. store criteria (street + community only; house number filtered client-side)
  await fetch(BASE + "/Search/ExecuteParcelSearch", {
    method: "POST",
    redirect: "manual",
    headers: {
      "User-Agent": "Mozilla/5.0",
      "Content-Type": "application/x-www-form-urlencoded",
      Cookie: cookie,
    },
    body: new URLSearchParams({
      search_tab: "parcel-search",
      street_name: street,
      community_name: community || "",
    }).toString(),
  });

  // 3. DataTables serverSide POST for the JSON rows
  const dt = new URLSearchParams({ draw: "1", start: "0", length: "500" });
  [
    "year",
    "property_key_masked",
    "full_names",
    "address",
    "property_type",
  ].forEach((d, i) => dt.set(`columns[${i}][data]`, d));
  dt.set("order[0][column]", "1");
  dt.set("order[0][dir]", "asc");
  dt.set("search[value]", "");
  const txt = await fetchText(BASE + "/Search/Results", {
    method: "POST",
    cache: false,
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Cookie: cookie,
      "X-Requested-With": "XMLHttpRequest",
    },
    body: dt.toString(),
  });
  return JSON.parse(txt).data || [];
}

// --- detail parse ---------------------------------------------------------
function parseDetail(html) {
  const out = {};
  out.pin = labelValue(html, "Parcel Number") || labelValue(html, "PIN");
  const ownerBlock = labelValue(html, "Owner Name &amp; Address");
  if (ownerBlock) out.owner = ownerBlock.split(/\d/)[0].trim() || ownerBlock;
  out.mailing = labelValue(html, "Mailing Address");
  out.siteAddress = labelValue(html, "Site Address");
  out.township = labelValue(html, "Township");

  // Assessed total: current-year Board of Review row (col index 6 = Total).
  const aRows = tableRows(html, "Assessments");
  for (const r of aRows) {
    if (/Board of Review$/.test(r[0]) && r[6]) {
      out.assessed = num(r[6]);
      break;
    }
  }
  if (out.assessed == null && aRows.length) out.assessed = num(aRows[0]?.[6]);

  // Tax: "Total" row of Billing & Collection, Tax Billed col (index 2).
  const bRows = tableRows(html, "Billing1");
  const totalRow = bRows.find((r) => /^Total$/i.test(r[0]));
  if (totalRow) out.tax = num(totalRow[2]);
  // Tax year = leading 4-digit year of the "Tax Year" value (e.g. "2025 (Payable 2026)").
  const tyRaw = labelValue(html, "Tax Year");
  const tyM = tyRaw && tyRaw.match(/\b(20\d{2})\b/);
  if (tyM) out.taxYear = Number(tyM[1]);

  // Full sales history (price + date), newest first.
  const sRows = tableRows(html, "SalesHistory1");
  const sales = [];
  for (const r of sRows) {
    if (r.length < 9) continue; // skip header / empty
    const date = isoDate(r[3]);
    const price = num(r[6]);
    if (!date && !price) continue;
    sales.push({
      date,
      price,
      type: r[2] || null,
      soldBy: r[4] || null,
      soldTo: r[5] || null,
    });
  }
  if (sales.length) {
    out.sales = sales;
    out.lastSaleDate = sales[0].date;
    out.lastSalePrice = sales[0].price;
  }
  return out;
}

// --- public enrich --------------------------------------------------------
export async function enrich(lead = {}) {
  try {
    const addr = String(lead.address || "").trim();
    const m = addr.match(/^(\d+[A-Za-z]?)\s+(.+)$/);
    if (!m) return {};
    const houseNumber = m[1].toUpperCase();
    // street name only (drop suffix words wEdge stores separately)
    const streetCore = m[2]
      .replace(
        /\b(AVE|AVENUE|ST|STREET|RD|ROAD|DR|DRIVE|LN|LANE|CT|COURT|BLVD|PL|PLACE|WAY|TER|TERRACE|HWY|PKWY|CIR|CIRCLE)\.?\b/gi,
        "",
      )
      .trim();
    const community = (lead.city || "Belvidere").toUpperCase();

    let rows = await searchParcels(streetCore.split(/\s+/)[0], community);
    if (!rows.length)
      rows = await searchParcels(streetCore.split(/\s+/)[0], "");
    if (!rows.length)
      return {
        status: "blocked",
        note: `wEdge /Search/Results returned 0 rows for street "${streetCore}" in ${community}; endpoint reachable (POST /Search/ExecuteParcelSearch -> /Search/Results JSON).`,
      };

    // match house number exactly, then loosely on street.
    let hit =
      rows.find(
        (r) =>
          r.house_number === houseNumber &&
          streetCore.toUpperCase().includes(r.street_name),
      ) || rows.find((r) => r.house_number === houseNumber);
    if (!hit)
      return {
        status: "blocked",
        note: `No parcel matches ${houseNumber} ${streetCore} in ${community}. wEdge had ${rows.length} ${streetCore} rows (e.g. ${rows
          .slice(0, 3)
          .map((r) => r.house_number)
          .join(",")}).`,
      };

    const detailUrl = `${BASE}/parcel/view/${hit.property_key}/${hit.year}`;
    const html = await fetchText(detailUrl, { cache: true });
    const fields = parseDetail(html);
    return {
      county: "Boone",
      owner: hit.full_names
        ? hit.full_names.replace(/,\s*$/, "")
        : fields.owner,
      ...fields,
      sourceUrl: detailUrl,
    };
  } catch (e) {
    return { status: "blocked", note: `enrich-boone error: ${e.message}` };
  }
}
