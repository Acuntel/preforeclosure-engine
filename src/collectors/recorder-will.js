// Will County Recorder — Fidlar AvaWeb (AVA) recorded-document index.
// EARLIEST foreclosure signal + OWNER NAME: the recorded LIS PENDENS (the notice
// the lender records when it files the foreclosure suit) — months before any
// sheriff sale, and it carries the homeowner/defendant name + property address.
//
// The SPA https://ilwill.fidlar.com/ILWIll/AvaWeb/#!/search is Angular over a
// Breeze/REST JSON backend. Free Direct Search is NOT login/reCAPTCHA-gated:
// reCAPTCHA v3 (FidlarCaptchaSolution header) gates only PAID image View/Print.
// The index search only needs an anon OAuth bearer (grant_type=password,
// user/pass="anonymous"). Found via SPA -> appConfig.json (webApiBase) -> minified
// bundle: apiService.search() POSTs form criteria to webApiBase+"breeze/Search".
//   POST token                -> { access_token }              (anon OAuth grant)
//   POST breeze/DocumentTypes -> { DocumentTypes:[{Code,Name}] } (LIS PENDENS=68)
//   POST breeze/Search        -> { TotalResults, DocResults:[...] }  (live, 765 rows)
// Search caps at ~200 viewable rows/response (newest first), so we chunk the
// ~180-day window by calendar month and union — each month is < 200 records.
import { fetchJson, USER_AGENT } from "../http.js";

export const meta = {
  id: "recorder-will",
  label: "Will County Recorder — recorded LIS PENDENS (Fidlar AvaWeb)",
  source: "ilwill.fidlar.com",
  kind: "trigger",
  counties: ["Will"],
  method: "http",
};

const API = "https://ilwill.fidlar.com/ILWIll/Scrap.WebService.Ava/";
const SEARCH_URL = "https://ilwill.fidlar.com/ILWIll/AvaWeb/#!/search";
const REFERER = "https://ilwill.fidlar.com/ILWIll/AvaWeb/";
const LOOKBACK_DAYS = 180;
const COURT =
  "Will County Circuit Court (12th Judicial Circuit) — recorded notice";
// DocumentType codes we treat as a foreclosure-filing signal. LIS PENDENS is the
// canonical one; this county's index has no separate "NOTICE OF FORECLOSURE" type
// (verified against breeze/DocumentTypes), so 68 is the lever.
const DOC_TYPES = [{ code: "68", name: "LIS PENDENS" }];

const baseHeaders = (extra = {}) => ({
  "User-Agent": USER_AGENT,
  Accept: "application/json, text/plain, */*",
  Origin: "https://ilwill.fidlar.com",
  Referer: REFERER,
  ...extra,
});

// Anonymous OAuth grant the SPA uses (loginService.login: user/pass "anonymous").
async function getToken() {
  const body = "grant_type=password&username=anonymous&password=anonymous";
  const j = await fetchJson(API + "token", {
    method: "POST",
    headers: baseHeaders({
      "Content-Type": "application/x-www-form-urlencoded",
    }),
    body,
    cache: false,
    retries: 2,
  });
  if (!j || !j.access_token)
    throw new Error("no access_token in token response");
  return j.access_token;
}

// "6/5/2026 1:52:13 PM" -> "2026-06-05"
function isoDate(s) {
  const m = String(s || "").match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!m) return null;
  const [, mo, d, y] = m;
  return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
}

function ymd(date) {
  return date.toISOString().slice(0, 10);
}

// Inclusive month windows from (today - LOOKBACK_DAYS) .. today, so every chunk
// stays under the 200-row viewable cap.
function monthWindows() {
  const today = new Date();
  const start = new Date(today.getTime() - LOOKBACK_DAYS * 86400e3);
  const wins = [];
  let cur = new Date(start.getFullYear(), start.getMonth(), 1);
  while (cur <= today) {
    const monthStart = new Date(cur.getFullYear(), cur.getMonth(), 1);
    const monthEnd = new Date(cur.getFullYear(), cur.getMonth() + 1, 0);
    const sd = monthStart < start ? start : monthStart;
    const ed = monthEnd > today ? today : monthEnd;
    wins.push({ StartDate: ymd(sd), EndDate: ymd(ed) });
    cur = new Date(cur.getFullYear(), cur.getMonth() + 1, 1);
  }
  return wins;
}

