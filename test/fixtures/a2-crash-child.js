// Child process for the crash test: runs the digest with a fake Telegram that
// accepts the card (message_id comes back), logs it, then kills the process
// before runDailyDigest can save the sent state. argv: stateFile logFile date
import { appendFileSync } from "node:fs";
process.env.VINCE_PING_OFF = "1";
process.env.VINCE_EMAIL_OFF = "1";
process.env.VINCE_CHAT_ID = "111";
globalThis.fetch = async () => {
  throw new Error("network is blocked in tests");
};
const [stateFile, logFile, date] = process.argv.slice(2);
if (!stateFile || !logFile || !date) {
  // `node --test test/` also runs fixture files; without args this is a no-op.
  process.exit(0);
}
const { setTransport } = await import("../../src/telegram.js");
const { runDailyDigest } = await import("../../src/digest.js");
const pick = await import("./a2-fake-pick.js");
setTransport(async (method, payload) => {
  if (method !== "sendMessage") return { ok: true, result: true };
  appendFileSync(logFile, JSON.stringify({ text: payload.text }) + "\n");
  if (payload.reply_markup) process.exit(1); // the card was delivered; crash now
  return { ok: true, result: { message_id: 7 } };
});
await runDailyDigest(pick.fakeLeads(), stateFile, { dueDate: date, hour: 10, pick });
console.log("UNREACHABLE: the child should have crashed mid-send");
