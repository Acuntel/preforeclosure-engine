// McHenry County Recorder — recorded LIS PENDENS / FORECLOSURE NOTICE trigger.
// EARLIEST signal: the recorder books a lis pendens when the lender FILES the
// foreclosure suit — months ahead of any sheriff sale — and it carries the
// homeowner's NAME (grantor) + often the parcel/address.
//
// LIVE SOURCE FACTS (confirmed by fetching the site on 2026-06-08):
//   Free public tier = Fidlar "AVA" (Laredo Anywhere), an Angular SPA at
//     https://rep4laredo.fidlar.com/ILMcHenry/AvaWeb/
//   Runtime config (AvaWeb/appConfig.json) -> webApiBase:
//     https://rep4laredo.fidlar.com/ILMcHenry/Scrap.WebService.Ava/
//   Real backend JSON API (found by grepping the main.*.js bundle):
//     - POST  {base}token              grant_type=password&username=anonymous
//                                       &password=anonymous   -> { access_token }
//                                       (anonymous guest login — no real account)
//     - GET   {base}breeze/Settings    -> RecaptchaPublicKey, DataLagTime=7, ...
//     - GET   {base}breeze/DocumentTypes -> code list; LIS PENDENS = "201",
//             FORECLOSURE NOTICE = "203", AMENDED LIS/PEN = "209"
//     - POST  {base}breeze/Search      body = the search form's raw values
//             { StartDate:"MM/dd/yyyy", EndDate:"MM/dd/yyyy", DocumentType:"201",
//               FirstName, LastBusinessName, AddressStreet, ParcelNumber, ... }
//             -> { DocResults:[ { DocumentName, DocumentType, RecordedDateTime,
//                  Parties[], ... } ], ResultId, ResultAccessCode, Msg }
//
//   GATE (confirmed): breeze/Search requires a GENUINE Google reCAPTCHA v3 token
//   (site key 6LckDLwaAAAAAFdkFeW-dkX0IMirFhqiB_tXcRZE, action "search") sent in
//   the `FidlarCaptchaSolution` request header — the SPA mints it via
//   grecaptcha.execute() in a real browser on the fidlar.com origin. With a valid
//   anonymous bearer but an empty / missing / fake captcha solution the server
//   returns HTTP 500 ("An unexpected error occurred ... Error ID ...") because the
//   server-side reCAPTCHA verification fails. A v3 token cannot be minted from a
//   zero-dep headless HTTP client, so this is an HONEST "blocked".
//
// This module still hits the REAL endpoints (token -> Search). If Fidlar ever
// drops the captcha for a given request, the parser turns DocResults into
// contract leads. It NEVER fabricates.
import { fetchJson, fetchText } from "../http.js";

export const meta = {
  id: "recorder-mchenry",
  label: "McHenry County Recorder — recorded lis pendens (Fidlar AVA)",
  source: "rep4laredo.fidlar.com (Fidlar AVA / Laredo Anywhere)",
  kind: "trigger",
  counties: ["McHenry"],
  method: "http",
};

const APP = "https://rep4laredo.fidlar.com/ILMcHenry/AvaWeb/";
const BASE = "https://rep4laredo.fidlar.com/ILMcHenry/Scrap.WebService.Ava/";
const TOKEN_URL = BASE + "token";
const SETTINGS_URL = BASE + "breeze/Settings";
const SEARCH_URL = BASE + "breeze/Search";
const ORIGIN = "https://rep4laredo.fidlar.com";
// Recorded foreclosure-initiating doc types (codes confirmed live via
// breeze/DocumentTypes). 201 = LIS PENDENS, 203 = FORECLOSURE NOTICE,
// 209 = AMENDED LIS/PEN. We sweep each over ~180 days.
const DOC_TYPES = [
  { code: "201", name: "LIS PENDENS" },
  { code: "203", name: "FORECLOSURE NOTICE" },
];
const LOOKBACK_DAYS = 180;
const COURT = "22nd Judicial Circuit, McHenry County";

const clean = (s) =>
  String(s ?? "")
    .replace(/\s+/g, " ")
    .trim();

