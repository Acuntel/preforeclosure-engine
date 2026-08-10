// Lake County, IL official land records (Kofile / GovOS "publicsearch") — the
// EARLIEST foreclosure signal: a recorded LIS PENDENS (doc type "LP"), filed by
// the lender months before any sheriff sale and carrying the homeowner's NAME.
// Also pulls FORECLOSURE-NOTICE (FON) + FORECLOSURE (FOR).
//
// The site (https://lake.il.publicsearch.us) is a Kofile "ko-search-react" SPA.
// It does NOT use a REST/GraphQL endpoint — the real document-search API is a
// WebSocket at wss://<host>/ws speaking @kofile/* message types (reverse-engineered
// from the client bundle + sourcemap). Flow, all FREE/public, no login/captcha:
//   1. GET / once  -> server SSRs window.__ort=<uuid> AND Set-Cookie authToken +
//      authToken.sig (a signed session). The WS upgrade is authed by those cookies;
//      without the .sig the socket opens but the backend silently drops every msg.
//   2. open wss://host/ws WITH that Cookie + Origin.
//   3. send {type:"@kofile/FETCH_DOCUMENTS/v4", correlationId, sync:true, authToken,
//      payload:{ query:{ department:"RP", docTypes:"LP,FON,FOR",
//      recordedDateRange:"YYYYMMDD,YYYYMMDD", searchType:"advancedSearch",
//      limit, offset, sort:"desc", sortBy:"recordedDate" }, workspaceID }}.
//   4. read {type:"@kofile/FETCH_DOCUMENTS_FULFILLED/v6", payload:{data:{byOrder,
//      byHash}, meta:{numRecords}}}. On a LIS PENDENS the grantor = lender/plaintiff
//      and the grantee = the homeowner/defendant(s); emit the first INDIVIDUAL
//      grantee as owner. propertyAddress/parcel present on ~80% of records.
import { randomUUID } from "node:crypto";

export const meta = {
  id: "recorder-lake",
  label: "Lake County recorder — recorded LIS PENDENS (Kofile)",
  source: "lake.il.publicsearch.us",
  kind: "trigger",
  counties: ["Lake"],
  method: "http",
};

const HOST = "lake.il.publicsearch.us";
const ORIGIN = `https://${HOST}`;
const WS_URL = `wss://${HOST}/ws`;
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const DEPARTMENT = "RP"; // Land Records
const DOC_TYPES = "LP,FON,FOR"; // LIS PENDENS, FORECLOSURE-NOTICE, FORECLOSURE
const DAYS = 180;
const PAGE = 100; // server max per FETCH_DOCUMENTS page
const MAX_RECORDS = Number(process.env.RECORDER_LAKE_MAX || 600);
const FETCH = "@kofile/FETCH_DOCUMENTS/v4";
const FULFILLED = "@kofile/FETCH_DOCUMENTS_FULFILLED/v6";
const REJECTED = "@kofile/FETCH_DOCUMENTS_REJECTED/v1";

const ymd = (d) =>
  `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(
    d.getDate(),
  ).padStart(2, "0")}`;

// "6/8/2026" -> "2026-06-08"
function toISO(s) {
  const m = (s || "").match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  return m ? `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}` : null;
}

// "4868 IL ROUTE 83, LONG GROVE, ILLINOIS, 60047" -> {address, city, zip}
function splitAddress(full) {
  const out = { address: null, city: null, zip: null };
  const raw = (full || "").replace(/\s+/g, " ").trim();
  if (!raw) return out;
  const parts = raw.split(",").map((p) => p.trim());
  const zipPart = parts[parts.length - 1];
  if (/^\d{5}(-\d{4})?$/.test(zipPart)) {
    out.zip = zipPart.slice(0, 5);
    parts.pop();
  }
  // drop a trailing state token ("ILLINOIS" / "IL")
  if (parts.length && /^(IL|ILLINOIS)$/i.test(parts[parts.length - 1]))
    parts.pop();
  if (parts.length) out.address = parts.shift() || null;
  if (parts.length) out.city = parts.join(", ") || null;
  return out;
}

// The homeowner/defendant on a LIS PENDENS = the first INDIVIDUAL grantee.
// Fall back to the first grantee of any kind, then the raw grantee array head.
function pickOwner(rec) {
  const parties = Array.isArray(rec.parties) ? rec.parties : [];
  const grantees = parties.filter((p) => p && p.type === "grantee" && p.name);
  const indiv = grantees.find((p) => p.partyTypeCode === "I");
  if (indiv) return indiv.name;
  if (grantees[0]) return grantees[0].name;
  const arr = (rec.grantee || []).filter(Boolean);
  return arr[0] || null;
}

function lender(rec) {
  const parties = Array.isArray(rec.parties) ? rec.parties : [];
  const g = parties.find((p) => p && p.type === "grantor" && p.name);
  if (g) return g.name;
  const arr = (rec.grantor || []).filter(Boolean);
  return arr[0] || null;
}

function recToLead(rec) {
  const a = splitAddress((rec.propertyAddress || [])[0]);
  const docNo = rec.docNumber || rec.instrumentNumber || rec.documentNumber;
  return {
    county: "Lake",
    address: a.address,
    city: a.city,
    zip: a.zip,
    owner: pickOwner(rec),
    caseNumber: null, // a recorded LP carries a doc/instrument #, not a court case #
    docNumber: docNo || null,
    pin: (rec.parcel || [])[0] || null,
    lender: lender(rec),
    court: "19th Judicial Circuit, Lake County",
    docType: rec.docType || null,
    filing: toISO(rec.recordedDate),
    judgment: null,
    sale: null,
    openingBid: null,
    stage: "lis_pendens",
    kind: "trigger",
    sourceUrl: rec.docId ? `${ORIGIN}/doc/${rec.docId}` : ORIGIN,
  };
}