// The SPA's searchForm raw value; every control must be present (empty = unused).
const FORM_FIELDS =
  "DocumentName SubdivisionName SubdivisionLot SubdivisionBlock MunicipalityName TractSection TractTownship TractRange TractQuarter TractQuarterQuarter AddressHouseNo AddressStreet AddressCity AddressZip ParcelNumber Book Page ReferenceNumber FirstName BusinessName".split(
    " ",
  );

function searchBody(docCode, name, win) {
  const body = {
    StartDate: win.StartDate,
    EndDate: win.EndDate,
    DocumentType: docCode, // short Code, e.g. 68 = LIS PENDENS
    DocumentTypeDisplayName: name,
    Skip: 0,
  };
  for (const f of FORM_FIELDS) body[f] = "";
  return JSON.stringify(body);
}

async function search(token, docCode, name, win) {
  return fetchJson(API + "breeze/Search", {
    method: "POST",
    headers: baseHeaders({
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      // FidlarCaptchaSolution is left empty — the index search ignores it (the
      // reCAPTCHA only gates paid image View/Print, not the free doc index).
      FidlarCaptchaSolution: "",
    }),
    body: searchBody(docCode, name, win),
    cache: true,
    ttl: 30 * 60 * 1000,
    retries: 2,
  });
}

