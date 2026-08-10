// Clean owner phone + email via the Endato / Enformion "Contact Enrichment" API —
// name + property address in, cell/landline + email out. This is the "clean and
// effective" path (per deep research 2026): a real skip-trace API with an INSTANT
// self-serve key and a FREE 100-matches/month tier. Since we only trace the daily
// shortlist (top few leads/day ≈ ~90/mo), it fits the free tier — no scraping, no
// proxies, far better accuracy than free people-search sites.
//
// Setup (free): sign up at enformion.com / endato.com → get galaxy-ap-name +
// galaxy-ap-password, put them in ~/Documents/redline-private/vince-bot.local.json
// as ENDATO_AP_NAME / ENDATO_AP_PASSWORD (loaded by secrets.js). OFF until set.
//
// A persistent trace cache (.vince-traced.json) means a lead is skip-traced ONCE,
// not on every 20-min rescan — protects the free tier and is polite.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { secret } from "../secrets.js";

export const meta = {
  id: "skiptrace-endato",
  label: "Endato/Enformion skip-trace — owner phone (free tier)",
  source: "enformion.com",
  kind: "enrich",
  method: "http",
};

const ENDPOINT =
  process.env.ENDATO_ENDPOINT || "https://devapi.enformion.com/Contact/Enrich";
const CACHE = path.join(process.cwd(), ".vince-traced.json");

export function enabled() {
  return !!(secret("ENDATO_AP_NAME") && secret("ENDATO_AP_PASSWORD"));
}

let _cache = null;
function cache() {
  if (_cache) return _cache;
  try {
    _cache = existsSync(CACHE) ? JSON.parse(readFileSync(CACHE, "utf8")) : {};
  } catch {
    _cache = {};
  }
  return _cache;
}
function remember(key, val) {
  const c = cache();
  c[key] = { ...val, ts: Date.now() };
  try {
    writeFileSync(CACHE, JSON.stringify(c, null, 2));
  } catch {}
}

function nameParts(owner, heir) {
  // prefer the reachable heir on a probate lead; else the record owner
  const s = String(heir || owner || "").trim();
  if (!s) return null;
  if (s.includes(",")) {
    const [last, first] = s.split(",").map((x) => x.trim());
    return { first: (first || "").split(" ")[0], last };
  }
  const b = s.split(/\s+/);
  return { first: b[0], last: b[b.length - 1] };
}

function traceKey(lead) {
  return `${lead.county}::${lead.owner || lead.heirName || ""}::${lead.address || ""}`
    .toUpperCase()
    .trim();
}

// Enrich ONE lead with phone/email. Cached → returns cached; else calls Endato.
export async function endatoTrace(lead) {
  if (!enabled() || !lead.address) return {};
  const key = traceKey(lead);
  const c = cache();
  if (c[key]) return c[key].fields || {};

  const nm = nameParts(lead.owner, lead.heirName);
  if (!nm) return {};
  const body = {
    FirstName: nm.first,
    LastName: nm.last,
    Address: {
      addressLine1: lead.heirMailing || lead.address,
      addressLine2: [lead.city, "IL", lead.zip].filter(Boolean).join(", "),
    },
  };
  let json;
  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "galaxy-ap-name": secret("ENDATO_AP_NAME"),
        "galaxy-ap-password": secret("ENDATO_AP_PASSWORD"),
        "galaxy-search-type": "DevAPIContactEnrich",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    json = await res.json();
  } catch {
    return {};
  }
  const person = json?.person || json?.persons?.[0] || json;
  const phones = (person?.phones || person?.phoneNumbers || [])
    .map((p) => ({
      number: p.phoneNumber || p.number,
      type: p.phoneType || p.type,
    }))
    .filter((p) => p.number);
  const emails = (person?.emails || [])
    .map((e) => e.email || e)
    .filter(Boolean);

  const out = {};
  if (phones.length) {
    // prefer a mobile/wireless number — best for a first call
    const mobile = phones.find((p) =>
      /wireless|mobile|cell/i.test(p.type || ""),
    );
    out.phones = phones.map((p) => p.number);
    out.phone = (mobile || phones[0]).number;
    out.phoneType = (mobile || phones[0]).type || null;
  }
  if (emails.length) out.email = emails[0];
  if (out.phone) out.contactSource = "endato";
  remember(key, { fields: out });
  return out;
}
