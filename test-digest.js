// Brady-only live test of the interactive daily digest: sends the current top 3 as
// name + details + 🟢/🔴 buttons to Brady's chat ONLY (not Vince), then polls for
// button taps for ~12 min so the answered → meeting → recap flow can be exercised.
process.env.PROFILE = "vince";
process.env.VINCE_CHAT_ID = "8642564368"; // Brady only — Vince is NOT pinged
delete process.env.VINCE_PING_OFF;

const { readFileSync } = await import("node:fs");
const { runDailyDigest, pollCallbacks } = await import("./src/notify.js");

const STATE = ".vince-test-state.json";
const leads = JSON.parse(readFileSync("demo/leads-vince.json", "utf8")).leads;

const d = await runDailyDigest(leads, STATE, { force: true });
console.log(
  `sent top ${d.sentNow} of ${d.qualified} qualified → Brady's chat. Tap the buttons…`,
);

const end = Date.now() + 12 * 60_000;
while (Date.now() < end) {
  const r = await pollCallbacks(STATE).catch(() => ({ handled: 0 }));
  if (r.handled) console.log(`handled ${r.handled} tap(s)`);
  await new Promise((r) => setTimeout(r, 4000));
}
console.log("test window ended");
process.exit(0);
