// Winnebago County Recorder — Fidlar "Direct Search" (Laredo-Anywhere backend).
// EARLIEST foreclosure signal + OWNER NAME: a recorded LIS PENDENS / NOTICE OF
// FORECLOSURE is the lender's filing, months ahead of any sheriff sale, and it
// carries the homeowner's (defendant/grantor) NAME.
//
// LIVE SOURCE FACTS (confirmed by fetching the real endpoints 2026-06-08):
//   SPA:        https://ilwinnebago.fidlar.com/ILWinnebago/DirectSearch/#/search
//   It is an Angular SPA. The runtime config (appConfig.json) points the app at a
//   .NET "Scrap.WebService.DirectSearch" REST backend:
//     webApiBase = https://ilwinnebago.fidlar.com/ILWinnebago/Scrap.WebService.DirectSearch/
//   Endpoints (grepped out of main.*.js + verified live):
//     POST {webApiBase}token            -> OAuth, grant_type=password&username=anonymous&password=anonymous
//                                           (ANONYMOUS login works -> bearer token, no real creds)
//     POST {webApiBase}breeze/Settings  -> county config (returns RecaptchaPublicKey, search flags)
//     POST {webApiBase}breeze/DocumentTypes -> doc-type code list (LIS PENDENS = code 111, FORECLOSURE = 82)
//     POST {webApiBase}breeze/Search    -> the actual record search (THE one we need)
//
// WHY THIS IS BLOCKED (verified, not assumed):
//   1. breeze/Search is reCAPTCHA-v3 gated. The Angular apiService does
//      recaptchaV3.execute("search") then sends header `FidlarCaptchaSolution: <token>`
//      (site key 6LckDLwaAAAAAFdkFeW-dkX0IMirFhqiB_tXcRZE). The server VALIDATES it:
//      POSTing breeze/Search with an empty / fake / missing FidlarCaptchaSolution all
//      return HTTP 500 ("unexpected error"). A valid token requires a real browser
//      solving Google reCAPTCHA against the live domain — impossible from zero-dep Node.
//   2. breeze/Settings reports DocumentTypeSearchEnabled:false for this county, so even
//      with a token you cannot filter by doc-type (LIS PENDENS) at the API — only
//      PartySearch + DateRange are enabled, and ViewAddress/ViewParcel are false.
//
// This module hits the REAL endpoints (config + token + a probe Search). If the
// captcha wall blocks Search (the live state) it returns an honest status:"blocked"
// with the exact endpoint + reason — it NEVER fabricates. If a future playwright
// relay supplies a solved-captcha token via opts.captcha, the parse path below turns
// the real DocResults into contract leads.
import { fetchJson, fetchText } from "../http.js";

export const meta = {
  id: "recorder-winnebago",
  label: "Winnebago Recorder — Fidlar Direct Search (lis pendens)",
  source: "ilwinnebago.fidlar.com",
  kind: "trigger",
  counties: ["Winnebago"],
  method: "http",
};

const SPA = "https://ilwinnebago.fidlar.com/ILWinnebago/DirectSearch/";
const CONFIG_URL = SPA + "appConfig.json";
const SEARCH_PATH = "breeze/Search";
// Doc-types we want, by their recorder code (from breeze/DocumentTypes, verified live).
// Search by name uses DocumentName; by code uses DocumentType (county-permitting).
const TARGET_DOCS = [
  { code: "111", name: "LIS PENDENS" },
  { code: "82", name: "FORECLOSURE" },
  { code: "132", name: "NOTICE" }, // "NOTICE OF FORECLOSURE" variants record under NOTICE
];

// last N days -> MM/dd/yyyy strings (the form sends StartDate/EndDate as MM/dd/yyyy)
function dateRange(days) {
  const end = new Date();
  const start = new Date(end.getTime() - days * 86400e3);
  const fmt = (d) =>
    `${String(d.getMonth() + 1).padStart(2, "0")}/${String(
      d.getDate(),
    ).padStart(2, "0")}/${d.getFullYear()}`;
  return { StartDate: fmt(start), EndDate: fmt(end) };
}

const iso = (s) => {
  const m = String(s || "").match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!m) return null;
  const [, mo, d, y] = m;
  return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
};

// Build the full search payload (the SPA sends the whole form group, raw).
function searchBody(doc, range) {
  return {
    FirstName: "",
    LastBusinessName: "",
    StartDate: range.StartDate,
    EndDate: range.EndDate,
    DocumentName: doc.name,
    DocumentType: doc.code,
    SubdivisionName: "",
    SubdivisionLot: "",
    SubdivisionBlock: "",
    MunicipalityName: "",
    TractSection: "",
    TractTownship: "",
    TractRange: "",
    TractQuarter: "",
    TractQuarterQuarter: "",
    AddressHouseNo: "",
    AddressStreet: "",
    AddressCity: "",
    AddressZip: "",
    ParcelNumber: "",
    Book: "",
    Page: "",
    ReferenceNumber: "",
  };
}