// Legals: type "A" = common address, "P" = parcel/PIN, "S" = subdivision.
function legalsOf(rec, type) {
  return (rec.Legals || [])
    .filter((l) => (l.LegalType || "").toUpperCase() === type)
    .map((l) => (l.Description || "").replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

// First PartyTypeId-2 name = the actual defendant/homeowner (later type-2 names
// are co-defendants: IRS, HOA, spouses). Fall back to the flat Party2 string.
function ownerOf(rec) {
  const def = (rec.Parties || []).find((p) => p.PartyTypeId === 2 && p.Name);
  return (def?.Name || rec.Party2 || "").replace(/\s+/g, " ").trim() || null;
}
function lenderOf(rec) {
  const pl = (rec.Parties || []).find((p) => p.PartyTypeId === 1 && p.Name);
  return (pl?.Name || rec.Party1 || "").replace(/\s+/g, " ").trim() || null;
}

// Will County municipalities (incl. multi-word). The recorder's common-address
// legal has NO comma ("1950 PARKSIDE DRIVE SHOREWOOD IL 60404"), so street vs city
// is ambiguous without a gazetteer. We split ONLY on a known city right before
// "IL <zip>"; else keep the whole pre-IL text as `address`, city null (never guess).
// Sorted longest-first so e.g. "OAK FOREST" matches before "FOREST".
const WILL_CITIES = (
  "FRANKFORT SQUARE,UNIVERSITY PARK,PRESTON HEIGHTS,WILTON CENTER,ORLAND PARK," +
  "BOLINGBROOK,TINLEY PARK,PARK FOREST,HOMER GLEN,CREST HILL,ROMEOVILLE,NAPERVILLE," +
  "WILMINGTON,CHANNAHON,FRANKFORT,CRESTWOOD,NEW LENOX,OAK FOREST,SHOREWOOD,WOODRIDGE," +
  "MANHATTAN,COAL CITY,BRAIDWOOD,LOCKPORT,PLAINFIELD,ROCKDALE,SYMERTON,PEOTONE," +
  "MINOOKA,LEMONT,MOKENA,JOLIET,BEECHER,DIAMOND,STEGER,GODLEY,ELWOOD,MONEE,MARLEY,CRETE,AURORA"
).split(",");

// "1950 PARKSIDE DRIVE SHOREWOOD IL 60404" -> {street, city, zip}
function splitAddress(full) {
  if (!full) return { street: null, city: null, zip: null };
  const tail = full.match(/^(.*?)\s+IL\s+(\d{5})(?:-\d{4})?$/i);
  if (!tail) {
    const z = full.match(/\b(\d{5})\b/);
    return { street: full, city: null, zip: z ? z[1] : null };
  }
  const beforeIL = tail[1].replace(/\s+/g, " ").trim();
  const zip = tail[2];
  const up = beforeIL.toUpperCase();
  for (const city of WILL_CITIES) {
    if (up.endsWith(" " + city) || up === city) {
      const street = beforeIL.slice(0, beforeIL.length - city.length).trim();
      return { street: street || null, city, zip };
    }
  }
  // Unknown city — keep full pre-IL text as the address, don't fabricate a city.
  return { street: beforeIL || null, city: null, zip };
}

function recToLead(rec, docName) {
  const addrFull = legalsOf(rec, "A")[0] || null;
  const { street, city, zip } = splitAddress(addrFull);
  const pin = legalsOf(rec, "P")[0] || null;
  return {
    county: "Will",
    address: street, // common address from legal, if present
    city,
    zip,
    owner: ownerOf(rec), // homeowner / defendant (PartyTypeId 2)
    caseNumber: rec.DocumentName || null, // recording reference (R20260...)
    court: COURT,
    lender: lenderOf(rec), // plaintiff (PartyTypeId 1)
    attorney: null,
    filing: isoDate(rec.RecordedDateTime), // recording date YYYY-MM-DD
    judgment: null,
    sale: null,
    openingBid: null,
    pin,
    stage: "lis_pendens",
    kind: "trigger",
    docType: docName,
    sourceUrl: SEARCH_URL,
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
        `POST ${API}token (anonymous OAuth grant) failed: ${String(e.message || e)}. ` +
        `The free index search at ${API}breeze/Search needs this anonymous Bearer token; ` +
        `reCAPTCHA v3 only gates paid image View/Print.`,
      leads: [],
    };
  }

  const wins = monthWindows();
  const byKey = new Map(); // dedupe across overlapping windows by recording #
  let calls = 0;
  let failures = 0;

  for (const dt of DOC_TYPES) {
    for (const win of wins) {
      calls++;
      let data;
      try {
        data = await search(token, dt.code, dt.name, win);
      } catch (e) {
        failures++;
        continue;
      }
      for (const rec of data.DocResults || []) {
        const key = rec.DocumentName || `${rec.Id}`;
        if (byKey.has(key)) continue;
        byKey.set(key, recToLead(rec, dt.name));
      }
    }
  }

  const leads = [...byKey.values()].sort((a, b) =>
    (b.filing || "").localeCompare(a.filing || ""),
  );

  if (!leads.length) {
    if (failures === calls) {
      return {
        status: "blocked",
        note:
          `Got anon token but all ${calls} POST ${API}breeze/Search calls failed ` +
          `(DocumentType 68 = LIS PENDENS). Endpoint may now require FidlarCaptchaSolution ` +
          `(reCAPTCHA v3 site key 6LckDLwaAAAAAFdkFeW-dkX0IMirFhqiB_tXcRZE) or the bearer scope.`,
        leads: [],
      };
    }
    return {
      status: "ok",
      note: `0 LIS PENDENS recorded in Will County over the last ${LOOKBACK_DAYS}d (searched ${calls} month windows).`,
      leads: [],
    };
  }

  const withAddr = leads.filter((l) => l.address).length;
  return {
    status: failures ? "partial" : "ok",
    note:
      `${leads.length} recorded LIS PENDENS in Will County over last ~${LOOKBACK_DAYS}d ` +
      `(${withAddr} with a common address; owner=defendant + lender=plaintiff from the index) ` +
      `via free Fidlar AvaWeb Breeze API (anon bearer; reCAPTCHA gates only paid images)` +
      (failures ? `. ${failures}/${calls} month windows failed.` : "."),
    leads,
  };
}
