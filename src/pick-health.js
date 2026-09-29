// Pool health for the one-a-day pick (spec P0-6). A degraded pool (comps down,
// a core feed blocked) should defer the pick to a later pass, not burn the day.
import { locationPrecision, RADIUS_MI } from "./proximity.js";

export const CORE_SOURCES = ["tjsc", "intercounty", "recorder-cook"];
const MIN_COMPS_COVERAGE = 0.5;

// Leads that could be Vince's pick on location alone: an address, placed at
// zip or city precision, inside the radius.
function inRadius(lead, radiusMi) {
  const mi = lead.pickEval?.terms?.distanceMi ?? lead.distanceMi;
  const prec = locationPrecision(lead);
  return !!lead.address && mi != null && mi <= radiusMi && (prec === "zip" || prec === "city");
}

const hasComps = (l) => (Number(l.compsCount) || 0) > 0 || l.compsMedian != null;

// { ok, why[], compsCoverage, inRadius } . `sources` is the scan's per-source
// status array ({ id, status }); missing means "not checked".
export function poolHealth(leads, sources = null, radiusMi = RADIUS_MI) {
  const why = [];
  const pool = (leads || []).filter((l) => inRadius(l, radiusMi));
  const covered = pool.filter(hasComps).length;
  const coverage = pool.length ? covered / pool.length : 0;
  if (!pool.length) why.push("The pool has no leads inside the radius.");
  else if (coverage < MIN_COMPS_COVERAGE)
    why.push(
      `Comps came back for only ${Math.round(coverage * 100)} percent of the ${pool.length} leads inside the radius.`,
    );
  if (Array.isArray(sources)) {
    for (const id of CORE_SOURCES) {
      const s = sources.find((x) => x && x.id === id);
      if (!s) why.push(`The ${id} feed did not report this pass.`);
      else if (s.status !== "ok") why.push(`The ${id} feed is ${s.status}.`);
    }
  }
  return {
    ok: why.length === 0,
    why,
    compsCoverage: Math.round(coverage * 1000) / 1000,
    inRadius: pool.length,
  };
}
