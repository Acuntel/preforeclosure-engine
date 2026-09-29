// Lead email bridge: every lead that goes out through Telegram also lands in
// Vince's inbox with the same information, so he can run the phone numbers
// (or the name and address when no number scraped) through Forewarn from his
// email. Railway null-routes every outbound SMTP port, so when
// VINCE_MAIL_RELAY_URL + VINCE_MAIL_RELAY_SECRET are set the send goes over
// HTTPS through the vince-mail-relay Vercel function (which holds the Gmail
// creds); direct Gmail SMTP over TLS 465 stays as the fallback for hosts with
// open SMTP (the Mac). Silent no-op when neither transport is configured.
import { liveHost } from "./telegram.js";
import tls from "node:tls";
import { secret } from "./secrets.js";

const TO = () => process.env.VINCE_LEAD_EMAIL || "vincent@reallawgroup.com";
const CC = () => process.env.VINCE_LEAD_EMAIL_CC || "bradyschwartz25@gmail.com";

const relayConfigured = () =>
  !!(secret("VINCE_MAIL_RELAY_URL") && secret("VINCE_MAIL_RELAY_SECRET"));

// Hard off-switches: VINCE_EMAIL_OFF=1 stops email only, VINCE_PING_OFF=1 stops
// every outbound message (Telegram and email). Every dev and test run sets both.
export const emailOff = () =>
  process.env.VINCE_EMAIL_OFF === "1" || process.env.VINCE_PING_OFF === "1";

export function emailEnabled() {
  if (emailOff()) return false;
  if (!liveHost()) return false; // same one-instance guard as Telegram
  return (
    relayConfigured() ||
    !!(secret("GMAIL_USER") && secret("GMAIL_APP_PASSWORD"))
  );
}

async function relaySend({ to, subject, text }) {
  const r = await fetch(secret("VINCE_MAIL_RELAY_URL"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      secret: secret("VINCE_MAIL_RELAY_SECRET"),
      to,
      subject,
      text,
    }),
    signal: AbortSignal.timeout(30000),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.ok)
    throw new Error(`relay ${r.status}${j.error ? ` ${j.error}` : ""}`);
  return true;
}

function smtpSend({ from, to, subject, text }) {
  const user = secret("GMAIL_USER");
  const pass = secret("GMAIL_APP_PASSWORD");
  return new Promise((resolve, reject) => {
    const sock = tls.connect(465, "smtp.gmail.com", {
      servername: "smtp.gmail.com",
    });
    const rcpts = to.filter(Boolean);
    let buf = "";
    let step = 0;
    let rcptIdx = 0;
    const fail = (m) => {
      try {
        sock.destroy();
      } catch {}
      reject(new Error(m));
    };
    sock.setTimeout(20000, () => fail("smtp timeout"));
    sock.on("error", (e) => reject(e));
    const write = (line) => sock.write(line + "\r\n");
    const body =
      [
        `From: ${from}`,
        `To: ${rcpts.join(", ")}`,
        `Subject: =?UTF-8?B?${Buffer.from(subject).toString("base64")}?=`,
        "MIME-Version: 1.0",
        'Content-Type: text/plain; charset="UTF-8"',
        "Content-Transfer-Encoding: base64",
        "",
        Buffer.from(text)
          .toString("base64")
          .replace(/(.{76})/g, "$1\r\n"),
      ].join("\r\n") + "\r\n.";
    sock.on("data", (d) => {
      buf += d.toString();
      if (!/\r?\n$/.test(buf)) return;
      const code = Number(buf.slice(0, 3));
      // multiline responses: wait for the final "NNN " line
      if (
        new RegExp(`^${code}-`, "m").test(buf) &&
        !new RegExp(`^${code} `, "m").test(buf)
      )
        return;
      buf = "";
      if (code >= 400) return fail(`smtp ${code} at step ${step}`);
      if (step === 0) ((step = 1), write("EHLO soldeasier.com"));
      else if (step === 1) ((step = 2), write("AUTH LOGIN"));
      else if (step === 2)
        ((step = 3), write(Buffer.from(user).toString("base64")));
      else if (step === 3)
        ((step = 4), write(Buffer.from(pass).toString("base64")));
      else if (step === 4) ((step = 5), write(`MAIL FROM:<${user}>`));
      else if (step === 5) {
        if (rcptIdx < rcpts.length) write(`RCPT TO:<${rcpts[rcptIdx++]}>`);
        if (rcptIdx >= rcpts.length) step = 6;
      } else if (step === 6) ((step = 7), write("DATA"));
      else if (step === 7) ((step = 8), write(body));
      else if (step === 8) ((step = 9), write("QUIT"), resolve(true));
    });
  });
}

