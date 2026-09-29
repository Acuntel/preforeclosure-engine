// Acceptance checks against the real production archives (gitignored, local
// only). Skips cleanly when data/prod-archives is absent.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

process.env.PROFILE = "vince";
delete process.env.VINCE_RADIUS_MI;
const { pickDaily, buildSentSet, isSentIn } = await import("../src/pick.js");

const DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "data",
  "prod-archives",
);
const POOL = path.join(DIR, "leads-vince-2026-09-28.json");
const STATE = path.join(DIR, "vince-state-2026-09-28.json");
const have = fs.existsSync(POOL) && fs.existsSync(STATE);
const skip = have ? false : "data/prod-archives not present";
const NOW = new Date("2026-09-29T15:00:00Z"); // next digest, 10:00 Chicago

const load = (f) => JSON.parse(fs.readFileSync(f, "utf8"));
let cached;
function run() {
  if (cached) return cached;
  const pool = load(POOL);
  const isSent = isSentIn(buildSentSet(load(STATE)));
  const res = pickDaily(pool.leads, {
    now: NOW,
    isSent,
    sources: pool.sources,
  });
  cached = { leads: pool.leads, res, isSent };
  return cached;
}
const find = (leads, re, city) =>
  leads.filter(
    (l) =>
      re.test(l.address || "") &&
      (!city || new RegExp(city, "i").test(l.city || "")),
  );

test(
  "09-28 pool: the 8 must-exclude addresses are all excluded",
  { skip },
  () => {
    const { leads } = run();
    const cases = [
      [/^61 PIER DR/i, "WESTMONT", "dead_status"],
      [/^2310 CUYLER/i, "BERWYN", "dead_status"],
      [/^791 DERBY/i, "ANTIOCH", "dead_status"],
      [/^905 WINTHROP/i, "ZION", "short_runway"],
      [/^9 N 5TH AVE/i, "MAYWOOD", "entity_owner"],
      [/^1209 S 15TH AVE/i, "MAYWOOD", "short_runway"],
      [/^2305 SANDERS/i, "NORTHBROOK", "entity_owner"],
      [/^426 HAMILTON/i, "EVANSTON", "entity_owner"],
    ];
    for (const [re, city, gate] of cases) {
      const hits = find(leads, re, city);
      assert.ok(hits.length > 0, `${re} not in pool`);
      for (const l of hits) {
        assert.equal(l.pickEval.ok, false, `${l.address} should be excluded`);
        assert.equal(
          l.pickEval.gate,
          gate,
          `${l.address}: ${l.pickEval.reasons[0]}`,
        );
      }
    }
  },
);

test(
  "fake gaps are gone: 1826 S 13th Ave Broadview and 4125 Konrad Ave Lyons",
  { skip },
  () => {
    const { leads } = run();
    for (const [re, city, fake] of [
      [/^1826 S 13TH AVE/i, "BROADVIEW", 721000],
      [/^4125 KONRAD/i, "LYONS", 381000],
    ]) {
      const [l] = find(leads, re, city);
      assert.ok(l, `${re} not in pool`);
      const t = l.pickEval.terms;
      assert.equal(
        t.marketBasis,
        "assessor",
        `${l.address} still trusts the multi-PIN comps`,
      );
      assert.ok(t.compsEvents < 5);
      assert.ok(
        t.equity == null || t.equity < fake / 2,
        `${l.address} equity ${t.equity}`,
      );
      assert.equal(l.pickEval.ok, false);
    }
  },
);

test("the 7 known repeat addresses read as already sent", { skip }, () => {
  const { isSent } = run();
  const repeats = [
    ["409 ENGLEWOOD AVE", "HILLSIDE"],
    ["1776 STOCKTON AVE", "DES PLAINES"],
    ["4627 CUSTER AVE", "LYONS"],
    ["1906 S 7TH AVE", "MAYWOOD"],
    ["3318 EAST AVE", "BERWYN"],
    ["9807 N GREENWOOD AVE", "NILES"],
    ["630 W GLENCOE RD", "PALATINE"],
  ];
  for (const [address, city] of repeats)
    assert.equal(
      isSent({ county: "Cook", address, city, caseNumber: "2099CH1" }),
      true,
      address,
    );
});

test(
  "will-sheriff leads with a judgment use the judgment payoff",
  { skip },
  () => {
    const { leads } = run();
    const will = leads.filter(
      (l) => (l.sources || []).includes("will-sheriff") && l.judgment,
    );
    assert.ok(will.length > 10);
    for (const l of will)
      assert.equal(l.pickEval.terms.payoffBasis, "judgment", l.address);
  },
);

test(
  "no eligible lead shows a guessed cost at medium confidence",
  { skip },
  () => {
    const { leads, res } = run();
    assert.ok(res.pick, "expected a pick on 09-28");
    for (const l of leads.filter((x) => x.pickEval.ok)) {
      const t = l.pickEval.terms;
      assert.ok(
        !(t.payoffBasis === "last sale" && t.confidence !== "low"),
        l.address,
      );
      assert.ok(t.equity > 0 && t.distanceMi <= 30, l.address);
    }
  },
);

test(
  "backtest over every archive: no dead, past, far or unknown-gap picks",
  { skip },
  () => {
    const files = fs
      .readdirSync(DIR)
      .filter((f) => /^leads-vince-\d{4}-\d{2}-\d{2}\.json$/.test(f))
      .sort();
    assert.ok(files.length >= 53);
    const state = load(STATE);
    const picked = new Set();
    let picks = 0;
    for (const f of files) {
      const day = f.slice(12, 22);
      const outcomes = Object.fromEntries(
        Object.entries(state.outcomes).filter(([, o]) => o.date <= day),
      );
      const base = isSentIn(buildSentSet({ outcomes }));
      const isSent = (l) => base(l) || picked.has(`${l.address}|${l.city}`);
      const now = new Date(Date.parse(`${day}T15:00:00Z`) + 864e5);
      const { pick } = pickDaily(load(path.join(DIR, f)).leads, {
        now,
        isSent,
      });
      if (!pick) continue;
      picks++;
      picked.add(`${pick.address}|${pick.city}`);
      const t = pick.pickEval.terms;
      const statuses = [pick.status, ...(pick.statuses || [])]
        .filter(Boolean)
        .join(" ");
      assert.doesNotMatch(
        statuses,
        /cancel|plaintiff|third party|sold|vacat|dismiss/i,
        `${day} ${pick.address}`,
      );
      assert.ok(
        t.runwayDays == null || t.runwayDays >= 10,
        `${day} ${pick.address} runway ${t.runwayDays}`,
      );
      assert.ok(
        t.distanceMi != null && t.distanceMi <= 30,
        `${day} ${pick.address}`,
      );
      assert.ok(t.equity > 0, `${day} ${pick.address}`);
      const backed =
        ["judgment", "opening bid"].includes(t.payoffBasis) ||
        t.marketBasis === "comps" ||
        t.probatePath;
      assert.ok(backed, `${day} ${pick.address} gap not backed`);
      assert.ok(
        ["person", "estate"].includes(t.ownerKind),
        `${day} ${pick.address}`,
      );
    }
    assert.ok(picks >= 45, `only ${picks} picks`);
  },
);
