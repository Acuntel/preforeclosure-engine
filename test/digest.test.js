// A2 send path: the one-a-day digest end to end against a fake Telegram.
// Run: node --test test/   (never touches the network, never sends)
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

process.env.VINCE_PING_OFF = "1";
process.env.VINCE_EMAIL_OFF = "1";
process.env.VINCE_CHAT_ID = "111,222";
process.env.VINCE_DAILY_COUNT = "5"; // must be ignored: hard cap is 1
globalThis.fetch = async () => {
  throw new Error("network is blocked in tests");
};

const HERE = path.dirname(fileURLToPath(import.meta.url));
const { setTransport } = await import("../src/telegram.js");
const { runDailyDigest } = await import("../src/digest.js");
const pick = await import("./fixtures/a2-fake-pick.js");
const { fakeTelegram } = await import("./fixtures/a2-fake-telegram.js");

let dir, stateFile, tgf;
const read = () => JSON.parse(readFileSync(stateFile, "utf8"));
const run = (date, opts = {}) =>
  runDailyDigest(opts.leads || pick.fakeLeads(), stateFile, {
    dueDate: date,
    hour: 10,
    pick,
    ...opts,
  });

beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), "vince-a2-"));
  stateFile = path.join(dir, "state.json");
  process.env.VINCE_ARCHIVE_DIR = dir;
  delete process.env.FAKE_PICK_NONE;
  delete process.env.FAKE_HEALTH_BAD;
  tgf = fakeTelegram();
  setTransport(tgf.fn);
});

test("sends exactly one lead (name + card per chat) even with VINCE_DAILY_COUNT=5", async () => {
  const d = await run("2026-09-29");
  assert.equal(d.decision, "pick-sent");
  assert.equal(d.sentNow, 1);
  const sends = tgf.sends();
  assert.equal(sends.length, 4); // 2 chats x (name, card)
  const cards = sends.filter((c) => c.payload.reply_markup);
  assert.equal(cards.length, 2);
  assert.match(cards[0].payload.text, /132 S LINDEN AVE/);
  assert.match(cards[0].payload.text, /Why this one/);
  assert.match(cards[0].payload.text, /Worth about \$400000/);
  const kb = cards[0].payload.reply_markup.inline_keyboard
    .flat()
    .map((b) => b.text);
  for (const t of ["Value wrong", "Already sold", "Too far", "Can't reach"])
    assert.ok(kb.includes(t), t);
  const s = read();
  assert.equal(s.lastDigestDate, "2026-09-29");
  assert.equal(s.pending, null);
  const o = s.outcomes["260929"];
  assert.equal(o.v, 2);
  assert.equal(o.msgs.length, 2);
  assert.ok(o.reasons.length >= 1);
  assert.ok(s.sentKeys.includes("C:DUPAGE:26CH1"));
  assert.ok(s.sentKeys.includes("AC:132 S LINDEN AVE|ELMHURST"));
  assert.ok(s.sentKeys.includes("DuPage::26 CH 1")); // legacy key too

  const again = await run("2026-09-29");
  assert.equal(again.decision, "not-due");
  assert.equal(tgf.sends().length, 4, "no second send the same day");
});

test("every sent string is free of em and en dashes", async () => {
  await run("2026-09-29");
  process.env.FAKE_PICK_NONE = "1";
  await run("2026-09-30");
  for (const c of tgf.sends()) assert.doesNotMatch(c.payload.text, /[–—]/);
  for (const f of [
    "cards.js",
    "callbacks.js",
    "digest.js",
    "email.js",
    "legacy-notify.js",
    "telegram.js",
  ])
    assert.doesNotMatch(
      readFileSync(path.join(HERE, "..", "src", f), "utf8"),
      /[–—]/,
      f,
    );
});

test("a Telegram failure does not mark the lead sent, and the next pass retries", async () => {
  tgf.mode = "fail";
  const d1 = await run("2026-09-29");
  assert.equal(d1.decision, "pick-failed");
  let s = read();
  assert.equal(s.pending.phase, "failed");
  assert.ok(!s.sentKeys.includes("C:DUPAGE:26CH1"));
  assert.equal(Object.keys(s.outcomes).length, 0);
  tgf.mode = "ok";
  const d2 = await run("2026-09-29");
  assert.equal(d2.decision, "pick-sent");
  s = read();
  assert.equal(s.pending, null);
  assert.equal(Object.keys(s.outcomes).length, 1);
});

test("a timeout (unknown delivery) is never resent", async () => {
  tgf.mode = "timeout";
  const d1 = await run("2026-09-29");
  assert.equal(d1.decision, "pick-unknown");
  tgf.mode = "ok";
  const before = tgf.sends().length;
  const d2 = await run("2026-09-29");
  assert.equal(d2.decision, "not-due");
  assert.equal(tgf.sends().length, before);
  const s = read();
  assert.ok(s.sentKeys.includes("C:DUPAGE:26CH1"));
  assert.equal(s.outcomes["260929"].unconfirmed, true);
});

