// Deterministic stand-in for src/pick.js used by the A2 send-path tests. Same
// interface: evaluate, pickDaily, aliasKeys. Env knobs: FAKE_PICK_NONE=1 (no
// lead passes), FAKE_HEALTH_BAD=1 (pool degraded).
export function aliasKeys(l) {
  const c = String(l.county || "").toUpperCase();
  const out = [];
  if (l.caseNumber) out.push(`C:${c}:${String(l.caseNumber).replace(/\W/g, "")}`);
  if (l.address) out.push(`AC:${String(l.address).toUpperCase()}|${String(l.city || "").toUpperCase()}`);
  return out;
}
export const outcomeAliasKeys = (o) => {
  const [a, ...rest] = String(o.address || "").split(",");
  return a ? [`AC:${a.trim().toUpperCase()}|${rest.join(",").trim().toUpperCase()}`] : [];
};
export function buildSentSet(state) {
  const s = new Set(state.sentKeys || []);
  for (const o of Object.values(state.outcomes || {})) for (const k of outcomeAliasKeys(o)) s.add(k);
  return s;
}
export function evaluate(l, ctx = {}) {
  const terms = { market: l.market, marketBasis: "comps", payoff: l.payoff, payoffBasis: "judgment", equity: l.market - l.payoff, equityPct: Math.round(((l.market - l.payoff) / l.market) * 100), confidence: "high", pStage: 1, pContact: 1, pConf: 1, pProx: 1, runwayDays: 30, distanceMi: l.distanceMi, estate: false, stage: "sale_22_90" };
  if (ctx.isSent && ctx.isSent(l)) return { ok: false, gate: "already_sent", ev: 0, terms, reasons: ["Vince already got this property."] };
  if (process.env.FAKE_PICK_NONE === "1") return { ok: false, gate: "small_gap", ev: 0, terms, reasons: ["The equity is only about $20,000, below the bar."] };
  return { ok: true, gate: null, ev: terms.equity, terms, reasons: [`Worth about $${l.market}, owes about $${l.payoff} (judgment), so about $${terms.equity} of equity.`, "The sale is in 30 days.", `It is ${l.distanceMi} miles from the office.`] };
}
export function pickDaily(leads, { isSent, now } = {}) {
  const dropCounts = {};
  const ok = [];
  for (const l of leads) {
    l.pickEval = evaluate(l, { isSent, now });
    if (l.pickEval.ok) ok.push(l);
    else dropCounts[l.pickEval.gate] = (dropCounts[l.pickEval.gate] || 0) + 1;
  }
  ok.sort((a, b) => b.pickEval.ev - a.pickEval.ev);
  const miss = leads.find((l) => l.pickEval.gate === "small_gap");
  const bad = process.env.FAKE_HEALTH_BAD === "1";
  return {
    pick: ok[0] || null,
    runnersUp: ok.slice(1, 6),
    nearMiss: miss ? { lead: miss, gate: "small_gap", reason: miss.pickEval.reasons[0] } : null,
    dropCounts,
    eligibleCount: ok.length,
    health: { ok: !bad, why: bad ? ["Comps came back for only 10 percent of the leads inside the radius."] : [] },
  };
}
export const fakeLeads = () => [
  { county: "DuPage", address: "132 S LINDEN AVE", city: "ELMHURST", owner: "JANE DOE", caseNumber: "26 CH 1", market: 400000, payoff: 150000, distanceMi: 1.2, sale: "2026-10-29" },
  { county: "Cook", address: "1 OAK ST", city: "BERKELEY", owner: "JOHN ROE", caseNumber: "26 CH 2", market: 300000, payoff: 120000, distanceMi: 3.4 },
  { county: "Will", address: "9 ELM RD", city: "JOLIET", owner: "MARY POE", caseNumber: "26 CH 3", market: 250000, payoff: 150000, distanceMi: 25 },
];
