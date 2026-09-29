// Picker hard gates (spec P0-3) and value-backed eligibility. Run: node --test test/*.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { NOW, DASHES, comps, good } from "./fixtures/pick-lead.js";

const { evaluate, pickDaily, noDealMessage } = await import("../src/pick.js");
const ev = (lead, ctx = {}) => evaluate(lead, { now: NOW, ...ctx });

test("a clean judgment-backed lead passes with high confidence", () => {
  const e = ev(good());
  assert.equal(e.ok, true, e.reasons.join(" "));
  assert.equal(e.gate, null);
  assert.equal(e.terms.payoffBasis, "judgment");
  assert.equal(e.terms.payoff, 124300);
  assert.equal(e.terms.marketBasis, "comps");
  assert.equal(e.terms.confidence, "high");
  assert.equal(e.terms.runwayDays, 30);
  assert.equal(e.terms.pStage, 1);
  assert.equal(e.terms.pProx, 0.9); // 19.9 mi
  assert.equal(e.ev, Math.round((331000 - 124300) * 1 * 1 * 1 * 0.9));
});

test("gate dead_status: cancelled, to plaintiff, third party, sold, vacated, dismissed", () => {
  for (const s of [
    "Cancelled",
    "To Plaintiff",
    "Third Party",
    "Sold",
    "Vacated",
    "Dismissed",
  ])
    assert.equal(ev(good({ status: s })).gate, "dead_status", s);
  assert.equal(ev(good({ status: "Continued" })).ok, true);
});

test("gate dead_status checks every merged source status", () => {
  const e = ev(
    good({ status: "Continued", statuses: ["Continued", "Cancelled"] }),
  );
  assert.equal(e.gate, "dead_status");
});

test("gate sale_passed uses the Chicago calendar date", () => {
  assert.equal(ev(good({ sale: "2026-09-28" })).gate, "sale_passed");
  // 23:30 Chicago on 09-28 is 04:30Z on 09-29: a 09-28 sale is today, not passed
  const late = new Date("2026-09-29T04:30:00Z");
  const e = evaluate(good({ sale: "2026-09-28" }), { now: late });
  assert.equal(e.terms.runwayDays, 0);
  assert.equal(e.gate, "short_runway");
});

test("gate short_runway below 10 days, 10 days passes", () => {
  assert.equal(ev(good({ sale: "2026-10-08" })).gate, "short_runway");
  const e = ev(good({ sale: "2026-10-09" }));
  assert.equal(e.ok, true);
  assert.equal(e.terms.stage, "sale_10_21");
  assert.equal(e.terms.pStage, 0.85);
});

test("gate no_address and no_owner", () => {
  assert.equal(ev(good({ address: "" })).gate, "no_address");
  assert.equal(ev(good({ owner: "" })).gate, "no_owner");
  assert.equal(ev(good({ owner: "(owner name pending)" })).gate, "no_owner");
  assert.equal(ev(good({ owner: "UNKNOWN" })).gate, "no_owner");
});

test("gate entity_owner: LLC, condo association, land trust, government", () => {
  for (const o of [
    "REIGN CO2 PROPCO LLC",
    "HAMILTON CLUB CONDO ASSN INC",
    "LTC 2NDW10431",
    "CHICAGO TITLE LAND TRUST CO TR 8002",
    "UNITED STATES OF AMER",
    "SECRETARY OF HOUSING AND URBAN DEVELOPMENT",
    "VITHALANI INC",
  ])
    assert.equal(ev(good({ owner: o })).gate, "entity_owner", o);
});

test("HUD or the US next to a person is allowed and a mild plus (D5)", () => {
  const base = ev(good());
  const e = ev(good({ owner: "MARY JONES & SECRETARY OF HUD" }));
  assert.equal(e.ok, true);
  assert.equal(e.terms.govCoParty, true);
  assert.ok(e.ev > base.ev);
});

test("gate out_of_radius applies to every county, default 30 mi", () => {
  assert.equal(
    ev(good({ city: "ANTIOCH", zip: "60002", county: "Lake" })).gate,
    "out_of_radius",
  );
  const joliet = ev(good({ city: "JOLIET", zip: "60435" }));
  assert.equal(joliet.ok, true);
  assert.equal(joliet.terms.pProx, 0.7);
  const naper = ev(
    good({ city: "NAPERVILLE", zip: "60540", county: "DuPage" }),
  );
  assert.equal(naper.terms.pProx, 0.9);
  const elm = ev(good({ city: "ELMHURST", zip: "60126", county: "DuPage" }));
  assert.equal(elm.terms.pProx, 1);
});

