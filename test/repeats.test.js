// A2 P0-5: the 7 production repeat addresses read as already sent through the
// real pick.js alias keys, using only what was sent BEFORE the repeat happened.
// Needs the gitignored production archives in data/prod-archives; skips without them.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

process.env.PROFILE = "vince";
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const ARCH = path.join(ROOT, "data", "prod-archives");
const STATE = path.join(ARCH, "vince-state-2026-09-28.json");
const have = existsSync(STATE) && existsSync(path.join(ROOT, "src", "pick.js"));

const REPEATS = [
  "9807 N Greenwood Ave, Niles",
  "630 W Glencoe Rd, Palatine",
  "409 Englewood Ave, Hillside",
  "1776 Stockton Ave, Des Plaines",
  "4627 Custer Ave, Lyons",
  "1906 S 7th Ave, Maywood",
  "3318 East Ave, Berwyn",
];
const norm = (s) =>
  String(s || "").toUpperCase().replace(/[.,]/g, " ").replace(/\bAVENUE\b/g, "AVE").replace(/\bROAD\b/g, "RD").replace(/\s+/g, " ").trim();

test("the 7 known repeats read as already sent", { skip: !have && "no production archives" }, async () => {
  const pick = await import("../src/pick.js");
  const { makeIsSent, sentSetFor, backfillAliases } = await import("../src/sentkeys.js");
  const prod = JSON.parse(readFileSync(STATE, "utf8"));
  const outcomes = Object.values(prod.outcomes);
  const archives = new Set(readdirSync(ARCH));
  for (const target of REPEATS) {
    const t = norm(target);
    const sends = outcomes.filter((o) => norm(o.address) === t).map((o) => o.date).sort();
    assert.ok(sends.length >= 2, `${target} was sent twice in production (${sends})`);
    const second = sends[1];
    // the lead as it looked when production sent it the second time
    const f = `leads-vince-${second}.json`;
    assert.ok(archives.has(f), `archive for ${second}`);
    const leads = JSON.parse(readFileSync(path.join(ARCH, f), "utf8")).leads;
    const lead = leads.find((l) => norm(`${l.address}, ${l.city}`) === t);
    assert.ok(lead, `${target} is in the ${second} pool`);
    // state as of the day before the repeat: no sentKeys, only earlier outcomes
    const state = { sentKeys: [], outcomes: Object.fromEntries(Object.entries(prod.outcomes).filter(([, o]) => o.date < second)) };
    backfillAliases(state, pick);
    const isSent = makeIsSent(pick, sentSetFor(pick, state));
    assert.equal(isSent(lead), true, `${target} (${second}) reads as already sent`);
  }
});

test("a never-sent lead does not read as sent", { skip: !have && "no production archives" }, async () => {
  const pick = await import("../src/pick.js");
  const { makeIsSent, sentSetFor, backfillAliases } = await import("../src/sentkeys.js");
  const prod = JSON.parse(readFileSync(STATE, "utf8"));
  const state = structuredClone(prod);
  backfillAliases(state, pick);
  const isSent = makeIsSent(pick, sentSetFor(pick, state));
  assert.equal(isSent({ county: "DuPage", address: "99999 NOWHERE LN", city: "ELMHURST", caseNumber: "26 CH 999999" }), false);
});
