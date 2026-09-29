// DuPage cancellation signal (spec P1-2). The DuPage sheriff feed drops a case
// when the sale is cancelled. A case# seen on an earlier pass whose sale date has
// not arrived, and which is now gone from the feed, is remembered in state and
// every pool lead carrying that case# (Intercounty often keeps listing it) gets a
// "Cancelled" status, so the pick.js dead_status gate drops it.
//
// Only a healthy feed updates the memory: a blocked pass, or a pass that returns
// under half of the previous list, is ignored so a flaky fetch never "cancels"
// every sale in the county.
import { normCase } from "./match.js";
import { loadState, saveState } from "./vstate.js";

export const CANCEL_STATUS = "Cancelled (left the DuPage sheriff list)";
const SRC = "dupage-sheriff";
const KEEP_DAYS = 30;

const isSheriff = (l) =>
  l._src === SRC || (Array.isArray(l.sources) && l.sources.includes(SRC));
const key = (l) => (l.county === "DuPage" ? normCase(l.caseNumber) : null);
const minusDays = (day, n) =>
  new Date(Date.parse(`${day}T00:00:00Z`) - n * 864e5)
    .toISOString()
    .slice(0, 10);

// Mutates state (dupageCases, dupageCancelled) and the pool leads. Returns
// { vanished: [case#], flagged: n, updated: boolean }.
export function applyDupageCancellations(state, result, today) {
  const leads = result?.leads || [];
  const src = (result?.sources || []).find((s) => s && s.id === SRC);
  const cancelled = { ...(state.dupageCancelled || {}) };
  const current = leads
    .filter(isSheriff)
    .map((l) => ({ caseNumber: key(l), sale: l.sale || null }))
    .filter((c) => c.caseNumber);
  const prev = state.dupageCases || [];
  const vanished = [];
  const healthy =
    src && src.status === "ok" && current.length >= prev.length * 0.5;
  if (healthy) {
    const now = new Set(current.map((c) => c.caseNumber));
    for (const p of prev) {
      if (!p.caseNumber || !p.sale || p.sale < today || now.has(p.caseNumber))
        continue;
      if (!cancelled[p.caseNumber]) vanished.push(p.caseNumber);
      cancelled[p.caseNumber] = cancelled[p.caseNumber] || {
        sale: p.sale,
        at: today,
      };
    }
    for (const c of now) delete cancelled[c]; // back on the list: not cancelled
    state.dupageCases = current;
  }
  const floor = minusDays(today, KEEP_DAYS);
  for (const [k, v] of Object.entries(cancelled))
    if ((v.sale || v.at) < floor) delete cancelled[k];
  state.dupageCancelled = cancelled;

  let flagged = 0;
  for (const l of leads) {
    const k = key(l);
    if (!k || !cancelled[k]) continue;
    const st = l.statuses || [];
    if (!st.includes(CANCEL_STATUS)) l.statuses = [...st, CANCEL_STATUS];
    flagged++;
  }
  return { vanished, flagged, updated: !!healthy };
}

// Live-loop wrapper: load state, apply, save when the memory changed.
export function syncDupageCancellations(stateFile, result, today) {
  const state = loadState(stateFile);
  const r = applyDupageCancellations(state, result, today);
  if (r.updated || r.flagged) saveState(stateFile, state);
  return r;
}