function mmddyyyy(d) {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${m}/${day}/${d.getFullYear()}`;
}

// Empty AVA search form; we only fill the date range + DocumentType code.
function buildBody(docCode, start, end) {
  return JSON.stringify({
    FirstName: "",
    LastBusinessName: "",
    StartDate: mmddyyyy(start),
    EndDate: mmddyyyy(end),
    DocumentName: "",
    DocumentType: docCode,
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
  });
}

async function getToken() {
  const data = await fetchJson(TOKEN_URL, {
    method: "POST",
    cache: false,
    retries: 1,
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Origin: ORIGIN,
      Referer: APP,
    },
    body: "grant_type=password&username=anonymous&password=anonymous",
  });
  if (!data || !data.access_token) throw new Error("no access_token");
  return data.access_token;
}

// Normalize an ISO/.NET date string to YYYY-MM-DD, else null.
function toYmd(v) {
  const s = clean(v);
  if (!s) return null;
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

// Pull the homeowner/defendant name from a DocResult. AVA exposes parties under
// Parties / GrantorParties / GranteeParties (shapes vary); the homeowner is the
// grantor/defendant on a lis pendens. We take grantor-side first, then any party.
function ownerOf(r) {
  const namesFrom = (arr) =>
    (Array.isArray(arr) ? arr : [])
      .map((p) =>
        clean(p?.Name || p?.PartyName || p?.FullName || p?.LastName || p),
      )
      .filter(Boolean);
  const grantor = namesFrom(
    r.GrantorParties || r.Grantors || r.GrantorPartyList,
  );
  const any = namesFrom(r.Parties || r.PartyList || r.AllParties);
  const grantee = namesFrom(
    r.GranteeParties || r.Grantees || r.GranteePartyList,
  );
  return grantor[0] || any[0] || grantee[0] || null;
}

// Map one AVA DocResult to the contract lead shape.
function toLead(r) {
  const legal = clean(r.LegalDescription || r.Legal || "");
  const addr = clean(r.CommonAddress || r.Address || r.PropertyAddress || "");
  return {
    county: "McHenry",
    owner: ownerOf(r),
    caseNumber: clean(r.CaseNumber || r.ReferenceNumber || "") || null,
    filing: toYmd(r.RecordedDateTime || r.RecordedDate || r.DocumentDate),
    address: addr || (legal ? null : null) || null,
    legalDescription: legal || null,
    docType: clean(r.DocumentType || ""),
    docNumber: clean(r.DocumentName || r.DocumentNumber || "") || null,
    court: COURT,
    stage: "lis_pendens",
    sourceUrl: APP,
    kind: "trigger",
  };
}

export async function collect() {
  let token;
  try {
    token = await getToken();
  } catch (e) {
    return {
      status: "blocked",
      note:
        `McHenry recorder (Fidlar AVA) anonymous login failed at POST ${TOKEN_URL} ` +
        `(grant_type=password&username=anonymous): ${clean(e.message || e)}.`,
      leads: [],
    };
  }

  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - LOOKBACK_DAYS);
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
    // The SPA fills this with a real grecaptcha v3 token; we have none. Empty =>
    // the server's reCAPTCHA verify fails (HTTP 500). Sent for shape parity.
    FidlarCaptchaSolution: "",
    Origin: ORIGIN,
    Referer: APP,
  };

  const leads = [];
  let gated = false;
  let lastErr = "";
  for (const dt of DOC_TYPES) {
    try {
      const txt = await fetchText(SEARCH_URL, {
        method: "POST",
        cache: false,
        retries: 0,
        headers,
        body: buildBody(dt.code, start, end),
      });
      const data = JSON.parse(txt.replace(/^[)\]}'&\s]*\n/, ""));
      const rows = data.DocResults || data.value || [];
      for (const r of rows) {
        const lead = toLead(r);
        if (lead.owner || lead.docNumber) leads.push(lead);
      }
    } catch (e) {
      const msg = clean(e.message || e);
      lastErr = msg;
      // HTTP 500 from breeze/Search with our empty captcha solution == the
      // reCAPTCHA v3 gate (server-side verify failed). 401 == token expired.
      if (/HTTP 500|HTTP 401|HTTP 403/.test(msg)) gated = true;
    }
  }

  if (leads.length) {
    return {
      status: "ok",
      note:
        `${leads.length} recorded lis-pendens/foreclosure-notice docs (last ${LOOKBACK_DAYS}d) ` +
        `via Fidlar AVA breeze/Search.`,
      leads,
    };
  }

  return {
    status: "blocked",
    note:
      `POST ${SEARCH_URL} is reCAPTCHA-v3-gated: it requires a genuine Google ` +
      `reCAPTCHA v3 token (site key 6LckDLwaAAAAAFdkFeW-dkX0IMirFhqiB_tXcRZE, ` +
      `action "search") in the FidlarCaptchaSolution header, minted only by ` +
      `grecaptcha.execute() in a real browser on the fidlar.com origin. ` +
      `Anonymous bearer login (POST ${TOKEN_URL}) + DocumentTypes (LIS PENDENS=201, ` +
      `FORECLOSURE NOTICE=203) work, but Search returns HTTP 500 with an empty/` +
      `missing token (server-side captcha verify fails). ${lastErr ? "Last: " + lastErr + ". " : ""}` +
      `Needs a browser/Playwright relay to supply a v3 token.`,
    leads: [],
  };
}
