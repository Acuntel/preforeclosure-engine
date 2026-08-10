// Owner phone numbers via a pay-per-match skip-trace API. Public records give us
// the name + property/mailing address but NOT a phone; this is the only path to a
// callable number for Vince's in-person/first-call approach. HARD OFF unless
// SKIPTRACE_API_KEY is set (secrets.js / env) — no key => no-op, no cost, no PII
// call. Runs on the SHORTLIST only (top value-gap leads), never the whole set, so
// spend stays near zero. Default provider = BatchData (per-hit billing).
import { secret } from "../secrets.js";
import { fetchJson } from "../http.js";

export const meta = {
  id: "skiptrace",
  label: "Skip-trace — owner phone (pay-per-match, opt-in)",
  source: "batchdata.com",
  kind: "enrich",
  counties: ["DuPage", "Cook"],
  method: "http",
};

export function enabled() {
  return !!secret("SKIPTRACE_API_KEY");
}

// Split "Last, First" or "First Last" into parts for the API.
function nameParts(owner) {
  const s = String(owner || "").trim();
  if (!s) return { first: "", last: "" };
  if (s.includes(",")) {
    const [last, first] = s.split(",").map((x) => x.trim());
    return { first: (first || "").split(" ")[0], last };
  }
  const bits = s.split(/\s+/);
  return { first: bits[0], last: bits[bits.length - 1] };
}

async function batchdata(lead, key) {
  const { first, last } = nameParts(lead.owner);
  const body = {
    requests: [
      {
        name: { first, last },
        propertyAddress: {
          street: lead.address || "",
          city: lead.city || "",
          state: "IL",
          zip: lead.zip || "",
        },
      },
    ],
  };
  const res = await fetchJson(
    "https://api.batchdata.com/api/v1/property/skip-trace",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
  );
  const person = res?.results?.persons?.[0] || res?.persons?.[0];
  const phones = (person?.phoneNumbers || person?.phones || [])
    .map((p) => ({
      number: p.number || p.phoneNumber,
      type: p.type,
      score: p.score,
    }))
    .filter((p) => p.number);
  const emails = (person?.emails || [])
    .map((e) => e.email || e)
    .filter(Boolean);
  return { phones, emails };
}

// Enrich ONE lead with phone(s). Returns {} on any miss/error (never throws).
export async function skipTrace(lead) {
  const key = secret("SKIPTRACE_API_KEY");
  if (!key || !lead.owner) return {};
  const provider = (secret("SKIPTRACE_PROVIDER") || "batchdata").toLowerCase();
  try {
    let r;
    if (provider === "batchdata") r = await batchdata(lead, key);
    else return {};
    const out = {};
    if (r.phones?.length) {
      out.phones = r.phones;
      out.phone = r.phones[0].number; // primary, for the "reachable" score bump
    }
    if (r.emails?.length) out.email = r.emails[0];
    if (out.phone) out.skipTraced = true;
    return out;
  } catch {
    return {};
  }
}
