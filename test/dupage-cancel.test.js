// DuPage sheriff cancellation signal (spec P1-2): a case that leaves the feed
// before its sale date marks every pool lead with that case# as cancelled.
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.PROFILE = "vince";
const { applyDupageCancellations, CANCEL_STATUS } =
  await import("../src/dupage-cancel.js");
const { DEAD_STATUS } = await import("../src/pick-eval.js");

const sheriff = (caseNumber, sale) => ({
  county: "DuPage",
  caseNumber,
  sale,
  _src: "dupage-sheriff",
});
const ok = (leads) => ({
  leads,
  sources: [{ id: "dupage-sheriff", status: "ok" }],
});

test("a vanished case before its sale is flagged; the Intercounty copy reads dead", () => {
  const state = {};
  applyDupageCancellations(
    state,
    ok([sheriff("24 FC 514", "2026-10-01"), sheriff("26 FC 65", "2026-11-17")]),
    "2026-09-28",
  );
  assert.equal(state.dupageCases.length, 2);
  const ic = {
    county: "DuPage",
    caseNumber: "2024FC000514",
    sources: ["intercounty"],
  };
  const r = applyDupageCancellations(
    state,
    ok([sheriff("26 FC 65", "2026-11-17"), ic]),
    "2026-09-29",
  );
  assert.deepEqual(r.vanished, ["2024FC514"]);
  assert.ok(ic.statuses.includes(CANCEL_STATUS));
  assert.ok(DEAD_STATUS.test(CANCEL_STATUS));
});

test("a blocked or truncated feed never cancels anything", () => {
  const state = {};
  applyDupageCancellations(
    state,
    ok([
      sheriff("1 FC 1", "2026-10-20"),
      sheriff("1 FC 2", "2026-10-21"),
      sheriff("1 FC 3", "2026-10-22"),
    ]),
    "2026-09-28",
  );
  const blocked = applyDupageCancellations(
    state,
    { leads: [], sources: [{ id: "dupage-sheriff", status: "blocked" }] },
    "2026-09-29",
  );
  assert.equal(blocked.vanished.length, 0);
  assert.equal(blocked.updated, false);
  const tiny = applyDupageCancellations(
    state,
    ok([sheriff("1 FC 1", "2026-10-20")]),
    "2026-09-29",
  );
  assert.equal(tiny.vanished.length, 0);
  assert.equal(state.dupageCases.length, 3);
});

test("a sale that happened is not a cancellation, and a returning case is cleared", () => {
  const state = {};
  applyDupageCancellations(
    state,
    ok([sheriff("2 FC 1", "2026-09-28"), sheriff("2 FC 2", "2026-10-30")]),
    "2026-09-27",
  );
  const r = applyDupageCancellations(
    state,
    ok([sheriff("2 FC 2", "2026-10-30")]),
    "2026-09-29",
  );
  assert.equal(r.vanished.length, 0);
  state.dupageCancelled = { "2FC2": { sale: "2026-10-30", at: "2026-09-29" } };
  applyDupageCancellations(
    state,
    ok([sheriff("2 FC 2", "2026-10-30")]),
    "2026-09-30",
  );
  assert.deepEqual(state.dupageCancelled, {});
});

test("probate estate must own the house per the county tax bill", async () => {
  const { estateOwnsHouse, evaluate } = await import("../src/pick-eval.js");
  const lead = {
    county: "DuPage",
    address: "610 Catalpa Ave",
    city: "Wood Dale",
    zip: "60191",
    owner: "ESTATE OF PATRICIA L. OHMER",
    decedent: "Patricia L. Ohmer",
    signal: "probate",
    sources: ["probate-pni"],
    fcvTotal: 127551,
  };
  assert.equal(estateOwnsHouse({ ...lead, taxOwner: "ANDERSON, ALAN & SANDRA" }), false);
  assert.equal(estateOwnsHouse({ ...lead, taxOwner: "OHMER, PATRICIA L" }), true);
  assert.equal(estateOwnsHouse({ ...lead, decedent: "John Smith Jr.", taxOwner: "SMITH, JOHN" }), true);
  assert.equal(estateOwnsHouse(lead), true); // no tax bill: nothing to compare
  const e = evaluate({ ...lead, taxOwner: "ANDERSON, ALAN & SANDRA" }, { now: new Date("2026-09-29T15:00:00Z") });
  assert.equal(e.gate, "estate_not_owner");
  assert.match(e.reasons[0], /ANDERSON/);
});
