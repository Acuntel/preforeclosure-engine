// A2 P0-1: email honors VINCE_EMAIL_OFF=1 and VINCE_PING_OFF=1, even with a
// mail relay configured, and never touches the network.
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";

let fetchCalls = 0;
globalThis.fetch = async () => {
  fetchCalls++;
  throw new Error("network is blocked in tests");
};
process.env.VINCE_MAIL_RELAY_URL = "https://relay.invalid/send";
process.env.VINCE_MAIL_RELAY_SECRET = "test-secret";
process.env.VINCE_LEAD_EMAIL = "nobody@example.invalid";
process.env.VINCE_LEAD_EMAIL_CC = "nobody2@example.invalid";

const { emailEnabled, emailLead, emailNotice, leadText } = await import("../src/email.js");
const lead = { address: "1 MAIN ST", city: "ELMHURST", county: "DuPage", owner: "JANE DOE" };

afterEach(() => {
  delete process.env.VINCE_EMAIL_OFF;
  delete process.env.VINCE_PING_OFF;
});

test("VINCE_EMAIL_OFF=1 stops every email", async () => {
  process.env.VINCE_EMAIL_OFF = "1";
  assert.equal(emailEnabled(), false);
  assert.equal(await emailLead(lead, { contactName: "JANE DOE" }), false);
  assert.equal(await emailNotice({ subject: "x", text: "y" }), false);
  assert.equal(fetchCalls, 0);
});

test("VINCE_PING_OFF=1 alone also stops every email", async () => {
  process.env.VINCE_PING_OFF = "1";
  assert.equal(emailEnabled(), false);
  assert.equal(await emailLead(lead, { contactName: "JANE DOE" }), false);
  assert.equal(fetchCalls, 0);
});

test("the lead email carries the EV reasoning and Brady's number, with no dashes", () => {
  const l = { ...lead, pickEval: { reasons: ["Worth about $400,000, owes about $150,000 (judgment), so about $250,000 of equity.", "The sale is in 30 days."] } };
  const t = leadText(l, "JANE DOE", "digest");
  assert.match(t, /Why this one:\nWorth about \$400,000/);
  assert.match(t, /\(847\) 212-2142/);
  assert.match(t, /one lead worth your time today/);
  assert.doesNotMatch(t, /[–—]/);
});

test("test-digest.js sets both off switches", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../test-digest.js", import.meta.url), "utf8");
  assert.match(src, /process\.env\.VINCE_PING_OFF = "1"/);
  assert.match(src, /process\.env\.VINCE_EMAIL_OFF = "1"/);
});