const money = (n) =>
  n == null ? "?" : "$" + Math.round(n).toLocaleString("en-US");

const SOURCES = {
  digest:
    "Source: the lead tracker's daily pick. This is the one lead worth your time today across metro Chicagoland.",
  instant:
    "Source: the lead tracker's instant alert. This filing just hit the records and could not wait for the daily pick.",
};

const BRADY_LINE =
  "What to do: look up the phone number for this name and address (Forewarn) and text it to Brady at (847) 212-2142. If a phone number is already listed below, just send that number to Brady and he will make the call.";

export function leadText(l, contactName, source) {
  const addr =
    [l.address, l.city].filter(Boolean).join(", ") || "(address pending)";
  const reasons = (l.pickEval?.reasons || []).filter(Boolean);
  const lines = [
    SOURCES[source] || SOURCES.digest,
    BRADY_LINE,
    "",
    `Contact: ${contactName}`,
    `Address: ${addr} (${l.county || "?"} County)`,
    reasons.length ? "" : null,
    reasons.length ? "Why this one:" : null,
    ...reasons,
    reasons.length ? "" : null,
    !reasons.length && l.valueGap != null
      ? `Value gap: ${money(l.valueGap)}${l.valueGapPct != null ? ` (${l.valueGapPct}%)` : ""}, ${l.valueConfidence || "unknown"} confidence.`
      : null,
    !reasons.length && l.distanceMi != null
      ? `Distance: ${l.distanceMi} miles from Elmhurst.`
      : null,
    l.distress || l.signal ? `Distress: ${l.distress || l.signal}` : null,
    l.phone
      ? `Phone: ${l.phone}${l.phoneType ? ` (${l.phoneType})` : ""}`
      : "Phone: none scraped, so search the name above in Forewarn.",
    l.email ? `Email: ${l.email}` : null,
    l.heirMailing ? `Heir mailing: ${l.heirMailing}` : null,
    l.sale ? `Sale date: ${l.sale}` : null,
    l.caseNumber
      ? `Case: ${l.caseNumber}`
      : l.docNumber
        ? `Doc: ${l.docNumber}`
        : null,
    l.sourceUrl ? `Source: ${l.sourceUrl}` : null,
    "",
    "If this lead is bad, reply with the reason (value wrong, already sold, too far, or can't reach) so tomorrow's pick gets better.",
    "Sent automatically by the lead tracker alongside the Telegram message.",
  ];
  return lines.filter((x) => x != null).join("\n");
}

async function deliver(msg) {
  if (relayConfigured()) return relaySend(msg);
  return smtpSend({
    from: `"Vince Lead Tracker" <${secret("GMAIL_USER")}>`,
    ...msg,
  });
}

// Plain notices (no-deal day, next-day follow-up). Same off-switches.
export async function emailNotice({ subject, text }) {
  if (!emailEnabled()) return false;
  try {
    await deliver({ to: [TO(), CC()], subject, text });
    console.log(`  📧 emailed notice to ${TO()} (${subject})`);
    return true;
  } catch (e) {
    console.error(`  📧 notice email failed: ${e.message || e.constructor.name}`);
    return false;
  }
}

export async function emailLead(
  l,
  { contactName = "?", source = "digest", preface = null } = {},
) {
  if (!emailEnabled()) return false; // also covers VINCE_EMAIL_OFF / VINCE_PING_OFF
  const addr =
    [l.address, l.city].filter(Boolean).join(", ") || "address pending";
  const label =
    source === "instant" ? "🚨 Instant alert lead" : "📋 Today's lead";
  const subject = `${label}: ${contactName} · ${addr}`;
  const msg = {
    to: [TO(), CC()],
    subject,
    text: (preface ? `${preface}\n\n` : "") + leadText(l, contactName, source),
  };
  try {
    await deliver(msg);
    console.log(`  📧 emailed lead to ${TO()} (${contactName})`);
    return true;
  } catch (e) {
    console.error(`  📧 lead email failed: ${e.message || e.constructor.name}`);
    return false;
  }
}
