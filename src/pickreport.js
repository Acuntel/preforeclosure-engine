// Terminal reporting for the picker: the --dry-run printout and the backtest
// table share these. Read-only: nothing here writes state or sends.
import {
  formatLeadName,
  formatLeadDetails,
  formatNoDeal,
  stripHtml,
} from "./cards.js";

const $k = (n) =>
  n == null ? "?" : `$${Math.round(n / 1000).toLocaleString("en-US")}k`;
const f2 = (n) => (n == null ? "?" : Number(n).toFixed(2));
export const addrOf = (l) => [l?.address, l?.city].filter(Boolean).join(", ");

// Every EV term of one evaluated lead, on one line.
export function evalLine(l) {
  const e = l.pickEval || {};
  const t = e.terms || {};
  return [
    `EV ${$k(e.ev)}`,
    `equity ${$k(t.equity)}${t.equityPct != null ? ` (${t.equityPct}%)` : ""}`,
    `market ${$k(t.market)} [${t.marketBasis ?? "?"}]`,
    `payoff ${$k(t.payoff)} [${t.payoffBasis ?? "?"}]`,
    `conf ${t.confidence ?? "?"}`,
    `pStage ${f2(t.pStage)} pContact ${f2(t.pContact)} pConf ${f2(t.pConf)} pProx ${f2(t.pProx)}`,
    t.runwayDays == null ? "no sale date" : `runway ${t.runwayDays}d`,
    `${t.distanceMi ?? l.distanceMi ?? "?"} mi`,
    `stage ${t.stage ?? l.stage ?? "?"}${t.estate ? " estate" : ""}`,
  ].join(" | ");
}

export function dropLine(dropCounts = {}) {
  return (
    Object.entries(dropCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([g, n]) => `${g} ${n}`)
      .join(", ") || "none"
  );
}

// The full dry-run report for one pickDaily result.
export function dryRunReport(r, { poolSize, eligible, cutoffHour, hour } = {}) {
  const out = [];
  out.push(`pool ${poolSize} leads, ${eligible} pass every gate`);
  out.push(`gate drops: ${dropLine(r.dropCounts)}`);
  out.push(
    `pool health: ${r.health?.ok ? "ok" : `DEGRADED (${(r.health?.why || []).join("; ")})`}`,
  );
  if (r.health && !r.health.ok)
    out.push(
      hour != null && hour >= cutoffHour
        ? `  past the ${cutoffHour}:00 cutoff, so the live digest would decide now`
        : `  the live digest would defer until a healthy pass or the ${cutoffHour}:00 cutoff`,
    );
  out.push("");
  if (r.pick) {
    out.push(
      `#1 PICK  ${addrOf(r.pick)} (${r.pick.county}), owner ${r.pick.owner || "?"}`,
    );
    out.push(`   ${evalLine(r.pick)}`);
    for (const s of r.pick.pickEval?.reasons || []) out.push(`   > ${s}`);
  } else
    out.push("#1 PICK  none: the live digest would send the no-deal message");
  (r.runnersUp || []).slice(0, 5).forEach((l, i) => {
    out.push(
      `#${i + 2}      ${addrOf(l)} (${l.county}), owner ${l.owner || "?"}`,
    );
    out.push(`   ${evalLine(l)}`);
  });
  if (r.nearMiss?.lead)
    out.push(
      `near miss: ${addrOf(r.nearMiss.lead)} [${r.nearMiss.gate}] ${r.nearMiss.reason || ""}`,
    );
  out.push("");
  out.push("── message that would be sent (not sent: dry run) ──");
  if (r.pick) {
    out.push(stripHtml(formatLeadName(r.pick)));
    out.push(stripHtml(formatLeadDetails(r.pick)));
  } else out.push(stripHtml(formatNoDeal(r.nearMiss)));
  return out.join("\n");
}
