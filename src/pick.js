// The one-a-day picker (spec P0-3, P0-4, P0-6). Gates every lead, ranks the
// survivors by expected profit, and reports the winner, 5 runners-up, the
// closest miss, gate-drop counts and pool health. Pure: no I/O, no sends.
import { evaluate } from "./pick-eval.js";
import { poolHealth } from "./pick-health.js";

export { evaluate, settings, DEAD_STATUS } from "./pick-eval.js";
export { aliasKeys, buildSentSet, isSentIn, expandLegacyKey, outcomeAliasKeys } from "./alias.js";
export { poolHealth } from "./pick-health.js";

// Gates that mean "close, but not today" (versus dead, sent, or not a person).
const NEAR_GATES = new Set(["short_runway", "small_gap", "out_of_radius", "suspect_value", "no_gap", "weak_value", "low_ev"]);

// Distance in days from the 21 to 45 day sweet spot. No sale date yet means a
// long runway, a little past the window.
function runwayMiss(d) {
  if (d == null) return 15;
  if (d < 21) return 21 - d;
  return d > 45 ? d - 45 : 0;
}

// True filing or recording date only; a newspaper publication date is not fresh.
function freshness(lead) {
  const t = Date.parse(lead.filing || lead.recorded || "");
  return Number.isNaN(t) ? 0 : t;
}

export function compareLeads(a, b) {
  const ea = a.pickEval;
  const eb = b.pickEval;
  return (
    eb.ev - ea.ev ||
    runwayMiss(ea.terms.runwayDays) - runwayMiss(eb.terms.runwayDays) ||
    (ea.terms.distanceMi ?? 99) - (eb.terms.distanceMi ?? 99) ||
    freshness(b) - freshness(a)
  );
}

const addrLine = (l) => [l.address, l.city].filter(Boolean).join(", ");

function nearMissOf(leads) {
  const near = leads.filter((l) => !l.pickEval.ok && NEAR_GATES.has(l.pickEval.gate));
  if (!near.length) return null;
  near.sort(compareLeads);
  const l = near[0];
  return { lead: l, gate: l.pickEval.gate, reason: l.pickEval.reasons[0], address: addrLine(l) };
}

// pickDaily(leads, { isSent, now, sources, settings })
export function pickDaily(leads, opts = {}) {
  const ctx = { now: opts.now || new Date(), isSent: opts.isSent, settings: opts.settings };
  const dropCounts = {};
  const eligible = [];
  for (const l of leads || []) {
    const e = evaluate(l, ctx);
    l.pickEval = e;
    if (e.ok) eligible.push(l);
    else dropCounts[e.gate] = (dropCounts[e.gate] || 0) + 1;
  }
  eligible.sort(compareLeads);
  const radius = opts.settings?.radiusMi;
  return {
    pick: eligible[0] || null,
    runnersUp: eligible.slice(1, 6),
    nearMiss: nearMissOf(leads || []),
    dropCounts,
    eligibleCount: eligible.length,
    health: poolHealth(leads || [], opts.sources ?? null, radius ?? undefined),
  };
}

// D4 copy: "No deal worth your time today. Closest miss: <address>, <reason>."
export function noDealMessage(result) {
  const nm = result?.nearMiss;
  if (!nm) return "No deal worth your time today.";
  const reason = nm.reason.replace(/\.$/, "");
  return `No deal worth your time today. Closest miss: ${nm.address}. ${reason}.`;
}
