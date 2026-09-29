// Value math (spec P0-2): assessor anchor, comps hygiene, payoff order and
// confidence tiers. Run: node --test test/*.test.js
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.PROFILE = "vince";
const vm = await import("../src/value-math.js");
const { cleanMydecRows, cleanCookRows, dedupeSales, applyValuation } =
  await import("../src/value.js");

test("assessor anchor: Cook AV x10, collar AV x3, DuPage prefers fcvTotal", () => {
  assert.equal(vm.assessorAnchor({ county: "Cook", assessed: 29000 }), 290000);
  assert.equal(vm.assessorAnchor({ county: "Will", assessed: 110000 }), 330000);
  assert.equal(
    vm.assessorAnchor({ county: "DuPage", assessed: 139893, fcvTotal: 147893 }),
    444000,
  );
  assert.equal(vm.assessorAnchor({ county: "Kane" }), null);
});

test("comps need 5 distinct sale events; one multi-PIN deal counts once", () => {
  const broadview = {
    county: "Cook",
    assessed: 29000,
    comps: [
      { price: 475000, date: "2025-09-10" },
      { price: 905000, date: "2025-04-16" },
      { price: 905000, date: "2025-04-16" },
    ],
    compsCount: 3,
    compsMedian: 905000,
  };
  assert.equal(vm.distinctCompEvents(broadview), 2);
  const m = vm.marketValue(broadview);
  assert.equal(m.basis, "assessor");
  assert.equal(m.market, 290000);
  assert.equal(vm.distinctCompEvents({ compsDistinct: 7, comps: [] }), 7);
});

test("comps outside 0.55x to 1.8x of the anchor fall back to the anchor", () => {
  const five = [1, 2, 3, 4, 5].map((i) => ({
    price: 500000 + i,
    date: `2026-0${i}-01`,
  }));
  const hi = vm.marketValue({
    county: "Cook",
    assessed: 25000,
    comps: five,
    compsCount: 5,
    compsMedian: 500000,
  });
  assert.equal(hi.basis, "assessor");
  assert.equal(hi.compsRejected, "out of band");
  const ok = vm.marketValue({
    county: "Cook",
    assessed: 40000,
    comps: five,
    compsCount: 5,
    compsMedian: 500000,
  });
  // ratio 1.25 is in band but above the Cook lag (1.15): capped at anchor x lag
  assert.equal(ok.basis, "comps");
  assert.equal(ok.market, 460000);
  assert.equal(ok.capped, true);
  const agree = vm.marketValue({
    county: "Cook",
    assessed: 45000,
    comps: five,
    compsCount: 5,
    compsMedian: 500000,
  });
  assert.equal(agree.market, 500000);
  assert.ok(!agree.capped);
});

test("$/sqft x subject sqft is preferred when comps carry sqft", () => {
  const comps = [1, 2, 3, 4, 5].map((i) => ({
    price: 200000 * i,
    sqft: 1000 * i,
    date: `2026-0${i}-01`,
  }));
  const m = vm.marketValue({
    county: "Will",
    assessed: 100000,
    sqft: 1500,
    comps,
    compsCount: 5,
    compsMedian: 600000,
  });
  assert.equal(m.market, 300000);
});

test("payoff order: judgment x1.1, bid, mortgage, last sale >= 2008 x0.9", () => {
  const all = {
    judgment: 100000,
    openingBid: 90000,
    mortgageBalance: 80000,
    lastSalePrice: 200000,
    lastSaleDate: "2015-01-01",
  };
  assert.deepEqual(vm.payoffEstimate(all, 300000), {
    payoff: 110000,
    basis: "judgment",
    guess: false,
  });
  assert.equal(
    vm.payoffEstimate({ ...all, judgment: null }, 300000).basis,
    "opening bid",
  );
  assert.equal(
    vm.payoffEstimate({ ...all, judgment: null, openingBid: null }, 300000)
      .basis,
    "mortgage",
  );
  const g = vm.payoffEstimate(
    { lastSalePrice: 200000, lastSaleDate: "2015-01-01" },
    300000,
  );
  assert.deepEqual(g, { payoff: 180000, basis: "last sale", guess: true });
  assert.equal(
    vm.payoffEstimate(
      { lastSalePrice: 200000, lastSaleDate: "2005-01-01" },
      300000,
    ).payoff,
    null,
  );
  // a $50k "sale" on a $300k house is not arm's length
  assert.equal(
    vm.payoffEstimate(
      { lastSalePrice: 50000, lastSaleDate: "2019-01-01" },
      300000,
    ).payoff,
    null,
  );
});

