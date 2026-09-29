// Proximity to Vince's home base (Elmhurst) — closer leads get MORE weight, but
// distance is only ever a BONUS: a far lead keeps its full base quality and still
// qualifies; a close lead of equal quality outranks it. Once the close good ones
// are sent, the digest naturally falls back to the farther good ones.
//
// Distance comes from static Census 2024 gazetteer centroids (src/data/il-geo.json,
// no network): lead zip → city name → county seat, whichever resolves first.
//   VINCE_HOME="lat,lng"        override home base (default Elmhurst 60126)
//   VINCE_PROX_MAX_PTS=12      max bonus points at ≤5 mi
//   VINCE_RADIUS_MI=30         the office radius Brady locked 2026-09-28 (D2),
//                              applied to EVERY county in profile.js inScope()
//                              and as a hard gate in pick.js
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const GEO = JSON.parse(
  readFileSync(
    path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      "data",
      "il-geo.json",
    ),
    "utf8",
  ),
);

const HOME = (() => {
  const m = /^(-?[\d.]+)\s*,\s*(-?[\d.]+)$/.exec(process.env.VINCE_HOME || "");
  return m ? [Number(m[1]), Number(m[2])] : GEO.zips["60126"]; // Elmhurst
})();

const MAX_PTS = Number(process.env.VINCE_PROX_MAX_PTS || 12);

// Vince's working radius around the Elmhurst office. Was 20 (Cook only); D2 on
// 2026-09-28 locked 30 mi for every county.
export const RADIUS_MI = Number(process.env.VINCE_RADIUS_MI || 30);

function haversineMi([lat1, lng1], [lat2, lng2]) {
  const r = (d) => (d * Math.PI) / 180;
  const a =
    Math.sin(r(lat2 - lat1) / 2) ** 2 +
    Math.cos(r(lat1)) * Math.cos(r(lat2)) * Math.sin(r(lng2 - lng1) / 2) ** 2;
  return 3958.8 * 2 * Math.asin(Math.sqrt(a));
}

function locate(lead) {
  const zip = String(lead.zip || "").slice(0, 5);
  if (GEO.zips[zip]) return { pt: GEO.zips[zip], precision: "zip" };
  const city = String(lead.city || "").trim().toUpperCase();
  if (GEO.cities[city]) return { pt: GEO.cities[city], precision: "city" };
  const county = String(lead.county || "").trim().toUpperCase();
  if (GEO.counties[county]) return { pt: GEO.counties[county], precision: "county" };
  return null;
}

// Miles from home base, or null if the lead has no resolvable location.
export function leadDistanceMi(lead) {
  const loc = locate(lead);
  return loc ? Math.round(haversineMi(HOME, loc.pt) * 10) / 10 : null;
}

// How precisely the distance is known: "zip" | "city" | "county" | null. A
// county-centroid distance says nothing about the house itself.
export function locationPrecision(lead) {
  return locate(lead)?.precision ?? null;
}

// EV proximity multiplier (spec P0-4). Proximity counts only here.
export function proxFactor(mi) {
  if (mi == null) return 0;
  if (mi <= 10) return 1;
  if (mi <= 20) return 0.9;
  if (mi <= 30) return 0.7;
  return 0.45; // only reachable if VINCE_RADIUS_MI is raised past 30
}

// Bonus points by distance band, peaking inside the office radius. Never
// negative — far/unknown just gets 0 (collar-county leads stay eligible).
export function proximityPoints(mi) {
  if (mi == null) return 0;
  if (mi <= 5) return MAX_PTS;
  if (mi <= 10) return Math.round(MAX_PTS * 0.85);
  if (mi <= RADIUS_MI) return Math.round(MAX_PTS * 0.65);
  if (mi <= 30) return Math.round(MAX_PTS * 0.35);
  if (mi <= 45) return Math.round(MAX_PTS * 0.15);
  return 0;
}
