// One-off: re-email leads that already went out via Telegram on a given day
// (e.g. the email leg failed while Telegram succeeded). Reads the day's picks
// from state (.outcomes) and their full details from the archived pool file,
// then sends ONLY email — never touches Telegram, never writes state.
//
//   node vince-email-today.js [poolFile] [stateFile] [YYYY-MM-DD]
//
// Defaults: data/leads-vince-<today Chicago>.json, the profile state file,
// today in Chicago. Pool file may be a runAll result ({leads:[…]}) or a bare
// lead array.
process.env.PROFILE = "vince";

import { readFileSync } from "node:fs";
import path from "node:path";
import { PROFILE } from "./src/profile.js";
import { emailLead, emailEnabled } from "./src/email.js";

const chicagoToday = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago" }).format(
    new Date(),
  );

const date = process.argv[4] || chicagoToday();
const poolFile =
  process.argv[2] ||
  path.join(process.cwd(), "data", `leads-vince-${date}.json`);
const stateFile =
  process.argv[3] ||
  (path.isAbsolute(PROFILE.stateFile)
    ? PROFILE.stateFile
    : path.join(process.cwd(), PROFILE.stateFile));

if (!emailEnabled()) {
  console.error(
    "No email transport configured (VINCE_MAIL_RELAY_URL+SECRET or GMAIL_USER+GMAIL_APP_PASSWORD).",
  );
  process.exit(1);
}

const state = JSON.parse(readFileSync(stateFile, "utf8"));
const raw = JSON.parse(readFileSync(poolFile, "utf8"));
const pool = Array.isArray(raw) ? raw : raw.leads || [];
const todays = Object.entries(state.outcomes || {}).filter(
  ([, o]) => o.date === date,
);
if (!todays.length) {
  console.error(
    `No sent leads recorded in state for ${date} — nothing to email.`,
  );
  process.exit(1);
}

const norm = (s) =>
  String(s || "")
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, "")
    .replace(/\s+/g, " ")
    .trim();

let sent = 0;
let failed = 0;
for (const [oid, o] of todays) {
  const target = norm(o.address);
  const lead = pool.find(
    (l) => norm([l.address, l.city].filter(Boolean).join(", ")) === target,
  );
  if (!lead) {
    console.error(`  ✗ ${oid} ${o.name} — no pool match for "${o.address}"`);
    failed++;
    continue;
  }
  const ok = await emailLead(lead, {
    contactName: o.name,
    source: oid.startsWith("i") ? "instant" : "digest",
  });
  ok ? sent++ : failed++;
}
console.log(`Done: ${sent} emailed, ${failed} failed (${date}).`);
process.exit(failed ? 1 : 0);
