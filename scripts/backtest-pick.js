// Backtest the one-a-day picker over the archived daily pools (P0-1).
//
//   node scripts/backtest-pick.js <archiveDir> <stateFile> [--json out.json]
//
// <archiveDir> holds leads-vince-YYYY-MM-DD.json (end-of-day pools), <stateFile>
// is a production state file (read only). Days run in date order at about 10am
// Chicago. The sent set starts from what Vince had been sent BEFORE the first
// archive date (the address aliases of outcomes dated earlier; the production
// sentKeys carry no dates, so they cannot be split) and then grows by each
// simulated pick. The "prod" column is what production actually sent that day.
// Never writes state, never sends. Uses the real src/pick.js.
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";

process.env.PROFILE = "vince";
process.env.VINCE_PING_OFF = "1";
process.env.VINCE_EMAIL_OFF = "1";

const [archiveDir, stateFile] = process.argv.slice(2);
if (!archiveDir || !stateFile) {
  console.error(
    "usage: node scripts/backtest-pick.js <archiveDir> <stateFile> [--json out.json]",
  );
  process.exit(2);
}
const jsonIdx = process.argv.indexOf("--json");
const jsonOut = jsonIdx > 0 ? process.argv[jsonIdx + 1] : null;

const { loadPick, allKeys, makeIsSent, sentSetFor } =
  await import("../src/sentkeys.js");
const pick = await loadPick();
const radius = Number(process.env.VINCE_RADIUS_MI || 30);

const state = JSON.parse(readFileSync(stateFile, "utf8"));
const outcomes = Object.values(state.outcomes || {});
const files = readdirSync(archiveDir)
  .map((f) => /^leads-vince-(\d{4}-\d{2}-\d{2})\.json$/.exec(f))
  .filter(Boolean)
  .map((m) => ({ date: m[1], file: path.join(archiveDir, m[0]) }))
  .sort((a, b) => (a.date < b.date ? -1 : 1));
if (!files.length) {
  console.error(`no leads-vince-YYYY-MM-DD.json files in ${archiveDir}`);
  process.exit(1);
}

const first = files[0].date;
const prior = outcomes.filter((o) => o.date && o.date < first);
const sim = sentSetFor(pick, {
  sentKeys: [],
  outcomes: Object.fromEntries(prior.map((o, i) => [i, o])),
});
console.log(
  `backtest ${files.length} days ${first} to ${files.at(-1).date}; sent set starts from ${prior.length} outcomes dated before ${first} (${sim.size} alias keys)\n`,
);

const pad = (v, n) =>
  String(v ?? "")
    .slice(0, n)
    .padEnd(n);
const rpad = (v, n) =>
  String(v ?? "")
    .slice(0, n)
    .padStart(n);
const k = (n) => (n == null ? "?" : `$${Math.round(n / 1000)}k`);
const norm = (s) =>
  String(s || "")
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
const head = [
  pad("date", 10),
  pad("address", 28),
  pad("city", 14),
  rpad("mi", 5),
  rpad("equity", 7),
  pad(" payoff", 12),
  pad("conf", 7),
  rpad("runway", 6),
  rpad("EV", 7),
  "  prod sent that day",
];
console.log(head.join(" "));
console.log("-".repeat(140));