// GET / to mint a fresh __ort token + the signed authToken/.sig session cookies.
async function bootstrap() {
  const res = await fetch(ORIGIN + "/", {
    headers: { "User-Agent": UA, Accept: "text/html,*/*" },
  });
  const html = await res.text();
  if (!res.ok) throw new Error(`index HTTP ${res.status}`);
  const ort = (html.match(/window\.__ort="([^"]+)"/) || [])[1];
  const raw =
    typeof res.headers.getSetCookie === "function"
      ? res.headers.getSetCookie()
      : [res.headers.get("set-cookie")].filter(Boolean);
  const cookie = raw
    .map((c) => (c || "").split(";")[0])
    .filter(Boolean)
    .join("; ");
  if (!ort || !/authToken\.sig/.test(cookie))
    throw new Error("no __ort token / signed session cookie in index");
  return { ort, cookie };
}

// Open the WS, run paged FETCH_DOCUMENTS queries until we have every record in the
// window (or hit MAX_RECORDS). Resolves {records, total} or rejects.
function searchAll({ ort, cookie }) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL, {
      headers: { "User-Agent": UA, Origin: ORIGIN, Cookie: cookie },
    });
    const end = new Date();
    const start = new Date(Date.now() - DAYS * 864e5);
    const range = `${ymd(start)},${ymd(end)}`;
    const records = [];
    let total = null;
    let offset = 0;
    let cid = null;
    let done = false;

    let pageTimer = null;
    let pageTries = 0;
    const finish = (fn, arg) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      clearTimeout(pageTimer);
      try {
        ws.close();
      } catch {}
      fn(arg);
    };
    const timer = setTimeout(
      () => finish(reject, new Error("ws timeout")),
      120_000,
    );

    // Send (or re-send) the page at the current offset. The WS occasionally
    // stalls on a page; resend the same offset up to twice before giving up so
    // one dropped response can't kill a whole sweep.
    const sendPage = (retry = false) => {
      if (!retry) pageTries = 0;
      cid = randomUUID();
      ws.send(
        JSON.stringify({
          type: FETCH,
          correlationId: cid,
          sync: true,
          authToken: ort,
          payload: {
            workspaceID: "search",
            query: {
              department: DEPARTMENT,
              docTypes: DOC_TYPES,
              recordedDateRange: range,
              searchType: "advancedSearch",
              limit: PAGE,
              offset,
              sort: "desc",
              sortBy: "recordedDate",
            },
          },
        }),
      );
      clearTimeout(pageTimer);
      pageTimer = setTimeout(() => {
        if (done) return;
        if (pageTries++ < 2) sendPage(true);
        else finish(reject, new Error(`page stalled at offset ${offset}`));
      }, 25_000);
    };

    ws.addEventListener("open", sendPage);
    ws.addEventListener("error", (e) =>
      finish(reject, new Error("ws error: " + (e.message || "unknown"))),
    );
    ws.addEventListener("close", () => {
      if (!done) finish(resolve, { records, total: total ?? records.length });
    });
    ws.addEventListener("message", (e) => {
      let m;
      try {
        m = JSON.parse(e.data);
      } catch {
        return;
      }
      if (m.type === REJECTED && m.correlationId === cid)
        return finish(
          reject,
          new Error(
            "search rejected: " + JSON.stringify(m.payload).slice(0, 120),
          ),
        );
      if (m.type !== FULFILLED || m.correlationId !== cid) return;
      clearTimeout(pageTimer);
      const data = (m.payload && m.payload.data) || {};
      const order = data.byOrder || [];
      const hash = data.byHash || {};
      if (total == null)
        total = (m.payload.meta && m.payload.meta.numRecords) || order.length;
      for (const id of order) if (hash[id]) records.push(hash[id]);
      offset += order.length;
      if (
        order.length < PAGE ||
        offset >= total ||
        records.length >= MAX_RECORDS
      )
        return finish(resolve, { records, total });
      sendPage();
    });
  });
}

export async function collect() {
  if (typeof WebSocket === "undefined")
    return {
      status: "blocked",
      note: `${WS_URL} is a WebSocket API and this Node has no global WebSocket (needs Node 20+).`,
      leads: [],
    };

  let session;
  try {
    session = await bootstrap();
  } catch (e) {
    return {
      status: "blocked",
      note: `${ORIGIN}/ unreachable or session changed (${e.message}). API: ${WS_URL} send "${FETCH}", authed by the signed authToken/authToken.sig cookies from GET /.`,
      leads: [],
    };
  }

  let out;
  try {
    out = await searchAll(session);
  } catch (e) {
    return {
      status: "blocked",
      note: `${WS_URL} ${FETCH} (department=RP docTypes=${DOC_TYPES}, last ${DAYS}d) failed: ${e.message}.`,
      leads: [],
    };
  }

  const leads = out.records.map(recToLead).filter((l) => l.owner);
  if (!leads.length)
    return {
      status: "partial",
      note: `Kofile WS returned ${out.records.length} recorded docs but none had a usable owner/grantee (last ${DAYS}d, docTypes=${DOC_TYPES}).`,
      leads: [],
    };

  const withAddr = leads.filter((l) => l.address).length;
  return {
    status: out.total > leads.length + 50 ? "partial" : "ok",
    note: `${leads.length} recorded LIS PENDENS / foreclosure notices, last ${DAYS}d (Kofile WS, ${out.total} in window; ${withAddr} w/ property address). Grantee=homeowner/defendant.`,
    leads,
  };
}