test("judgmentAmount wins; a date in `judgment` is not money", () => {
  assert.equal(
    vm.judgmentAmountOf({ judgmentAmount: 5000, judgment: 9000 }),
    5000,
  );
  assert.equal(vm.judgmentAmountOf({ judgment: "2026-01-09" }), null);
  assert.equal(vm.judgmentAmountOf({ judgment: "$149,134" }), 149134);
});

test("confidence tiers: high, medium, low, suspect", () => {
  const five = [1, 2, 3, 4, 5].map((i) => ({
    price: 330000 + i,
    date: `2026-0${i}-01`,
  }));
  const base = {
    county: "Will",
    assessed: 110000,
    comps: five,
    compsCount: 5,
    compsMedian: 331000,
  };
  assert.equal(vm.valuation({ ...base, judgment: 150000 }).confidence, "high");
  assert.equal(
    vm.valuation({
      county: "Kane",
      comps: five,
      compsCount: 5,
      compsMedian: 331000,
      judgment: 150000,
    }).confidence,
    "medium",
  );
  assert.equal(
    vm.valuation({ ...base, mortgageBalance: 200000 }).confidence,
    "medium",
  );
  assert.equal(
    vm.valuation({ ...base, lastSalePrice: 250000, lastSaleDate: "2016-01-01" })
      .confidence,
    "low",
  );
  // anchored market + old purchase = a long-held owner: low, not suspect
  assert.equal(
    vm.valuation({ ...base, lastSalePrice: 120000, lastSaleDate: "2016-01-01" })
      .confidence,
    "low",
  );
  const sus = vm.valuation({
    ...base,
    assessed: null,
    lastSalePrice: 120000,
    lastSaleDate: "2016-01-01",
  });
  assert.equal(sus.confidence, "suspect");
  assert.doesNotMatch(sus.basis, /[–—]/);
});

test("MyDec rows: multi-parcel, related, partial, in-lieu and condo mismatch dropped", () => {
  const row = (o) => ({
    line_11_full_consideration: "300000.0",
    date_recorded: "2026-07-01T00:00:00.000",
    full_address: "1 A ST X",
    line_2_total_parcels: "1",
    line_8_current_use: "B",
    ...o,
  });
  const rows = [
    row({}),
    row({ line_2_total_parcels: "2", date_recorded: "2026-07-02" }),
    row({ line_10b_sale_between_related: true, date_recorded: "2026-07-03" }),
    row({ line_10c_transfer_of_100: true, date_recorded: "2026-07-04" }),
    row({ line_10e_sale_in_lieu_of: true, date_recorded: "2026-07-05" }),
    row({ line_8_current_use: "F", date_recorded: "2026-07-06" }),
    row({}), // exact duplicate event
    row({ line_11_full_consideration: "310000", date_recorded: "2026-07-07" }),
  ];
  const out = cleanMydecRows(rows, "5 B ST");
  assert.equal(out.length, 2);
});

test("Cook sales rows: multisale and filtered deeds dropped, deduped", () => {
  const r = (o) => ({
    pin: "1",
    sale_price: "300000",
    sale_date: "2025-04-16T00:00:00.000",
    class: "203",
    num_parcels_sale: "1",
    ...o,
  });
  const out = cleanCookRows([
    r({}),
    r({ pin: "2" }),
    r({ is_multisale: true, sale_date: "2025-05-01" }),
    r({ class: "591", sale_date: "2025-06-01" }),
    r({ sale_filter_deed_type: true, sale_date: "2025-07-01" }),
  ]);
  assert.equal(out.length, 1);
  assert.equal(
    dedupeSales([
      { price: 1, date: "a" },
      { price: 1, date: "a" },
      { price: 1, date: "b" },
    ]).length,
    2,
  );
});

test("applyValuation only shows a comps figure when comps were trusted", () => {
  const l = applyValuation({
    county: "Cook",
    assessed: 29000,
    comps: [{ price: 905000, date: "x" }],
    compsCount: 1,
    compsMedian: 905000,
    estMarketComps: 905000,
    judgment: 100000,
  });
  assert.equal(l.estMarketComps, undefined);
  assert.equal(l.estMarket, 290000);
  assert.equal(l.valueBasis, "assessor value minus judgment");
});

test("a placeholder assessed value ($1 FCV) is not an anchor", () => {
  assert.equal(vm.assessorAnchor({ county: "DuPage", fcvTotal: 1, assessed: 1 }), null);
  assert.equal(vm.assessorAnchor({ county: "DuPage", fcvTotal: 257539 }), 773000);
});