const totals = {};
const rows = [];
const checks = {
  days: 0,
  picks: 0,
  noDeal: 0,
  degraded: 0,
  pastSale: 0,
  beyondRadius: 0,
  badGap: 0,
  repeats: 0,
  deadStatus: 0,
  entityOwner: 0,
  unbacked: 0,
  prodPriorSent: 0,
  errors: 0,
};
const pickedAddrs = new Set();
for (const { date, file } of files) {
  checks.days++;
  let pool;
  try {
    pool = JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    checks.errors++;
    console.log(`${date} ERROR reading archive: ${e.message}`);
    continue;
  }
  const leads = Array.isArray(pool) ? pool : pool.leads || [];
  const now = new Date(`${date}T15:00:00Z`); // about 10am Chicago
  let r;
  try {
    r = pick.pickDaily(leads, {
      isSent: makeIsSent(pick, sim),
      now,
      sources: pool.sources,
    });
  } catch (e) {
    checks.errors++;
    console.log(`${date} ERROR in pickDaily: ${e.message}`);
    continue;
  }
  for (const [g, n] of Object.entries(r.dropCounts || {}))
    totals[g] = (totals[g] || 0) + n;
  if (!r.health?.ok) checks.degraded++;
  const prodToday = outcomes
    .filter((o) => o.date === date)
    .map((o) => o.address);
  const prod = `${prodToday.length}: ${prodToday.join("; ")}`;
  const l = r.pick;
  if (!l) {
    checks.noDeal++;
    const nm = r.nearMiss?.lead
      ? `${r.nearMiss.lead.address}, ${r.nearMiss.lead.city} [${r.nearMiss.gate}]`
      : "none";
    console.log(
      `${pad(date, 10)} ${pad("NO DEAL  closest miss: " + nm, 97)}  ${prod}`,
    );
    rows.push({
      date,
      pick: null,
      nearMiss: nm,
      health: r.health,
      prod: prodToday,
    });
    continue;
  }
  checks.picks++;
  const t = l.pickEval?.terms || {};
  for (const key of allKeys(pick, l)) sim.add(key);
  const a = norm(`${l.address} ${l.city}`);
  if (pickedAddrs.has(a)) checks.repeats++;
  pickedAddrs.add(a);
  if (t.runwayDays != null && t.runwayDays < 0) checks.pastSale++;
  if ((t.distanceMi ?? l.distanceMi ?? 999) > radius) checks.beyondRadius++;
  if (!(t.equity > 0)) checks.badGap++;
  // spec section 5: dead status on any merged source, entity owner, and a gap
  // backed by a judgment or bid, anchor-agreeing comps, or the probate path
  const statuses = [l.status, ...(l.statuses || [])].filter(Boolean).map(String);
  if (statuses.some((s) => pick.DEAD_STATUS.test(s))) checks.deadStatus++;
  if (t.ownerKind === "entity" || t.ownerKind === "gov") checks.entityOwner++;
  const backed =
    t.probatePath ||
    t.payoffBasis === "judgment" ||
    t.payoffBasis === "opening bid" ||
    (t.marketBasis === "comps" && t.anchor != null);
  if (!backed) checks.unbacked++;
  const prior = outcomes.some(
    (o) => o.date < date && norm(o.address.replace(",", " ")) === a,
  );
  if (prior) checks.prodPriorSent++;
  const flag = `${r.health?.ok ? "" : "!"}${prior ? "*" : ""}`;
  console.log(
    [
      pad(date, 10),
      pad(flag + l.address, 28),
      pad(l.city, 14),
      rpad(t.distanceMi ?? l.distanceMi, 5),
      rpad(k(t.equity), 7),
      pad(" " + (t.payoffBasis ?? "?"), 12),
      pad(t.confidence, 7),
      rpad(t.runwayDays ?? "none", 6),
      rpad(k(l.pickEval?.ev), 7),
      " ",
      prod,
    ].join(" "),
  );
  rows.push({
    date,
    pick: {
      address: l.address,
      city: l.city,
      county: l.county,
      owner: l.owner,
      eval: l.pickEval,
    },
    health: r.health,
    prod: prodToday,
    prodPriorSent: prior,
  });
}

console.log("-".repeat(140));
console.log(
  "flags: ! = pool health degraded that day (live digest would defer to the cutoff), * = production had already sent this address on an earlier day",
);
console.log(
  `\ngate drops over all days: ${Object.entries(totals)
    .sort((a, b) => b[1] - a[1])
    .map(([g, n]) => `${g} ${n}`)
    .join(", ")}`,
);
console.log(
  `days ${checks.days} · picks ${checks.picks} · no-deal days ${checks.noDeal} · degraded-pool days ${checks.degraded} · errors ${checks.errors}`,
);
console.log(
  `checks: past-sale picks ${checks.pastSale} · dead status ${checks.deadStatus} · beyond ${radius} mi ${checks.beyondRadius} · entity owner ${checks.entityOwner} · unknown or non-positive gap ${checks.badGap} · gap not backed ${checks.unbacked} · repeated address ${checks.repeats} · already sent by production earlier ${checks.prodPriorSent}`,
);
if (jsonOut) {
  writeFileSync(jsonOut, JSON.stringify({ checks, totals, rows }, null, 2));
  console.log(`json: ${jsonOut}`);
}
