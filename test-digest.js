// Local end-to-end run of the daily pick against a FAKE Telegram that prints
// every message to the terminal. Never sends a Telegram message or an email:
// both off switches are forced on, and the state file is a scratch copy.
//
//   node test-digest.js [--from leads.json] [--state copy-of-state.json]
//
// Default pool = demo/leads-vince.json. Default state = a fresh file in the OS
// temp dir (pass --state to replay against a COPY of production state).
process.env.PROFILE = "vince";
process.env.VINCE_PING_OFF = "1";
process.env.VINCE_EMAIL_OFF = "1";
process.env.VINCE_CHAT_ID = "test-chat";

const { readFileSync, mkdtempSync } = await import("node:fs");
const os = await import("node:os");
const path = await import("node:path");
const arg = (n) => {
  const i = process.argv.indexOf(n);
  return i > 0 ? process.argv[i + 1] : null;
};
const dir = mkdtempSync(path.join(os.tmpdir(), "vince-test-digest-"));
process.env.VINCE_ARCHIVE_DIR = dir;
const STATE = arg("--state") || path.join(dir, "state.json");
const FROM = arg("--from") || "demo/leads-vince.json";

const { setTransport } = await import("./src/telegram.js");
const { runDailyDigest } = await import("./src/digest.js");
const { stripHtml } = await import("./src/cards.js");

let mid = 1;
setTransport(async (method, payload) => {
  if (method === "sendMessage") {
    const kb = payload.reply_markup?.inline_keyboard?.flat().map((b) => `[${b.text}]`).join(" ");
    console.log(`\n── to ${payload.chat_id} ──\n${stripHtml(payload.text)}${kb ? `\n${kb}` : ""}`);
    return { ok: true, result: { message_id: mid++ } };
  }
  return { ok: true, result: [] };
});

const raw = JSON.parse(readFileSync(FROM, "utf8"));
const leads = Array.isArray(raw) ? raw : raw.leads;
const d = await runDailyDigest(leads, STATE, { force: true, hour: 10, sources: raw.sources });
console.log(`\n${d.decision}: ${d.qualified} of ${leads.length} pass every gate. State: ${STATE}. Snapshot dir: ${dir}/picks`);
