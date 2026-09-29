// Picker EV terms, estate and probate paths, ranking, near-miss and pool health. Run: node --test test/*.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { NOW, DASHES, comps, good } from "./fixtures/pick-lead.js";

const { evaluate, pickDaily, noDealMessage } = await import("../src/pick.js");
const ev = (lead, ctx = {}) => evaluate(lead, { now: NOW, ...ctx });

test("estate markers (P1-1) set estate and add x1.15", () => {
  for (const o of [
    "UNKNOWN HEIRS AND LEGATEES OF JOHN DOE",
    "ESTATE OF MARY ROE",
    "SHEMECHKO JOHN L EST",
    "JANE DOE, SPECIAL REPRESENTATIVE",
    "JOHN DOE, DECEASED",
  ]) {
    const e = ev(good({ owner: o }));
    assert.equal(e.terms.estate, true, o);
    assert.equal(e.terms.pStage, 1.15, o);
    assert.equal(e.ok, true, o);
  }
});

test("estate in the lender field swaps in as owner", () => {
  const e = ev(good({ owner: "UNKNOWN", lender: "SHEMECHKO JOHN L EST" }));
  assert.equal(e.ok, true);
  assert.equal(e.terms.owner, "SHEMECHKO JOHN L EST");
  assert.equal(e.terms.estate, true);
});

test("probate path (P1-3): estate, no debt figure, old purchase qualifies", () => {
  const lead = good({
    owner: "ESTATE OF MARY ROE",
    judgment: null,
    lastSaleDate: "2004-06-01",
    lastSalePrice: 150000,
    comps: [],
    compsCount: 0,
    compsMedian: null,
    sale: null,
    assessed: 150000,
  });
  const e = ev(lead); // anchor 450k, big enough to clear the VINCE_MIN_EV floor
  assert.equal(e.ok, true, e.reasons.join(" "));
  assert.equal(e.terms.probatePath, true);
  assert.equal(e.terms.payoffBasis, "probate estimate");
  assert.equal(e.terms.equity, 180000);
  assert.equal(e.terms.confidence, "low");
  assert.ok(e.reasons.some((r) => /assume about 40 percent equity/.test(r)));
});

test("a small probate estimate falls under the EV floor and reads as low_ev", () => {
  const e = ev(
    good({
      owner: "ESTATE OF MARY ROE",
      judgment: null,
      lastSaleDate: "2004-06-01",
      lastSalePrice: 150000,
      comps: [],
      compsCount: 0,
      compsMedian: null,
      sale: null,
      assessed: 70000,
    }),
  );
  assert.equal(e.gate, "low_ev");
  assert.doesNotMatch(e.reasons[0], /[\u2013\u2014]/);
});

test("probate path: below the value floor or a recent purchase does not qualify", () => {
  const base = {
    owner: "ESTATE OF MARY ROE",
    judgment: null,
    comps: [],
    compsCount: 0,
    compsMedian: null,
    sale: null,
  };
  assert.equal(
    ev(
      good({
        ...base,
        assessed: 40000,
        lastSaleDate: "2004-06-01",
        lastSalePrice: 90000,
      }),
    ).gate,
    "no_gap",
  );
  // foreclosure estate with no purchase history: a mortgage is on record
  assert.equal(ev(good({ ...base, assessed: 70000 })).gate, "no_gap");
  // pure probate notice, no mortgage info: qualifies
  const p = ev({
    county: "DuPage",
    address: "347 GALWAY CT",
    city: "BLOOMINGDALE",
    zip: "60108",
    decedent: "PATRICIA M CERAMI",
    sources: ["probate-pni"],
    signal: "probate",
    caseNumber: "2026PR000566",
    assessed: 90000,
  });
  assert.equal(p.ok, true, p.reasons.join(" "));
  assert.equal(p.terms.stage, "probate");
});

