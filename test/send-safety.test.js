// Send-safety fixes from the 2026-09-28 review: no duplicate name messages when
// the card fails, Railway-only real sends, unreadable state stops the pass,
// and --digest-now never sends twice in a day without --resend.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.VINCE_PING_OFF = "1";
process.env.VINCE_EMAIL_OFF = "1";
process.env.VINCE_CHAT_ID = "111";
globalThis.fetch = async () => {
  throw new Error("network is blocked in tests");
};

const tg = await import("../src/telegram.js");
const { runDailyDigest } = await import("../src/digest.js");
const { loadState } = await import("../src/vstate.js");
const pick = await import("./fixtures/a2-fake-pick.js");

let dir, stateFile;
const read = () => JSON.parse(readFileSync(stateFile, "utf8"));
const run = (date, opts = {}) =>
  runDailyDigest(pick.fakeLeads(), stateFile, {
    dueDate: date,
    hour: 10,
    pick,
    ...opts,
  });

// Scripted transport: each sendMessage takes the next outcome from `script`
// ("ok" | "fail" | "unknown"), then "ok" once the script runs out.
function scripted(script) {
  let mid = 500;
  const calls = [];
  const fn = async (method, payload) => {
    if (method !== "sendMessage") return { ok: true, result: true };
    calls.push(payload);
    const step = script.shift() || "ok";
    if (step === "fail") return { ok: false, description: "Bad Gateway" };
    if (step === "unknown") return { ok: false, unknown: true };
    return { ok: true, result: { message_id: ++mid } };
  };
  return { fn, calls };
}

beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), "vince-safety-"));
  stateFile = path.join(dir, "state.json");
  process.env.VINCE_ARCHIVE_DIR = dir;
  delete process.env.FAKE_PICK_NONE;
  delete process.env.FAKE_HEALTH_BAD;
});

test("name delivered, card fails once: card retried in-pass, name never resent", async () => {
  const t = scripted(["ok", "fail", "ok"]);
  tg.setTransport(t.fn);
  const d = await run("2026-09-29");
  assert.equal(d.decision, "pick-sent");
  assert.equal(t.calls.length, 3);
  assert.equal(
    t.calls.filter((c) => !c.reply_markup).length,
    1,
    "one name message",
  );
  await run("2026-09-29");
  assert.equal(t.calls.length, 3, "nothing more that day");
});

test("name delivered, card always fails: counted delivered, no resend on later passes", async () => {
  const t = scripted(["ok", "fail", "fail", "fail", "fail", "fail", "fail"]);
  tg.setTransport(t.fn);
  await run("2026-09-29");
  const n = t.calls.length;
  assert.equal(n, 4); // name + 3 card tries
  for (let i = 0; i < 3; i++) await run("2026-09-29");
  assert.equal(t.calls.length, n, "no second name message the same day");
  assert.equal(read().lastDigestDate, "2026-09-29");
});

test("name fails cleanly: nothing delivered, the next pass retries", async () => {
  const t = scripted(["fail"]);
  tg.setTransport(t.fn);
  const d1 = await run("2026-09-29");
  assert.equal(d1.decision, "pick-failed");
  assert.equal(t.calls.length, 1);
  const d2 = await run("2026-09-29");
  assert.equal(d2.decision, "pick-sent");
});

test("--digest-now (force) does not send twice in a day unless resend is set", async () => {
  const t = scripted([]);
  tg.setTransport(t.fn);
  await run("2026-09-29");
  const n = t.calls.length;
  await run("2026-09-29", { force: true });
  assert.equal(t.calls.length, n, "force alone is refused on a done day");
  await run("2026-09-29", { force: true, resend: true });
  assert.ok(t.calls.length > n, "force + resend sends again");
});

test("real sends need Railway or VINCE_ALLOW_LOCAL_SEND=1", () => {
  tg.setTransport(null);
  const saved = { ...process.env };
  delete process.env.VINCE_PING_OFF;
  delete process.env.RAILWAY_ENVIRONMENT;
  delete process.env.RAILWAY_ENVIRONMENT_NAME;
  delete process.env.RAILWAY_PROJECT_ID;
  delete process.env.VINCE_ALLOW_LOCAL_SEND;
  process.env.VINCE_BOT_TOKEN = "123:fake";
  try {
    assert.equal(tg.liveHost(), false);
    assert.equal(tg.enabled(), false);
    process.env.RAILWAY_ENVIRONMENT_NAME = "production";
    assert.equal(tg.enabled(), true);
    delete process.env.RAILWAY_ENVIRONMENT_NAME;
    process.env.VINCE_ALLOW_LOCAL_SEND = "1";
    assert.equal(tg.enabled(), true);
  } finally {
    for (const k of Object.keys(process.env))
      if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
  }
});

test("tg(): pre-connect errors are definite failures, anything later is unknown", async () => {
  tg.setTransport(null);
  const saved = { ...process.env };
  const savedFetch = globalThis.fetch;
  delete process.env.VINCE_PING_OFF;
  process.env.VINCE_ALLOW_LOCAL_SEND = "1";
  process.env.VINCE_BOT_TOKEN = "123:fake";
  const boom = (code) => async () => {
    const e = new TypeError("fetch failed");
    e.cause = { code };
    throw e;
  };
  try {
    globalThis.fetch = boom("ENOTFOUND");
    assert.equal(await tg.tg("sendMessage", {}), null);
    globalThis.fetch = boom("ECONNRESET");
    assert.deepEqual(await tg.tg("sendMessage", {}), {
      ok: false,
      unknown: true,
    });
    globalThis.fetch = async () => ({
      json: async () => {
        throw new SyntaxError("html");
      },
    });
    assert.deepEqual(await tg.tg("sendMessage", {}), {
      ok: false,
      unknown: true,
    });
  } finally {
    globalThis.fetch = savedFetch;
    for (const k of Object.keys(process.env))
      if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
  }
});

test("an existing but unreadable state file throws instead of loading empty", () => {
  writeFileSync(stateFile, "{ not json");
  assert.throws(() => loadState(stateFile), /state read failed/);
  assert.equal(readFileSync(stateFile, "utf8"), "{ not json", "file untouched");
});
