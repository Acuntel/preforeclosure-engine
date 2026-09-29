// Integration: the real src/pick.js driven through the real digest against a
// fake Telegram. Proves the send path and the picker agree on the interface
// (pickEval terms, reasons, aliasKeys, buildSentSet). Never touches the network.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { NOW, DASHES, good } from "./fixtures/pick-lead.js";

process.env.VINCE_PING_OFF = "1";
process.env.VINCE_EMAIL_OFF = "1";
process.env.VINCE_CHAT_ID = "111";
delete process.env.VINCE_PICK_MODULE;
globalThis.fetch = async () => {
  throw new Error("network is blocked in tests");
};

const { setTransport } = await import("../src/telegram.js");
const { runDailyDigest } = await import("../src/digest.js");
const { fakeTelegram } = await import("./fixtures/a2-fake-telegram.js");

let stateFile, tgf;
const read = () => JSON.parse(readFileSync(stateFile, "utf8"));
const pool = () => [
  good(),
  good({
    address: "640 ASPEN ST",
    city: "FRANKFORT",
    zip: "60423",
    caseNumber: "25 CH 200",
    judgment: 180000,
  }),
  good({
    address: "9 LLC WAY",
    city: "ROMEOVILLE",
    caseNumber: "25 CH 300",
    owner: "ACME HOLDINGS LLC",
  }),
];
const run = (date, now) =>
  runDailyDigest(pool(), stateFile, { dueDate: date, hour: 10, now });

beforeEach(() => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "vince-int-"));
  stateFile = path.join(dir, "state.json");
  process.env.VINCE_ARCHIVE_DIR = dir;
  tgf = fakeTelegram();
  setTransport(tgf.fn);
});

test("real picker: one lead per day, EV reasons on the card, no repeat next day", async () => {
  const d1 = await run("2026-09-29", NOW);
  assert.equal(d1.decision, "pick-sent");
  assert.equal(d1.sentNow, 1);
  assert.equal(d1.pick.address, "702 HALSTEAD AVE"); // bigger equity than Frankfort
  assert.equal(d1.result.dropCounts.entity_owner, 1);
  const cards = tgf.sends().filter((c) => c.payload.reply_markup);
  assert.equal(cards.length, 1);
  assert.match(cards[0].payload.text, /Worth about/);
  for (const c of tgf.sends()) assert.doesNotMatch(c.payload.text, DASHES);
  const s = read();
  assert.ok(
    s.sentKeys.includes("C:WILL:2025CH100") ||
      s.sentKeys.some((k) => k.startsWith("C:WILL:")),
  );
  assert.ok(s.sentKeys.includes("AC:702 HALSTEAD AVE|ROMEOVILLE"));

  const again = await run("2026-09-29", NOW);
  assert.equal(again.decision, "not-due");

  const next = new Date(NOW.getTime() + 864e5);
  const d2 = await run("2026-09-30", next);
  assert.equal(d2.decision, "pick-sent");
  assert.equal(d2.pick.address, "640 ASPEN ST");
  assert.equal(d2.result.dropCounts.already_sent, 1);

  const d3 = await run("2026-10-01", new Date(next.getTime() + 864e5));
  assert.equal(d3.decision, "nodeal-sent");
  assert.equal(d3.result.dropCounts.already_sent, 2);
  const last = tgf.sends().at(-1).payload.text;
  assert.match(last, /No deal worth your time today/);
});
