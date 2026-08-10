// City of Chicago building-code violations — a distress proxy for neglected /
// dilapidated houses (Vince: "houses that look like a shithole, the ones to hit").
// Free Socrata JSON (zero-auth, CORS-open, no Cloudflare), refreshed daily. Owner +
// value are filled downstream by the existing Cook assessor enricher on the address.
import { fetchJson } from "../http.js";

export const meta = {
  id: "chicago-violations",
  label: "Chicago — open building-code violations (distress)",
  source: "data.cityofchicago.org",
  kind: "trigger",
  counties: ["Cook"],
  method: "http",
};

const BASE = "https://data.cityofchicago.org/resource/22u3-xenr.json";
const LOOKBACK_DAYS = Number(process.env.CHI_VIOLATION_LOOKBACK_DAYS || 90);
// distress-signalling violation descriptions (exterior decay / vacancy / danger)
const DISTRESS = [
  "EXTERIOR WALL",
  "PORCH",
  "EXTERIOR STAIR",
  "NUISANCE",
  "DANGEROUS",
  "VACANT",
  "ROOF",
  "FENCE",
  "DEBRIS",
  "WEEDS",
];

const APP_TOKEN = process.env.SOCRATA_APP_TOKEN || "";

export async function collect() {
  const since = new Date(Date.now() - LOOKBACK_DAYS * 864e5)
    .toISOString()
    .slice(0, 19);
  const like = DISTRESS.map(
    (d) => `upper(violation_description) like '%${d}%'`,
  ).join(" OR ");
  const where = `violation_status='OPEN' AND violation_date > '${since}' AND (${like})`;
  const url =
    `${BASE}?$where=${encodeURIComponent(where)}` +
    `&$order=${encodeURIComponent("violation_date DESC")}&$limit=1000`;

  let rows;
  try {
    rows = await fetchJson(
      url,
      APP_TOKEN ? { headers: { "X-App-Token": APP_TOKEN } } : {},
    );
  } catch (e) {
    return { status: "error", note: String(e.message || e), leads: [] };
  }
  if (!Array.isArray(rows))
    return { status: "error", note: "bad response", leads: [] };

  // one lead per PROPERTY (an address can have many open violations); keep the
  // most recent + count how many distinct distress violations it carries.
  const byAddr = new Map();
  for (const r of rows) {
    const address = (r.address || "").trim();
    if (!address) continue;
    const key = address.toUpperCase();
    const prev = byAddr.get(key);
    const date = (r.violation_date || "").slice(0, 10);
    if (!prev) {
      byAddr.set(key, {
        county: "Cook",
        address,
        city: "Chicago",
        signal: "code_violation",
        stage: "code_violation",
        violationCount: 1,
        violationType: r.violation_description || null,
        caseNumber: r.inspection_number || null,
        filing: date || null,
        sourceUrl: "https://data.cityofchicago.org/d/22u3-xenr",
      });
    } else {
      prev.violationCount++;
    }
  }
  const leads = [...byAddr.values()];
  return {
    status: "ok",
    note: `${leads.length} properties with open distress violations (last ${LOOKBACK_DAYS}d)`,
    leads,
  };
}