async function getToken(webApiBase) {
  // anonymous OAuth password grant — no real credentials
  const txt = await fetchText(webApiBase + "token", {
    method: "POST",
    cache: false,
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=password&username=anonymous&password=anonymous",
  });
  return JSON.parse(txt).access_token;
}

// Map a live DocResult row -> contract lead (only reached if captcha is ever solved).
function rowToLead(row, doc) {
  const parties = []
    .concat(row.Grantors || [], row.Grantees || [], row.Parties || [])
    .map((p) => (typeof p === "string" ? p : p.Name || p.PartyName))
    .filter(Boolean);
  // homeowner/defendant = grantor on a LIS PENDENS (lender is grantee/plaintiff)
  const owner =
    (row.Grantors && (row.Grantors[0]?.Name || row.Grantors[0])) ||
    parties[0] ||
    null;
  return {
    county: "Winnebago",
    address: row.Address || row.CommonAddress || null,
    city: null,
    zip: null,
    owner: owner || null,
    caseNumber:
      row.CaseNumber || row.DocumentNumber || row.InstrumentNumber || null,
    court: "Winnebago County Recorder (17th Judicial Circuit)",
    lender: null,
    attorney: null,
    filing:
      iso(row.RecordDate || row.RecordingDate || row.FileDate || row.DocDate) ||
      null,
    judgment: null,
    sale: null,
    openingBid: null,
    docType: doc.name,
    sourceUrl: SPA + "#/search",
  };
}

export async function collect(opts = {}) {
  // 1. discover the live API base from the SPA's runtime config
  let webApiBase;
  try {
    const cfg = await fetchJson(CONFIG_URL, { cache: false });
    webApiBase = cfg.webApiBase;
    if (!webApiBase) throw new Error("no webApiBase in appConfig.json");
  } catch (e) {
    return {
      status: "blocked",
      note: `GET ${CONFIG_URL} failed (${String(
        e.message || e,
      )}); cannot discover the Fidlar Scrap.WebService.DirectSearch API base.`,
      leads: [],
    };
  }
  const searchUrl = webApiBase + SEARCH_PATH;

  // 2. anonymous bearer token (live)
  let token;
  try {
    token = await getToken(webApiBase);
    if (!token) throw new Error("no access_token");
  } catch (e) {
    return {
      status: "blocked",
      note: `POST ${webApiBase}token (anonymous OAuth) failed: ${String(
        e.message || e,
      )}.`,
      leads: [],
    };
  }

  // 3. attempt the real LIS PENDENS search for the last 180 days.
  // breeze/Search is reCAPTCHA-v3 gated via the FidlarCaptchaSolution header.
  // opts.captcha (a solved token from a future browser/relay) is honored if present;
  // otherwise the server rejects it (HTTP 500) and we report an honest block.
  const range = dateRange(opts.days || 180);
  const captcha = opts.captcha || "";
  const leads = [];
  let lastStatus = null;
  for (const doc of TARGET_DOCS) {
    try {
      const txt = await fetchText(searchUrl, {
        method: "POST",
        cache: false,
        retries: 0,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          FidlarCaptchaSolution: captcha,
        },
        body: JSON.stringify(searchBody(doc, range)),
      });
      const json = JSON.parse(txt);
      const rows = json?.SearchResult?.DocResults || json?.DocResults || [];
      for (const r of rows) leads.push(rowToLead(r, doc));
    } catch (e) {
      lastStatus = String(e.message || e);
    }
  }

  if (leads.length) {
    return {
      status: "ok",
      note: `${leads.length} recorded LIS PENDENS/FORECLOSURE notice(s), last ${
        opts.days || 180
      }d, from Fidlar ${searchUrl} (captcha token supplied).`,
      leads,
    };
  }

  return {
    status: "blocked",
    note:
      `POST ${searchUrl} is reCAPTCHA-v3 gated. The Angular app runs ` +
      `recaptchaV3.execute("search") (site key 6LckDLwaAAAAAFdkFeW-dkX0IMirFhqiB_tXcRZE) ` +
      `and sends header FidlarCaptchaSolution:<token>; the server VALIDATES it ` +
      `(empty/fake/missing token -> HTTP 500, confirmed live${
        lastStatus ? ` — last: ${lastStatus}` : ""
      }). A valid token needs a real browser solving Google reCAPTCHA on the live ` +
      `domain (impossible from zero-dep Node). Also breeze/Settings reports ` +
      `DocumentTypeSearchEnabled:false for Winnebago, so doc-type (LIS PENDENS, ` +
      `recorder code 111) filtering is disabled at the API too. Anonymous OAuth ` +
      `token + breeze/Settings + breeze/DocumentTypes all work unauthenticated; ` +
      `only breeze/Search is blocked. Pass opts.captcha (solved token from a ` +
      `browser/relay) to unblock — the parse path is wired.`,
    leads: [],
  };
}
