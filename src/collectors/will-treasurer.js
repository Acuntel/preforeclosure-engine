// Will County treasurer — tax-delinquent / pre-foreclosure trigger.
// Ports Brady's distressed-scraper pipeline to JS. The "Wildfire" treasurer API
// (POST .../Wildfire/Records {value,skip,direct}) is WAF-blocked (403) from a
// residential IP; bypass = AWS Lambda relay "distressed-relay" (us-east-2).
// Confirmed-delinquent owners/PINs come from the treasurer's published notices
// (parse_will_pdfs.py -> will_county_delinquent_2025.csv); we search each owner
// LIVE, match by PIN, emit a trigger lead. Tax-delinquent => stage lis_pendens.
// Order: 1) Wildfire direct  2) distressed-relay Lambda  3) cached enriched CSV.
import { fetchJson } from "../http.js";
import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";

export const meta = {
  id: "will-treasurer",
  label: "Will County treasurer — delinquent tax (Wildfire API)",
  source: "willcountytreasurer.us",
  kind: "trigger",
  counties: ["Will"],
  method: "http",
};

const API =
  "https://d1ebsyxxbc7tep.cloudfront.net/data/8ee9867e-b26c-4662-aa13-cdbbbe647ea9/Wildfire/Records";
const LAMBDA_FN = "distressed-relay";
const LAMBDA_REGION = "us-east-2";
const OUT = path.join(
  homedir(),
  "Desktop",
  "distressed-scraper",
  "scraper_output",
);
const DELINQ_CSV = path.join(OUT, "will_county_delinquent_2025.csv");
const ENRICHED_CSV = path.join(OUT, "will_county_delinquent_enriched.csv");

// How many distinct delinquent owners to look up live per run (the registry runs
// every trigger; a full ~6.8k-owner sweep would be far too slow). Tunable.
const MAX_OWNERS = Number(process.env.WILL_MAX_OWNERS || 25);
const COURT = "Will County Treasurer (delinquent tax / pre-tax-sale)";
// Trigger-shape fields a tax-delinquent record doesn't carry (no court case yet).
const NULLS = {
  lender: null,
  attorney: null,
  filing: null,
  judgment: null,
  sale: null,
};
const HEADERS = {
  "Content-Type": "application/json;charset=UTF-8",
  Referer: "https://willcountytreasurer.us/",
  Origin: "https://willcountytreasurer.us",
  Accept: "application/json, text/plain, */*",
};

function parseCsv(text) {
  // Walk char-by-char so quoted fields with embedded commas/newlines survive.
  const rows = [];
  let row = [],
    f = "",
    q = false;
  const push = () => {
    row.push(f);
    f = "";
  };
  const eol = () => {
    push();
    rows.push(row);
    row = [];
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') {
        f += '"';
        i++;
      } else if (c === '"') q = false;
      else f += c;
    } else if (c === '"') q = true;
    else if (c === ",") push();
    else if (c === "\n") eol();
    else if (c !== "\r") f += c;
  }
  if (f || row.length) eol();
  const header = rows.shift() || [];
  return rows
    .filter((r) => r.length > 1)
    .map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ""])));
}

async function tryDirect(value, skip) {
  const body = JSON.stringify({ value, skip, direct: false });
  return fetchJson(API, { method: "POST", headers: HEADERS, body, retries: 1 });
}

function execFileAsync(cmd, args) {
  return new Promise((resolve, reject) =>
    execFile(cmd, args, { maxBuffer: 32 * 1024 * 1024 }, (err, out, errOut) =>
      err ? reject(new Error(errOut || err.message)) : resolve(out),
    ),
  );
}

async function relayInvoke(value, skip) {
  const payload = JSON.stringify({
    body: JSON.stringify({ value, skip, direct: false }),
  });
  const tag = randomBytes(4).toString("hex");
  const inFile = path.join(tmpdir(), `will_in_${tag}.json`);
  const outFile = path.join(tmpdir(), `will_out_${tag}.json`);
  await writeFile(inFile, payload);
  const flags = `lambda invoke --function-name ${LAMBDA_FN} --region ${LAMBDA_REGION} --cli-binary-format raw-in-base64-out --payload`;
  await execFileAsync("aws", [
    ...flags.split(" "),
    `file://${inFile}`,
    outFile,
  ]);
  const outer = JSON.parse(await readFile(outFile, "utf8"));
  if (outer.statusCode !== 200) {
    throw new Error(
      `relay HTTP ${outer.statusCode}: ${String(outer.body).slice(0, 120)}`,
    );
  }
  return JSON.parse(outer.body);
}

// Returns {fetch, mode} where fetch(value, skip) -> Wildfire JSON, or null.
async function pickFetcher() {
  try {
    await tryDirect("WILMINGTON", 0);
    return { fetch: tryDirect, mode: "wildfire-direct" };
  } catch (e) {
    const msg = String(e.message || e);
    if (!/HTTP 403|HTTP 429|HTTP 503|fetch failed/i.test(msg)) throw e;
  }
  try {
    await relayInvoke("WILMINGTON", 0);
    return { fetch: relayInvoke, mode: "distressed-relay-lambda" };
  } catch (e) {
    return { fetch: null, mode: "blocked", reason: String(e.message || e) };
  }
}