test("reasons are plain sentences with no em or en dashes", () => {
  const e = ev(good({ owner: "UNKNOWN HEIRS OF JOHN DOE & SECRETARY OF HUD" }));
  assert.ok(e.reasons.length >= 4);
  for (const r of e.reasons) {
    assert.ok(!DASHES.test(r), r);
    assert.match(r, /\.$/);
  }
  assert.match(
    e.reasons[0],
    /^Worth about \$331,000, owes about \$124,000 \(the court judgment plus 10 percent\)/,
  );
});

test("pickDaily ranks by EV, caps runners-up at 5, annotates every lead", () => {
  const leads = [
    good({ address: "1 A ST", judgment: 200000 }),
    good({ address: "2 B ST", judgment: 100000 }),
    good({
      address: "3 C ST",
      city: "ELMHURST",
      zip: "60126",
      county: "DuPage",
      judgment: 110000,
    }),
    ...Array.from({ length: 6 }, (_, i) =>
      good({ address: `${10 + i} D ST`, judgment: 150000 + i * 1000 }),
    ),
    good({ address: "99 X ST", status: "Cancelled" }),
  ];
  const r = pickDaily(leads, { now: NOW });
  assert.equal(r.pick.address, "3 C ST"); // closer beats a slightly bigger gap
  assert.equal(r.runnersUp.length, 5);
  assert.ok(leads.every((l) => l.pickEval));
  assert.equal(r.dropCounts.dead_status, 1);
  const evs = [r.pick, ...r.runnersUp].map((l) => l.pickEval.ev);
  assert.deepEqual(
    evs,
    [...evs].sort((a, b) => b - a),
  );
});

test("tie-break: runway nearest 21 to 45 days, then distance", () => {
  const a = good({ address: "1 A ST", sale: "2026-12-20" }); // 82 days, same EV
  const b = good({ address: "2 B ST", sale: "2026-11-05" }); // 37 days
  const r = pickDaily([a, b], { now: NOW });
  assert.equal(r.pick.address, "2 B ST");
});

test("no-deal day: nearMiss and the D4 message", () => {
  const r = pickDaily(
    [
      good({ sale: "2026-10-03" }),
      good({ address: "5 E ST", owner: "ACME LLC" }),
    ],
    { now: NOW },
  );
  assert.equal(r.pick, null);
  assert.equal(r.nearMiss.gate, "short_runway");
  const msg = noDealMessage(r);
  assert.match(
    msg,
    /^No deal worth your time today\. Closest miss: 702 HALSTEAD AVE, ROMEOVILLE\. The sale is only 4 days away/,
  );
  assert.ok(!DASHES.test(msg));
  assert.equal(
    noDealMessage({ nearMiss: null }),
    "No deal worth your time today.",
  );
});

test("pool health: comps coverage under 50 percent or a blocked core feed", () => {
  const withComps = Array.from({ length: 4 }, (_, i) =>
    good({ address: `${i + 1} F ST` }),
  );
  const noComps = Array.from({ length: 6 }, (_, i) =>
    good({
      address: `${i + 20} G ST`,
      comps: [],
      compsCount: 0,
      compsMedian: null,
    }),
  );
  const bad = pickDaily([...withComps, ...noComps], { now: NOW });
  assert.equal(bad.health.ok, false);
  assert.match(bad.health.why[0], /40 percent/);
  const okSources = [
    { id: "tjsc", status: "ok" },
    { id: "intercounty", status: "ok" },
    { id: "recorder-cook", status: "ok" },
  ];
  assert.equal(
    pickDaily(withComps, { now: NOW, sources: okSources }).health.ok,
    true,
  );
  const blocked = okSources.map((s) =>
    s.id === "tjsc" ? { ...s, status: "blocked" } : s,
  );
  const h = pickDaily(withComps, { now: NOW, sources: blocked }).health;
  assert.equal(h.ok, false);
  assert.match(h.why.join(" "), /tjsc feed is blocked/);
});

