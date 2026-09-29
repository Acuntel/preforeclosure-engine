// Every identity a property has been sent under, so it is never sent twice
// (spec P0-5). All keys are county-scoped; the address key keeps the unit.
import { normAddrUnit, normCase } from "./match.js";

const digits = (v) => String(v || "").replace(/\D/g, "");
const up = (v) =>
  String(v || "")
    .toUpperCase()
    .trim();

// Normalized alias keys for a lead, plus the legacy notify.js leadKey forms so
// the 314 existing sentKeys still match.
export function aliasKeys(lead) {
  const county = lead.county || "";
  const co = up(county);
  const keys = [];
  const ck = normCase(lead.caseNumber);
  if (ck) keys.push(`C:${co}:${ck}`);
  const doc = digits(lead.docNumber);
  if (doc) keys.push(`D:${co}:${doc}`);
  const pin = digits(lead.pin);
  if (pin) keys.push(`P:${co}:${pin}`);
  const addr = normAddrUnit(lead.address);
  if (addr) {
    keys.push(`A:${co}:${addr}`);
    if (lead.city) keys.push(`AC:${addr}|${up(lead.city)}`);
  }
  for (const id of [lead.caseNumber, lead.docNumber, lead.pin])
    if (id) keys.push(`${county}::${up(id)}`);
  if (lead.address)
    keys.push(`${county}::${up(`${lead.address}|${lead.city}`)}`);
  return [...new Set(keys)];
}

// Normalized forms of one legacy sentKey ("Cook::2025 CH 01328",
// "Cook::2616123085", "DuPage::123 MAIN ST|ELMHURST").
export function expandLegacyKey(key) {
  const out = [key];
  const m = /^([^:]*)::(.*)$/.exec(String(key));
  if (!m) return out;
  const [, county, id] = m;
  const co = up(county);
  if (id.includes("|")) {
    const [street, city] = id.split("|");
    const addr = normAddrUnit(street);
    if (addr) {
      out.push(`A:${co}:${addr}`);
      if (city && city !== "UNDEFINED") out.push(`AC:${addr}|${up(city)}`);
    }
    return out;
  }
  const ck = normCase(id);
  if (/^\d{4}[A-Z]{2}\d+$/.test(ck)) out.push(`C:${co}:${ck}`);
  const d = digits(id);
  if (d.length >= 10 && d.length === id.replace(/[\s-]/g, "").length) {
    out.push(`D:${co}:${d}`, `P:${co}:${d}`);
  }
  return out;
}

// Address alias from an outcome record ("4919 CYPRESS DR, HILLSIDE"). Outcomes
// carry no county, so this is the address+city key.
export function outcomeAliasKeys(outcome) {
  const [street, ...rest] = String(outcome?.address || "").split(",");
  const addr = normAddrUnit(street);
  const city = up(rest.join(",")).replace(/\s+/g, " ");
  return addr && city ? [`AC:${addr}|${city}`] : [];
}

// One Set holding every alias of everything already sent.
export function buildSentSet(state = {}) {
  const set = new Set();
  for (const k of state.sentKeys || [])
    for (const x of expandLegacyKey(k)) set.add(x);
  for (const o of Object.values(state.outcomes || {}))
    for (const x of outcomeAliasKeys(o)) set.add(x);
  return set;
}

export const isSentIn = (set) => (lead) =>
  aliasKeys(lead).some((k) => set.has(k));
