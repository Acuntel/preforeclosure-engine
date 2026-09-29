// Instance profiles. The engine runs ONE profile per process, selected by the
// PROFILE env var (default "z"). A profile decides: which counties are kept,
// which trigger collectors run, where data + run-state persist, the HTTP port,
// and whether new-lead Telegram pings fire.
//
//   PROFILE=z      -> Winnebago + Boone investor "Z" (the original REDLINE)
//   PROFILE=vince  -> Vince: Cook + the collar counties, within 30mi of
//                     his Elmhurst office, value-gap ranked, pings via
//                     @BradyVinceCook_bot
//
// Z's instance is untouched by the Vince work — separate ports, data files,
// state, and county sets.
import { leadDistanceMi, locationPrecision, RADIUS_MI } from "./proximity.js";

const PROFILES = {
  z: {
    name: "z",
    label: "REDLINE — Z (Winnebago + Boone)",
    port: 8787,
    // home turf first; leads outside are dropped
    target: ["Winnebago", "Boone", "McHenry", "Lake", "Kane", "Will"],
    cookMunis: null,
    // null = use the registry default trigger set
    triggers: null,
    ping: false,
    skiptrace: false,
    valueGap: false,
    leadsFile: "leads.json",
    stateFile: ".z-state.json",
  },

  vince: {
    name: "vince",
    label: "Vince — Cook + collar counties (value-gap, quality-gated)",
    port: 8790,
    // Vince's catchment = Cook + the Collar Counties (his words: "everything
    // around Cook" — Lake, Will, DuPage, McHenry, Kane). Rockford/Winnebago is
    // Z's turf and out. Set VINCE_COUNTIES to change.
    target: (process.env.VINCE_COUNTIES || "DuPage,Cook,Lake,Will,Kane,McHenry")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    // Every county is held to VINCE_RADIUS_MI (default 30, D2 2026-09-28) of the
    // Elmhurst office. Cook also drops Chicago proper ("keeps it in pretty good areas").
    // VINCE_COOK_MUNIS pins an explicit suburb whitelist instead; "ALL" opens the
    // whole county including Chicago.
    cookMunis: !process.env.VINCE_COOK_MUNIS
      ? "radius"
      : process.env.VINCE_COOK_MUNIS.trim().toUpperCase() === "ALL"
        ? null
        : process.env.VINCE_COOK_MUNIS.split(",")
            .map((s) => s.trim().toUpperCase())
            .filter(Boolean),
    // Villages Vince won't buy in regardless of radius (Bellwood 2026-07-25:
    // village inspectors are too difficult to deal with). Nearby Northlake and
    // Berkeley stay in scope via the radius rule. VINCE_EXCLUDE_CITIES overrides.
    excludeCities: (process.env.VINCE_EXCLUDE_CITIES || "Bellwood")
      .split(",")
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean),
    // Triggers across metro counties: county sheriff lists (DuPage OCV feed first,
    // Vince's home county) + probate claims notices via Public Notice IL + the
    // statewide judicial-sale feeds + Lake/Will/Cook recorder lis pendens.
    // Retired 2026-09-28: probate-dailyherald (Cloudflare wall), chicago-violations
    // (0 in scope), craigslist-fsbo and recorder-dupage (headed browser, not on Railway).
    triggers: [
      "dupage-sheriff", // DuPage sheriff sales (free OCV JSON feed)
      "probate-pni", // probate claims notices via Public Notice IL
      "tjsc",
      "intercounty",
      "public-notice-il",
      "recorder-lake",
      "recorder-will",
      "recorder-cook",
      "lake-sheriff",
      "will-sheriff",
      "kane-sheriff",
      "mchenry-sheriff",
    ],
    // radius gate for EVERY county (was Cook only; see inScope)
    radius: true,
    ping: true,
    // D6 (2026-09-28): no phone lookups. The card carries name + address; Vince
    // uses Forewarn for the phone.
    skiptrace: false,
    valueGap: true,
    leadsFile: "leads-vince.json",
    stateFile: process.env.VINCE_STATE_FILE || ".vince-state.json",
  },
};

export const PROFILE = PROFILES[process.env.PROFILE || "z"] || PROFILES.z;

// County keep-test for the active profile. Under Vince, every county is held to
// the office radius and Cook also drops Chicago proper (or uses the configured
// whitelist). A lead located only by its county centroid is kept here so the
// assessor enrichment can resolve its city; pick.js enforces the radius on the
// enriched record.
export function inScope(lead) {
  const county = lead.county;
  if (!PROFILE.target.includes(county)) return false;
  const city = String(lead.city || "").toUpperCase();
  if (PROFILE.excludeCities && PROFILE.excludeCities.length) {
    if (PROFILE.excludeCities.some((m) => city.includes(m))) return false;
  }
  if (PROFILE.cookMunis && county === "Cook") {
    if (PROFILE.cookMunis !== "radius")
      return PROFILE.cookMunis.some((m) => city.includes(m));
    if (city.includes("CHICAGO") && !/CHICAGO (HEIGHTS|RIDGE)/.test(city))
      return false;
  }
  if (!PROFILE.radius) return true;
  if (locationPrecision(lead) === "county") return true;
  const mi = leadDistanceMi(lead);
  return mi != null && mi <= RADIUS_MI;
}

// Priority index for sorting (home turf first).
export function priority(county) {
  const i = PROFILE.target.indexOf(county);
  return i < 0 ? 99 : i;
}
