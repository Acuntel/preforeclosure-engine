// Instance profiles. The engine runs ONE profile per process, selected by the
// PROFILE env var (default "z"). A profile decides: which counties are kept,
// which trigger collectors run, where data + run-state persist, the HTTP port,
// and whether new-lead Telegram pings fire.
//
//   PROFILE=z      -> Winnebago + Boone investor "Z" (the original REDLINE)
//   PROFILE=vince  -> Vince: Cook + the collar counties, focused ~20mi around
//                     his Elmhurst office, value-gap ranked, pings via
//                     @BradyVinceCook_bot
//
// Z's instance is untouched by the Vince work — separate ports, data files,
// state, and county sets.
import { leadDistanceMi, RADIUS_MI } from "./proximity.js";

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
    // Cook is huge — by default keep suburbs within VINCE_RADIUS_MI (20) of the
    // Elmhurst office, Chicago proper excluded ("keeps it in pretty good areas").
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
    // Triggers across metro counties: DuPage recorder LP (earliest) + statewide
    // judicial-sale feeds + county sheriff lists + Lake/Will recorder LP.
    triggers: [
      "probate-dailyherald", // Vince's #1 signal — dead-owner / heir estates
      "chicago-violations", // dilapidated / distressed houses (code violations)
      "craigslist-fsbo", // for-sale-by-owner (asking price = the cost)
      "recorder-dupage",
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
    ping: true,
    skiptrace: true,
    valueGap: true,
    leadsFile: "leads-vince.json",
    stateFile: process.env.VINCE_STATE_FILE || ".vince-state.json",
  },
};

export const PROFILE = PROFILES[process.env.PROFILE || "z"] || PROFILES.z;

// County keep-test for the active profile. For Cook under the Vince profile,
// keep suburbs within the office radius (default) or the configured whitelist;
// Chicago proper only enters via VINCE_COOK_MUNIS=ALL.
export function inScope(lead) {
  const county = lead.county;
  if (!PROFILE.target.includes(county)) return false;
  if (PROFILE.excludeCities && PROFILE.excludeCities.length) {
    const city = String(lead.city || "").toUpperCase();
    if (PROFILE.excludeCities.some((m) => city.includes(m))) return false;
  }
  if (PROFILE.cookMunis && county === "Cook") {
    const city = String(lead.city || "").toUpperCase();
    if (PROFILE.cookMunis === "radius") {
      if (city.includes("CHICAGO")) return false;
      const mi = leadDistanceMi(lead);
      return mi != null && mi <= RADIUS_MI;
    }
    return PROFILE.cookMunis.some((m) => city.includes(m));
  }
  return true;
}

// Priority index for sorting (home turf first).
export function priority(county) {
  const i = PROFILE.target.indexOf(county);
  return i < 0 ? 99 : i;
}