test("a crash between the Telegram send and the state save produces no duplicate", async () => {
  const log = path.join(dir, "child-sends.log");
  const child = spawnSync(
    process.execPath,
    [
      path.join(HERE, "fixtures", "a2-crash-child.js"),
      stateFile,
      log,
      "2026-09-29",
    ],
    { encoding: "utf8" },
  );
  assert.equal(child.status, 1, child.stderr);
  assert.doesNotMatch(child.stdout, /UNREACHABLE/);
  assert.equal(readFileSync(log, "utf8").trim().split("\n").length, 2); // name + card went out
  assert.equal(read().pending.phase, "sending");

  const d = await run("2026-09-29"); // the restarted process
  assert.equal(d.decision, "not-due");
  assert.equal(tgf.sends().length, 0, "nothing resent after the crash");
  const s = read();
  assert.equal(s.pending, null);
  assert.ok(s.sentKeys.includes("C:DUPAGE:26CH1"));
  // and the next day picks a different lead (after a follow-up on the crashed one)
  const next = await run("2026-09-30");
  assert.equal(next.decision, "pick-sent");
  const card = tgf.sends().find((c) => /Today's lead/.test(c.payload.text));
  assert.match(card.payload.text, /1 OAK ST/);
});

test("no lead passes: the honest no-deal line goes out once and marks the day", async () => {
  process.env.FAKE_PICK_NONE = "1";
  const d = await run("2026-09-29");
  assert.equal(d.decision, "nodeal-sent");
  const sends = tgf.sends();
  assert.equal(sends.length, 2); // one line per chat
  assert.match(
    sends[0].payload.text,
    /^☀️ <b>No deal worth your time today\.<\/b> Closest miss: 132 S LINDEN AVE, ELMHURST\. The equity is only/,
  );
  const s = read();
  assert.equal(s.lastDigestDate, "2026-09-29");
  assert.equal(s.noDeals["2026-09-29"].gate, "small_gap");
  assert.equal(Object.keys(s.outcomes).length, 0);
  await run("2026-09-29");
  assert.equal(tgf.sends().length, 2);
});

test("a degraded pool defers until the cutoff hour, then decides", async () => {
  process.env.FAKE_HEALTH_BAD = "1";
  const d1 = await run("2026-09-29", { hour: 10 });
  assert.equal(d1.decision, "deferred");
  assert.equal(tgf.sends().length, 0);
  assert.notEqual(read().lastDigestDate, "2026-09-29");
  const d2 = await run("2026-09-29", { hour: 13 });
  assert.equal(d2.decision, "deferred");
  const d3 = await run("2026-09-29", { hour: 14 });
  assert.equal(d3.decision, "pick-sent");
});

test("an empty scan never burns the day", async () => {
  const d = await run("2026-09-29", { leads: [] });
  assert.equal(d.decision, "wait-empty-scan");
  assert.equal(tgf.sends().length, 0);
});

test("next-day follow-up rides on today's card (one message set a day), once, only for new-style outcomes", async () => {
  const state0 = {
    sentKeys: [],
    outcomes: {
      "09281": {
        name: "OLD LEAD",
        address: "5 X ST, Y",
        date: "2026-09-28",
        answered: null,
        meeting: null,
      },
    },
  };
  writeFileSync(stateFile, JSON.stringify(state0));
  await run("2026-09-29");
  assert.equal(
    tgf.sends().filter((c) => /Quick check/.test(c.payload.text)).length,
    0,
    "legacy outcomes get no follow-up",
  );
  const before = tgf.sends().length;
  await run("2026-09-30");
  const day = tgf.sends().slice(before);
  assert.equal(day.length, 4, "name + card per chat, no separate follow-up message");
  const fu = day.filter((c) => /Quick check/.test(c.payload.text));
  assert.equal(fu.length, 2); // on the card, one per chat
  assert.match(
    fu[0].payload.text,
    /yesterday's lead, JANE DOE at <b>132 S LINDEN AVE, ELMHURST<\/b>/,
  );
  assert.match(fu[0].payload.text, /1 OAK ST/, "the follow-up line is on today's card");
  assert.ok(fu[0].payload.reply_markup);
  const s = read();
  assert.ok(s.outcomes["260929"].followUpAt);
  await run("2026-10-01");
  const fu2 = tgf.sends().filter((c) => /Quick check/.test(c.payload.text));
  assert.equal(fu2.length, 4); // only the 09-30 lead is followed up now
  assert.match(fu2[2].payload.text, /Quick check on yesterday's lead, [^<]* at <b>1 OAK ST/);
});

test("a follow-up is skipped when the lead already has an outcome", async () => {
  await run("2026-09-29");
  const s = read();
  s.outcomes["260929"].reason = "too_far";
  writeFileSync(stateFile, JSON.stringify(s));
  await run("2026-09-30");
  assert.equal(
    tgf.sends().filter((c) => /Quick check/.test(c.payload.text)).length,
    0,
  );
});

test("the picks snapshot holds the pick, runners-up and every EV input", async () => {
  await run("2026-09-29");
  const f = path.join(dir, "picks", "2026-09-29.json");
  assert.ok(existsSync(f));
  const snap = JSON.parse(readFileSync(f, "utf8"));
  assert.equal(snap.decision, "pick-sent");
  assert.equal(snap.oid, "260929");
  assert.equal(snap.pick.address, "132 S LINDEN AVE");
  assert.equal(snap.pick.pickEval.terms.payoffBasis, "judgment");
  assert.equal(snap.runnersUp.length, 2);
  assert.ok(snap.runnersUp[0].pickEval.terms);
  assert.deepEqual(snap.health.ok, true);
});

test("sending disabled (no transport, VINCE_PING_OFF=1) never marks the day", async () => {
  setTransport(null);
  const d = await run("2026-09-29");
  assert.equal(d.decision, "sending-disabled");
  assert.notEqual(read().lastDigestDate, "2026-09-29");
});

test("vince-track.js only calls runInstantAlerts behind VINCE_INSTANT=1", () => {
  const src = readFileSync(path.join(HERE, "..", "vince-track.js"), "utf8");
  const calls = [...src.matchAll(/await runInstantAlerts\(/g)];
  assert.equal(calls.length, 1);
  assert.match(src, /if \(INSTANT\) \{\s*const ia = await runInstantAlerts\(/);
  assert.match(src, /const INSTANT = process\.env\.VINCE_INSTANT === "1";/);
  assert.match(src, /hourCycle: "h23"/);
});
