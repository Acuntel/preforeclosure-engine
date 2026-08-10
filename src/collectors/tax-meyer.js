// Joseph E. Meyer & Associates statewide tax-sale / RAMS portal (iltaxsale.com),
// the county tax agent for ~80 IL counties (incl. McHenry, Kane, Will of OUR
// target set; Winnebago/Boone/Lake are NOT Meyer counties).
//
// SIGNAL we want: the per-county DELINQUENT / tax-sale CATALOG — that list carries
// the delinquent OWNER NAME + PIN (a tax_delinquent distress stage). We probe the
// real live site to find that list.
//
// WHAT'S ACTUALLY THERE (verified live 2026-06-08):
//   • iltaxsale.com is a server-rendered CodeIgniter PHP site (jQuery only, no SPA,
//     no JSON/XHR API — the only dynamic endpoint is cmd.php?cmd=cart, a FoxyCart
//     shopping cart). Per-county pages live at /new/index.php/county/<Name>/<CODE>.
//   • The ONLY free downloadable data is the historical "Auction Results" PDFs at
//     /new/pdf/<CODE>/<CODE><MMYY>Results.pdf. Those are SURPLUS / trustee auctions
//     (county-forfeited parcels, mostly vacant lots): they list ITEM# / PARCEL# /
//     TOWNSHIP / COMMENTS / PRICE / STATUS — *** NO OWNER NAMES. ***
//   • The owner-bearing DELINQUENT CATALOG ("List of Assignable Certificates - $25",
//     and the bidding catalog) is sold/served via iltaxsalebids.com, which 302s
//     EVERY path to /Auction/Account/Login/ ("Sign in to Place Bids / View Your
//     Bids / Purchase Catalogs"). => login + registration + payment gated.
//
// So: no FREE source on this portal yields owner names. Per CONTRACT, that is an
// honest BLOCKED — we still hit the live site to prove the gate, and never fabricate.
import { fetchText } from "../http.js";

export const meta = {
  id: "tax-meyer",
  label: "Joseph E. Meyer & Assoc. — IL tax-sale catalog (iltaxsale.com)",
  source: "iltaxsale.com",
  kind: "trigger",
  // of OUR 6 TARGET counties, only these 3 are Meyer/RAMS counties on the portal.
  counties: ["McHenry", "Kane", "Will"],
  method: "http",
};

const BASE = "https://iltaxsale.com/new/index.php";
const REFERER = `${BASE}/`;
// county -> portal 3-letter code (from the homepage county links)
const COUNTY_CODE = { McHenry: "MCH", Kane: "KNE", Will: "WIL" };

function strip(html = "") {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Pull every Results PDF href off a county page (free, but owner-less surplus data).
function resultsPdfs(html, code) {
  const re = new RegExp(
    `href="(https?://[^"]*/pdf/${code}/[^"]*Results\\.pdf)"`,
    "gi",
  );
  const out = [];
  let m;
  while ((m = re.exec(html))) out.push(m[1]);
  return [...new Set(out)];
}

export async function collect() {
  const checked = [];
  let reachedAny = false;
  let freeResultsSeen = 0;
  let firstErr = null;

  // 1) Hit each target county's REAL portal page and inventory what it exposes.
  for (const [county, code] of Object.entries(COUNTY_CODE)) {
    const url = `${BASE}/county/${county}/${code}`;
    let html;
    try {
      // the portal 406s rapid bare hits — send a Referer like a browser.
      html = await fetchText(url, {
        headers: { Referer: REFERER },
        timeout: 25000,
      });
    } catch (e) {
      firstErr = firstErr || e;
      checked.push(`${county}: page fetch failed (${String(e.message || e)})`);
      continue;
    }
    reachedAny = true;
    const body = strip(html);
    const pdfs = resultsPdfs(html, code);
    freeResultsSeen += pdfs.length;
    // does the page route the owner-bearing catalog to the gated bids platform?
    const gated = /iltaxsalebids\.com/i.test(html) || /Add to Cart/i.test(body);
    const paidList = /List of Assignable Certificates\s*-\s*\$\d+/i.test(body);
    checked.push(
      `${county}: ${pdfs.length} free "Auction Results" PDF(s) ` +
        `(SURPLUS parcels, PIN+township, NO owner names); ` +
        `catalog ${gated ? "gated→iltaxsalebids.com login" : "n/a"}` +
        `${paidList ? "; assignable-cert list is $25 paid" : ""}.`,
    );
  }

  // 2) Confirm the catalog/owner-name path is login-gated by probing the bids site.
  let bidsGate = "not checked";
  try {
    const bids = await fetchText("https://iltaxsalebids.com/", {
      headers: { Referer: REFERER },
      timeout: 20000,
    });
    const t = strip(bids);
    if (/Account\/Login|Sign in to Place Bids|Register as a new user/i.test(t))
      bidsGate = "iltaxsalebids.com/Auction/Account/Login/ (login required)";
    else bidsGate = "iltaxsalebids.com reachable, no obvious login wall";
  } catch (e) {
    bidsGate = `bids site fetch failed (${String(e.message || e)})`;
  }

  // 3) Decide. The free Results PDFs carry NO owner names; the owner-bearing
  //    delinquent catalog is login+payment gated. => honest BLOCKED, no leads.
  if (!reachedAny) {
    return {
      status: "blocked",
      note:
        `Could not reach iltaxsale.com per-county pages (${BASE}/county/<Name>/<CODE>` +
        ` for ${Object.keys(COUNTY_CODE).join("/")}). First error: ` +
        `${String((firstErr && firstErr.message) || firstErr)}.`,
      leads: [],
    };
  }

  return {
    status: "blocked",
    note:
      `iltaxsale.com (Joseph E. Meyer & Assoc.) reached for ${meta.counties.join(
        "/",
      )}, but the OWNER-NAME tax-delinquent catalog is gated. ` +
      `Free "Auction Results" PDFs (/new/pdf/<CODE>/<CODE><MMYY>Results.pdf, ` +
      `${freeResultsSeen} found) are SURPLUS/trustee auctions = PIN+township only, ` +
      `NO owner names. The delinquent CATALOG / "List of Assignable Certificates ` +
      `($25)" is sold via ${bidsGate} (registration+payment). No FREE endpoint on ` +
      `this portal yields owner names, so no leads emitted (no fabrication). ` +
      `Per-county findings: ${checked.join(" ")}`,
    leads: [],
  };
}
