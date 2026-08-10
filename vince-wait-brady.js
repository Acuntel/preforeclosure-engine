// Waits for a NEW person to tap Start on @BradyVinceCook_bot (i.e. Brady, since
// Vince's chat 8739469416 is already known) and pings THAT chat the current top
// leads. Sends only to the new chat, so it doesn't re-spam whoever's already in.
process.env.PROFILE = "vince";
const { readFileSync } = await import("node:fs");
const path = await import("node:path");
const { formatLead } = await import("./src/notify.js");
const { secret, rememberSecret } = await import("./src/secrets.js");

const TOKEN = secret("VINCE_BOT_TOKEN");
const api = (m) => `https://api.telegram.org/bot${TOKEN}/${m}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const known = new Set(
  secret("VINCE_CHAT_ID")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
);
console.log("already-known chats:", [...known].join(",") || "(none)");

async function newChats() {
  try {
    const j = await (await fetch(api("getUpdates?limit=30"))).json();
    const found = new Set();
    for (const u of j.result || []) {
      const id = u?.message?.chat?.id ?? u?.my_chat_member?.chat?.id;
      const name = (u?.message?.chat || u?.my_chat_member?.chat || {})
        .first_name;
      if (id && !known.has(String(id)))
        found.add(JSON.stringify({ id: String(id), name }));
    }
    return [...found].map((s) => JSON.parse(s));
  } catch {
    return [];
  }
}

async function send(chatId, text) {
  const r = await fetch(api("sendMessage"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
    }),
  });
  return r.json();
}

const leads = JSON.parse(
  readFileSync(path.join(process.cwd(), "demo", "leads-vince.json"), "utf8"),
).leads;
const top = [...leads]
  .sort((a, b) => (b.valueGap ?? -1e15) - (a.valueGap ?? -1e15))
  .slice(0, 6);

console.log(
  "waiting for a NEW chat (tap Start in @BradyVinceCook_bot on your phone)…",
);
const DEADLINE = Date.now() + 45 * 60_000;
while (Date.now() < DEADLINE) {
  const fresh = await newChats();
  if (fresh.length) {
    for (const c of fresh) {
      console.log(`NEW chat: ${c.id} (${c.name || "?"}) — pinging`);
      await send(
        c.id,
        `✅ <b>Connected.</b> Vince distressed-lead alerts are live on this chat. Current top leads below, ranked by under-market value gap.`,
      );
      let sent = 0;
      for (const l of top) {
        const r = await send(c.id, formatLead(l));
        if (r.ok) sent++;
        await sleep(400);
      }
      console.log(`  pinged ${sent}/${top.length} to ${c.id}`);
      known.add(c.id);
    }
    rememberSecret("VINCE_CHAT_ID", [...known].join(","));
    console.log("subscribers now:", [...known].join(","));
    process.exit(0);
  }
  await sleep(4000);
}
console.log(
  "no new chat after 45 min — tap Start and re-run `node vince-wait-brady.js`.",
);
process.exit(0);