test("gate out_of_radius: Chicago proper, Bellwood, county-only location", () => {
  assert.equal(
    ev(good({ county: "Cook", city: "CHICAGO", zip: "60644" })).gate,
    "out_of_radius",
  );
  assert.equal(
    ev(good({ county: "Cook", city: "BELLWOOD", zip: "60104" })).gate,
    "out_of_radius",
  );
  assert.equal(ev(good({ city: "", zip: "" })).gate, "out_of_radius");
  assert.equal(
    ev(good({ county: "Cook", city: "CHICAGO RIDGE", zip: "60415" })).ok,
    true,
  );
});

test("gate already_sent uses the isSent callback", () => {
  const e = ev(good(), { isSent: (l) => l.address === "702 HALSTEAD AVE" });
  assert.equal(e.gate, "already_sent");
});

test("gate suspect_value: big gap on a guessed payoff with no assessor anchor", () => {
  const e = ev(
    good({ assessed: null, judgment: null, lastSalePrice: 120000, lastSaleDate: "2015-05-01" }),
  );
  // zip-median market, 108k guess = 67% gap, nothing anchors the value
  assert.equal(e.terms.confidence, "suspect");
  assert.equal(e.gate, "suspect_value");
});

test("a long-held owner with an assessor-anchored value is low confidence, not suspect", () => {
  const e = ev(
    good({ judgment: null, lastSalePrice: 120000, lastSaleDate: "2015-05-01" }),
  );
  assert.equal(e.terms.confidence, "low");
  assert.notEqual(e.gate, "suspect_value");
});

test("gate no_gap: no payoff figure, or owes more than it is worth", () => {
  assert.equal(ev(good({ judgment: null })).gate, "no_gap");
  assert.equal(ev(good({ judgment: 400000 })).gate, "no_gap");
  assert.equal(
    ev(good({ assessed: null, comps: [], compsCount: 0, compsMedian: null }))
      .gate,
    "no_gap",
  );
});

test("gate weak_value: assessor value plus a guessed payoff is not enough", () => {
  const e = ev(
    good({
      judgment: null,
      comps: [],
      compsCount: 0,
      compsMedian: null,
      lastSalePrice: 250000,
      lastSaleDate: "2016-01-01",
    }),
  );
  assert.equal(e.terms.payoffBasis, "last sale");
  assert.equal(e.terms.confidence, "low");
  assert.equal(e.gate, "weak_value");
});

test("anchor-agreeing comps back a guessed payoff (low confidence, x0.6)", () => {
  const e = ev(
    good({ judgment: null, lastSalePrice: 200000, lastSaleDate: "2016-01-01" }),
  );
  assert.equal(e.ok, true, e.reasons.join(" "));
  assert.equal(e.terms.pConf, 0.6);
});

test("gate small_gap: under $50k or under 20 percent", () => {
  assert.equal(ev(good({ judgment: 260000 })).gate, "small_gap"); // 331k - 286k = 45k
  const big = good({
    assessed: 400000,
    comps: comps([1.1e6, 1.2e6, 1.2e6, 1.3e6, 1.25e6]),
    compsMedian: 1200000,
    judgment: 900000,
  });
  assert.equal(ev(big).gate, "small_gap"); // 210k but 17.5 percent
});

test("Intercounty post-sale bid is not a payoff figure", () => {
  const e = ev(
    good({ judgment: null, openingBid: 150000, status: "To Plaintiff" }),
  );
  assert.equal(e.gate, "dead_status");
  assert.equal(e.terms.payoffBasis, null);
  const live = ev(good({ judgment: null, openingBid: 150000 }));
  assert.equal(live.terms.payoffBasis, "opening bid");
  assert.equal(live.terms.confidence, "high");
});

test("P_stage table: 22-90, >90, judgment only, lis pendens", () => {
  assert.equal(ev(good({ sale: "2026-12-28" })).terms.pStage, 1); // 90 days
  assert.equal(ev(good({ sale: "2027-01-15" })).terms.pStage, 0.8);
  const j = ev(good({ sale: null }));
  assert.equal(j.terms.stage, "judgment");
  assert.equal(j.terms.pStage, 0.9);
  const lp = ev(
    good({
      sale: null,
      judgment: null,
      openingBid: 150000,
      sources: ["recorder-cook"],
    }),
  );
  assert.equal(lp.terms.stage, "lis_pendens");
  assert.equal(lp.terms.pStage, 0.8);
});

