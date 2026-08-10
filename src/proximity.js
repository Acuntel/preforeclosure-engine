// Proximity to Vince's home base (Elmhurst) — closer leads get MORE weight, but
// distance is only ever a BONUS: a far lead keeps its full base quality and still
// qualifies; a close lead of equal quality outranks it. Once the close good ones
// are sent, the digest naturally falls back to the farther good ones.
//
// Distance comes from static Census 2024 gazetteer centroids (src/data/il-geo.json,
// no network): lead zip → city name → county seat, whichever resolves first.
//   VINCE_HOME="lat,lng"        override home base (default Elmhurst 60126)
//   VINCE_PROX_MAX_PTS=12      max bonus points at ≤5 mi
//   VINCE_RADIUS_MI=20         the office-radius focus Vince settled on — also
//                              the Cook keep-radius in profile.js inScope()
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

// Vince's working radius around the Elmhurst office ("you probably even have to
// go like 20, because there's not going to be that many").
export const RADIUS_MI = Number(process.env.VINCE_RADIUS_MI || 20);

function haversineMi([lat1, lng1], [lat2, lng2]) {
  const r = (d) => (d * Math.PI) / 180;
  const a =
    Math.sin(r(lat2 - lat1) / 2) ** 2 +
    Math.cos(r(lat1)) * Math.cos(r(lat2)) * Math.sin(r(lng2 - lng1) / 2) ** 2;
  return 3958.8 * 2 * Math.asin(Math.sqrt(a));
}

// Miles from home base, or null if the lead has no resolvable location.
export function leadDistanceMi(lead) {
  const zip = String(lead.zip || "").slice(0, 5);
  const pt =
    GEO.zips[zip] ||
    GEO.cities[
      String(lead.city || "")
        .trim()
        .toUpperCase()
    ] ||
    GEO.counties[
      String(lead.county || "")
        .trim()
        .toUpperCase()
    ];
  return pt ? Math.round(haversineMi(HOME, pt) * 10) / 10 : null;
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
