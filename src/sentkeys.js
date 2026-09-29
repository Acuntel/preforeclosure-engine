// Sent-lead dedupe across every alias of a property (P0-5). A lead counts as
// already sent when ANY of its alias keys (pick.js aliasKeys: case#, doc#, PIN,
// normalized address with unit) or its legacy leadKey is in state.sentKeys.
// That closes the 7 production repeats, where the same house came back under a
// new case or doc number.
import path from "node:path";
import { pathToFileURL } from "node:url";
import { leadKey } from "./vstate.js";

// Always the real src/pick.js. VINCE_PICK_MODULE (a stand-in with the same
// interface) is honored ONLY when VINCE_TEST=1, so a stray env var can never
// swap the production picker.
export async function loadPick() {
  const p = process.env.VINCE_PICK_MODULE;
  if (p && process.env.VINCE_TEST === "1")
    return import(pathToFileURL(path.resolve(p)).href);
  if (p) console.error("VINCE_PICK_MODULE is ignored outside tests (VINCE_TEST=1).");
  return import("./pick.js");
}

export function allKeys(pick, l) {
  let aliases = [];
  try {
    aliases = pick.aliasKeys(l) || [];
  } catch {}
  return [...new Set([...aliases, leadKey(l)])];
}

export const makeIsSent = (pick, sentSet) => (l) =>
  allKeys(pick, l).some((k) => sentSet.has(k));

// The set every lead is checked against. pick.js buildSentSet() also expands
// the legacy production keys ("Cook::25 CH 6934") into their normalized forms
// and adds every outcome's address+city key.
export function sentSetFor(pick, state) {
  if (typeof pick.buildSentSet === "function") {
    const set = pick.buildSentSet(state);
    for (const k of state.sentKeys || []) set.add(k);
    return set;
  }
  return new Set(state.sentKeys || []);
}

const COUNTIES = ["Cook", "DuPage", "Lake", "Will", "Kane", "McHenry"];

// Address aliases of one outcome ("ADDRESS, CITY", no county). Uses pick.js
// outcomeAliasKeys() when present; otherwise builds the county-scoped address
// alias for every county Vince covers (only the right county can ever match).
export function outcomeAliases(pick, o, counties = COUNTIES) {
  if (typeof pick.outcomeAliasKeys === "function") {
    try {
      return pick.outcomeAliasKeys(o) || [];
    } catch {
      return [];
    }
  }
  const raw = String(o?.address || "");
  const i = raw.lastIndexOf(",");
  const address = (i > 0 ? raw.slice(0, i) : raw).trim();
  const city = i > 0 ? raw.slice(i + 1).trim() : "";
  if (!address) return [];
  const out = [];
  for (const county of counties) {
    try {
      out.push(...(pick.aliasKeys({ address, city, county }) || []));
    } catch {}
  }
  return out;
}

// One-time backfill of address aliases from existing outcomes (306 in prod)
// into state.sentKeys. Re-runs only if ALIAS_VERSION changes. Returns keys added.
export const ALIAS_VERSION = 1;
export function backfillAliases(state, pick, { force = false } = {}) {
  const mark = state.aliasBackfill;
  if (!force && mark && mark.version === ALIAS_VERSION) return 0;
  const sent = new Set(state.sentKeys || []);
  const before = sent.size;
  for (const o of Object.values(state.outcomes || {}))
    for (const k of outcomeAliases(pick, o)) sent.add(k);
  state.sentKeys = [...sent];
  state.aliasBackfill = {
    version: ALIAS_VERSION,
    at: new Date().toISOString(),
    outcomes: Object.keys(state.outcomes || {}).length,
    added: sent.size - before,
  };
  return sent.size - before;
}