function addr(a) {
  if (!a) return { line1: "", city: "", state: "", zip: "" };
  let city = (a.City || "").trim();
  let state = (a.State || "").trim();
  if (!state && / [A-Z]{2}$/.test(city)) {
    state = city.slice(-2);
    city = city.slice(0, -2).trim();
  }
  return {
    line1: (a.Line1 || "").trim(),
    city,
    state: state || "IL",
    zip: (a.Zip || "").trim(),
  };
}

function recToLead(rec, owed) {
  const pa = addr(rec.PropertyAddress);
  const oa = addr(rec.OwnerAddress);
  const due = (rec.Values || {}).AmountDue;
  return {
    county: "Will",
    address: pa.line1,
    city: pa.city,
    zip: pa.zip,
    owner: rec.OwnerName1 || "",
    caseNumber: rec.ParcelNumber || "",
    court: COURT,
    ...NULLS,
    openingBid:
      typeof due === "number" && due > 0 ? Math.round(due) : owed || null,
    stage: "lis_pendens",
    mailing: oa.line1
      ? `${oa.line1}, ${oa.city} ${oa.state} ${oa.zip}`.trim()
      : null,
    absentee:
      pa.line1 && oa.line1 && pa.line1.toUpperCase() !== oa.line1.toUpperCase(),
    sourceUrl: "https://willcountytreasurer.us/",
  };
}

function money(s) {
  const n = parseFloat(String(s).replace(/[$,]/g, ""));
  return Number.isFinite(n) ? Math.round(n) : null;
}

async function fromCache() {
  if (!existsSync(ENRICHED_CSV)) {
    return {
      status: "blocked",
      note: `Wildfire API 403 from this IP; distressed-relay Lambda unreachable (no AWS creds for us-east-2); no cached scrape at ${ENRICHED_CSV}. Endpoint: POST ${API} {value,skip,direct}.`,
      leads: [],
    };
  }
  const rows = parseCsv(await readFile(ENRICHED_CSV, "utf8")).filter(
    (r) => r.property_address,
  );
  const leads = rows.slice(0, MAX_OWNERS).map((r) => ({
    county: "Will",
    address: r.property_address,
    city: r.property_city,
    zip: r.property_zip,
    owner: r.owner_name,
    caseNumber: r.pin,
    court: COURT,
    ...NULLS,
    openingBid: money(r.amount_owed),
    stage: "lis_pendens",
    mailing: r.mailing_address
      ? `${r.mailing_address}, ${r.mailing_city} ${r.mailing_state} ${r.mailing_zip}`.trim()
      : null,
    absentee: (r.absentee_owner || "").toLowerCase() === "yes",
    sourceUrl: "https://willcountytreasurer.us/",
  }));
  return {
    status: "partial",
    note:
      `served ${leads.length} from cached scrape (will_county_delinquent_enriched.csv, ` +
      `${rows.length} matched delinquent parcels); live needs distressed-relay Lambda (Wildfire 403 from this IP).`,
    leads,
  };
}

export async function collect() {
  if (!existsSync(DELINQ_CSV)) {
    return fromCache();
  }
  const delinq = parseCsv(await readFile(DELINQ_CSV, "utf8")).filter(
    (r) => r.owner_name && r.pin,
  );
  const seen = new Set();
  const want = [];
  for (const r of delinq) {
    const key = r.owner_name.trim();
    if (seen.has(key)) continue;
    seen.add(key);
    if (want.push(r) >= MAX_OWNERS) break;
  }
  const owedByPin = {};
  for (const r of delinq)
    owedByPin[r.pin.replace(/-/g, "").slice(-14)] = money(r.amount_owed);

  const picker = await pickFetcher();
  if (!picker.fetch) {
    const r = await fromCache();
    if (r.leads.length) {
      r.note = `Wildfire 403 + relay unreachable (${picker.reason}); ${r.note}`;
      return r;
    }
    return {
      status: "blocked",
      note:
        `Wildfire API 403 from this IP and distressed-relay Lambda unreachable: ${picker.reason}. ` +
        `Endpoint: POST ${API} {value,skip,direct}. Relay: invoke '${LAMBDA_FN}' in ${LAMBDA_REGION}.`,
      leads: [],
    };
  }

  const leads = [];
  let failures = 0;
  for (const o of want) {
    const lastName = o.owner_name.trim().split(/\s+/)[0];
    try {
      const data = await picker.fetch(lastName, 0);
      for (const rec of data.Records || []) {
        // API prefixes a 2-digit county code, so its ParcelNumber is 16 digits
        // vs the 14-digit newspaper PIN — match on the last 14 (per Brady's py).
        const key = (rec.ParcelNumber || "").replace(/-/g, "").slice(-14);
        if (key in owedByPin) leads.push(recToLead(rec, owedByPin[key]));
      }
    } catch {
      failures++;
    }
  }

  // dedupe by PIN
  const byPin = new Map();
  for (const l of leads)
    if (!byPin.has(l.caseNumber)) byPin.set(l.caseNumber, l);
  const out = [...byPin.values()];

  if (!out.length) {
    const fb = await fromCache();
    fb.note = `live ${picker.mode} returned 0 PIN-matched rows for ${want.length} owners; ${fb.note}`;
    return fb;
  }
  return {
    status: failures > want.length / 2 ? "partial" : "ok",
    note:
      `${out.length} live delinquent parcels via ${picker.mode} ` +
      `(searched ${want.length} confirmed-delinquent owners from treasurer notices; ${failures} lookups failed).`,
    leads: out,
  };
}
