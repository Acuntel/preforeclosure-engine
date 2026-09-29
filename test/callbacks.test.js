// A2: button taps on the daily card (call outcome + bad-lead reasons).
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.VINCE_PING_OFF = "1";
process.env.VINCE_EMAIL_OFF = "1";
process.env.VINCE_CHAT_ID = "111,222";
let fetchCalls = 0;
globalThis.fetch = async () => {
  fetchCalls++;
  throw new Error("network is blocked in tests");
};

const { setTransport } = await import("../src/telegram.js");
const { runDailyDigest } = await import("../src/digest.js");
const { pollCallbacks, parseCallback } = await import("../src/callbacks.js");
const pick = await import("./fixtures/a2-fake-pick.js");
const { fakeTelegram } = await import("./fixtures/a2-fake-telegram.js");

let stateFile, tgf;
const read = () => JSON.parse(readFileSync(stateFile, "utf8"));
const tap = (id, data) => ({
  update_id: id,
  callback_query: { id: `cq${id}`, data },
});

beforeEach(async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "vince-a2cb-"));
  stateFile = path.join(dir, "state.json");
  process.env.VINCE_ARCHIVE_DIR = dir;
  tgf = fakeTelegram();
  setTransport(tgf.fn);
  await runDailyDigest(pick.fakeLeads(), stateFile, {
    dueDate: "2026-09-29",
    hour: 10,
    pick,
  });
});

test("parseCallback reads both shapes", () => {
  assert.deepEqual(parseCallback("ans:260929"), {
    action: "ans",
    oid: "260929",
  });
  assert.deepEqual(parseCallback("bad:sold:260929"), {
    action: "bad",
    code: "sold",
    oid: "260929",
  });
});

test("a bad-lead reason tap is stored as outcome.reason and shown on every card copy", async () => {
  tgf.updates.push(tap(500, "bad:value:260929"));
  const r = await pollCallbacks(stateFile);
  assert.equal(r.handled, 1);
  const s = read();
  assert.equal(s.outcomes["260929"].reason, "value_wrong");
  assert.ok(s.outcomes["260929"].reasonAt);
  assert.equal(s.offset, 501);
  const edits = tgf.calls.filter((c) => c.method === "editMessageText");
  assert.equal(edits.length, 2);
  assert.match(edits[0].payload.text, /Why this one/); // card text kept
  assert.match(edits[0].payload.text, /Marked as a bad lead: Value wrong\./);
  assert.deepEqual(edits[0].payload.reply_markup, { inline_keyboard: [] });
  const ack = tgf.calls.find((c) => c.method === "answerCallbackQuery");
  assert.equal(ack.payload.callback_query_id, "cq500");
});

test("every reason code maps to its stored reason", async () => {
  const want = {
    value: "value_wrong",
    sold: "already_sold",
    far: "too_far",
    reach: "cant_reach",
  };
  let id = 600;
  for (const [code, reason] of Object.entries(want)) {
    tgf.updates.push(tap(id++, `bad:${code}:260929`));
    await pollCallbacks(stateFile);
    assert.equal(read().outcomes["260929"].reason, reason);
  }
});

test("Answered asks about the meeting and keeps the reason buttons", async () => {
  tgf.updates.push(tap(700, "ans:260929"));
  await pollCallbacks(stateFile);
  assert.equal(read().outcomes["260929"].answered, true);
  const edit = tgf.calls.find((c) => c.method === "editMessageText");
  const labels = edit.payload.reply_markup.inline_keyboard
    .flat()
    .map((b) => b.text);
  assert.ok(labels.includes("📅 Meeting booked"));
  assert.ok(labels.includes("Value wrong"));
  tgf.updates.push(tap(701, "mtg:260929"));
  await pollCallbacks(stateFile);
  assert.equal(read().outcomes["260929"].meeting, true);
  // one-lead day: no extra recap message
  assert.equal(
    tgf.sends().filter((c) => /recap/i.test(c.payload.text)).length,
    0,
  );
});

test("an unknown outcome id is acked as expired", async () => {
  tgf.updates.push(tap(800, "ans:999999"));
  const r = await pollCallbacks(stateFile);
  assert.equal(r.handled, 0);
  const ack = tgf.calls.find((c) => c.method === "answerCallbackQuery");
  assert.match(ack.payload.text, /expired/);
});

test("with VINCE_PING_OFF=1 and no fake transport, polling never touches the network", async () => {
  setTransport(null);
  const r = await pollCallbacks(stateFile);
  assert.equal(r.handled, 0);
  assert.equal(fetchCalls, 0);
});
