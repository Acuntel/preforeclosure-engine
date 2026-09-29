// Shared fixture for the picker tests: a clean Will County sheriff lead
// (judgment payoff, anchored comps, sale 30 days out) and a fixed clock.
process.env.PROFILE = "vince";
delete process.env.VINCE_RADIUS_MI;
delete process.env.VINCE_MIN_RUNWAY_DAYS;

// 10:00 Chicago on 2026-09-29, the next digest after the 09-28 archive.
export const NOW = new Date("2026-09-29T15:00:00Z");
export const DASHES = /[\u2013\u2014]/;

export const comps = (prices) =>
  prices.map((p, i) => ({ price: p, date: `2026-0${(i % 8) + 1}-15` }));

export function good(over = {}) {
  return {
    county: "Will",
    address: "702 HALSTEAD AVE",
    city: "ROMEOVILLE",
    zip: "60446",
    owner: "JOHN SMITH",
    caseNumber: "25 CH 100",
    sources: ["will-sheriff"],
    sale: "2026-10-29",
    assessed: 110000, // anchor 330k
    comps: comps([300000, 320000, 331000, 340000, 350000]),
    compsCount: 5,
    compsMedian: 331000,
    judgment: 113000, // payoff 124.3k
    ...over,
  };
}
