// One-shot: the moment ANYONE messages @BradyVinceCook_bot, capture the chat id
// and fire the real Vince lead pings. Telegram forbids a bot from messaging a user
// who hasn't opened the chat first, so this waits for that first tap, then sends.
process.env.PROFILE = "vince";
const { readFileSync } = await import("node:fs");
const path = await import("node:path");
const { sendText, formatLead } = await import("./src/notify.js");
const { secret } = await import("./src/secrets.js");

const TOKEN = secret("VINCE_BOT_TOKEN");
const api = (m) => `https://api.telegram.org/bot${TOKEN}/${m}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function haveChat() {
  if (secret("VINCE_CHAT_ID")) return true;
  try {
    const j = await (await fetch(api("getUpdates"))).json();
    return (j.result || []).some(
      (u) => (u.message || u.my_chat_member || {}).chat?.id,
    );
  } catch {
    return false;
  }
}

const leads = JSON.parse(
  readFileSync(path.join(process.cwd(), "demo", "leads-vince.json"), "utf8"),
).leads;

const DEADLINE = Date.now() + 45 * 60_000; // wait up to 45 min for the first tap
console.log("waiting for you to tap Start in @BradyVinceCook_bot …");
let ready = false;
while (Date.now() < DEADLINE) {
  if (await haveChat()) {
    ready = true;
    break;
  }
  await sleep(4000);
}
if (!ready) {
  console.log(
    "no chat yet after 15 min — tap Start and re-run `node vince-ping-now.js`.",
  );
  process.exit(0);
}

// sendText() auto-captures + remembers the chat id via getUpdates on first send.
const hello = await sendText(
  `✅ <b>Connected.</b> Vince distressed-lead alerts are live on this chat. Here are the current top leads (DuPage + Berkeley/Hillside/Northlake/Bellwood), ranked by under-market value gap. New records ping the moment they hit.`,
);
console.log("connect sent to", hello.sentTo, "chat(s)");

const top = [...leads]
  .sort((a, b) => (b.valueGap ?? -Infinity) - (a.valueGap ?? -Infinity))
  .slice(0, 6);
let sent = 0;
for (const l of top) {
  const r = await sendText(formatLead(l));
  if (r.sentTo) sent++;
  await sleep(500);
}
console.log(`pinged ${sent}/${top.length} leads. Done.`);
process.exit(0);
