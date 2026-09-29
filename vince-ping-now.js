// One-shot onboarding: the moment someone taps Start in @BradyVinceCook_bot,
// capture the chat id and send a welcome plus today's ONE pick. Telegram forbids
// a bot from messaging a user who has not opened the chat first, so this waits
// for that first tap. It does not mark anything as sent (the daily digest owns
// that), and VINCE_PING_OFF=1 stops it before any network call.
//
// ⚠️ Do not run this while the Railway tracker is live: two getUpdates callers
// make Telegram return 409.
process.env.PROFILE = "vince";
if (process.env.VINCE_PING_OFF === "1") {
  console.log("VINCE_PING_OFF=1, so nothing will be sent. Exiting.");
  process.exit(0);
}
const { readFileSync } = await import("node:fs");
const path = await import("node:path");
const { sendText, formatLeadName, formatLeadDetails } =
  await import("./src/notify.js");
const { tg, chatIds } = await import("./src/telegram.js");
const { secret } = await import("./src/secrets.js");
const { loadState } = await import("./src/vstate.js");
const { loadPick, makeIsSent, sentSetFor } = await import("./src/sentkeys.js");
const { PROFILE } = await import("./src/profile.js");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const WAIT_MIN = 45;

async function haveChat() {
  if (secret("VINCE_CHAT_ID")) return true;
  const j = await tg("getUpdates", {});
  return (j?.result || []).some(
    (u) => (u.message || u.my_chat_member || {}).chat?.id,
  );
}

const leads = JSON.parse(
  readFileSync(path.join(process.cwd(), "demo", "leads-vince.json"), "utf8"),
).leads;

const deadline = Date.now() + WAIT_MIN * 60_000;
console.log("waiting for you to tap Start in @BradyVinceCook_bot …");
let ready = false;
while (Date.now() < deadline) {
  if (await haveChat()) {
    ready = true;
    break;
  }
  await sleep(4000);
}
if (!ready) {
  console.log(
    `No chat yet after ${WAIT_MIN} minutes. Tap Start and run \`node vince-ping-now.js\` again.`,
  );
  process.exit(0);
}

const hello = await sendText(
  "✅ <b>Connected.</b> Vince's lead alerts are live on this chat. You will get one lead a day at 10:00 Chicago time, the best deal in the pool, or a short note when nothing is worth your time.",
);
console.log("welcome sent to", hello.sentTo, "chat(s)");

// Today's single pick, checked against everything already sent (read only).
const pick = await loadPick();
const state = loadState(PROFILE.stateFile);
const r = pick.pickDaily(leads, {
  isSent: makeIsSent(pick, sentSetFor(pick, state)),
});
if (!r.pick) {
  console.log(
    "no lead passes every gate right now; only the welcome was sent.",
  );
  process.exit(0);
}
for (const id of await chatIds()) {
  await tg("sendMessage", {
    chat_id: id,
    text: formatLeadName(r.pick),
    parse_mode: "HTML",
  });
  await tg("sendMessage", {
    chat_id: id,
    text: formatLeadDetails(r.pick),
    parse_mode: "HTML",
    disable_web_page_preview: true,
  });
}
console.log(`sent today's pick: ${r.pick.address}, ${r.pick.city}. Done.`);
process.exit(0);
