// Telegram copy for Vince: the daily card, the no-deal line, the next-day
// follow-up, and the button keyboards. Copy rules: full sentences, no em or en
// dashes anywhere a human reads it.
import { esc, money } from "./telegram.js";

const addrOf = (l) =>
  [l.address, l.city].filter(Boolean).join(", ") || "(address pending)";

// The person Vince actually calls: the heir on a probate lead, else the owner.
// Court captions list every defendant ("JANE DOE; et. al.", "..., UNKNOWN
// HEIRS AND LEGATEES OF ..."), so keep the first party only.
export function contactName(l) {
  const raw = l.heirName || l.owner || l.occupant;
  if (!raw) return "(owner name pending)";
  let s = String(raw).split(";")[0];
  s = s.replace(/,?\s*\bet\.?\s*al\.?/gi, "").replace(/\s+/g, " ").trim();
  if (s.length > 80 && s.includes(",")) s = s.slice(0, s.indexOf(",")).trim();
  return s || String(raw).trim();
}

// Card message 1: JUST the name, so Vince can drop it into his app for a phone.
export function formatLeadName(l) {
  return `👤 <b>${esc(contactName(l))}</b>`;
}

const caseLine = (l) =>
  l.caseNumber
    ? `Case ${esc(l.caseNumber)}.`
    : l.docNumber
      ? `Recorded document ${esc(l.docNumber)}.`
      : null;

// Card message 2: today's one pick, with the EV reasoning from pick.js.
export function formatLeadDetails(l) {
  const ev = l.pickEval || {};
  const t = ev.terms || {};
  const reasons = (ev.reasons || []).filter(Boolean);
  const lines = [
    `☀️ <b>Today's lead: ${esc(addrOf(l))}</b>${l.county ? ` (${esc(l.county)} County)` : ""}`,
    "",
    reasons.length
      ? `<b>Why this one:</b>\n${reasons.map((r) => esc(r)).join("\n")}`
      : null,
    !reasons.length && t.equity != null
      ? `There is about ${money(t.equity)} of equity.`
      : null,
    !reasons.length && (l.distress || l.signal)
      ? `The distress signal is ${esc(l.distress || l.signal)}.`
      : null,
    l.sale ? `The sale date is ${esc(l.sale)}.` : null,
    l.phone
      ? `📞 ${esc(l.phone)}${l.phoneType ? ` (${esc(l.phoneType)})` : ""}`
      : "📞 Put the name above into your app to get the number.",
    l.email ? `✉️ ${esc(l.email)}` : null,
    l.heirMailing
      ? `The heir's mailing address is ${esc(l.heirMailing)}.`
      : null,
    caseLine(l),
    l.sourceUrl ? `🔗 ${esc(l.sourceUrl)}` : null,
    "",
    "Tap a button after you call. If the lead is bad, tap the reason so tomorrow's pick gets better.",
  ];
  return lines
    .filter((x) => x != null)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n");
}

// D4: honest no-deal day. nearMiss = { lead, gate, reason } from pickDaily.
// pick.js reasons are full sentences ("The sale is only 7 days away..."), so
// they follow the address as their own sentence; a bare phrase gets a comma.
export function formatNoDeal(nearMiss) {
  const head = "☀️ <b>No deal worth your time today.</b>";
  if (!nearMiss?.lead) return `${head} Nothing in the pool cleared the bar.`;
  const addr = esc(addrOf(nearMiss.lead));
  const reason = String(nearMiss.reason || "").trim();
  if (!reason) return `${head} Closest miss: ${addr}.`;
  if (/^[A-Z]/.test(reason))
    return `${head} Closest miss: ${addr}. ${esc(/[.!?]$/.test(reason) ? reason : reason + ".")}`;
  return `${head} Closest miss: ${addr}, ${esc(reason.replace(/\.$/, ""))}.`;
}

// P1-4: one-time next-day check on the last lead when no button was tapped.
// when = "yesterday's lead" or "the lead from 2026-09-26".
export function formatFollowUp(o, when = "yesterday's lead") {
  return `Quick check on ${esc(when)}, ${esc(o.name)} at <b>${esc(o.address)}</b>. Did you reach them? Tap a button below. If it was a bad lead, tap the reason.`;
}

// Bad-lead reasons: callback code -> stored outcome.reason + button label.
export const REASONS = {
  value: { reason: "value_wrong", label: "Value wrong" },
  sold: { reason: "already_sold", label: "Already sold" },
  far: { reason: "too_far", label: "Too far" },
  reach: { reason: "cant_reach", label: "Can't reach" },
};

export const kbCard = (id) => ({
  inline_keyboard: [
    [
      { text: "🟢 Answered", callback_data: `ans:${id}` },
      { text: "🔴 No answer", callback_data: `no:${id}` },
    ],
    [
      { text: REASONS.value.label, callback_data: `bad:value:${id}` },
      { text: REASONS.sold.label, callback_data: `bad:sold:${id}` },
    ],
    [
      { text: REASONS.far.label, callback_data: `bad:far:${id}` },
      { text: REASONS.reach.label, callback_data: `bad:reach:${id}` },
    ],
  ],
});

export const kbMeeting = (id) => ({
  inline_keyboard: [
    [
      { text: "📅 Meeting booked", callback_data: `mtg:${id}` },
      { text: "❌ No meeting", callback_data: `nomtg:${id}` },
    ],
  ],
});

// Legacy one-message format, still used by vince-ping-now.js and
// vince-wait-brady.js.
export function formatLead(l) {
  const gap =
    l.valueGap != null
      ? `💰 <b>Value gap: ${money(l.valueGap)}${l.valueGapPct != null ? ` (${l.valueGapPct}%)` : ""}</b>, ${esc(l.valueConfidence || "unknown")} confidence.`
      : "💰 The value gap is still pending.";
  const lines = [
    `🏠 <b>VINCE DISTRESSED LEAD</b>${l.tier ? ` [${esc(l.tier)} ${l.quality}]` : ""}, ${esc(l.county)} County`,
    `<b>${esc(addrOf(l))}</b>`,
    l.distress || l.signal ? `🎯 ${esc(l.distress || l.signal)}` : null,
    gap,
    l.owner ? `👤 ${esc(l.owner)}` : "👤 The owner name is still pending.",
    l.phone
      ? `📞 ${esc(l.phone)}`
      : "📞 The address and name are ready for Forewarn.",
    l.sale ? `📅 The sale date is ${esc(l.sale)}.` : null,
    caseLine(l),
    l.sourceUrl ? `🔗 ${esc(l.sourceUrl)}` : null,
  ];
  return lines.filter(Boolean).join("\n");
}

// Plain-text version of a card for the terminal (dry-run, test-digest).
export const stripHtml = (s) =>
  String(s)
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
