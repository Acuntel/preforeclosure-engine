// Button taps from Vince (and Brady) on the daily card and follow-up:
//   🟢 Answered -> asks "meeting booked?"    🔴 No answer -> logged
//   📅 Meeting booked / ❌ No meeting -> logged
//   Value wrong / Already sold / Too far / Can't reach -> outcome.reason
// 409 rule: this is the ONLY getUpdates caller while the loop runs.
import { loadState, saveState } from "./vstate.js";
import { tg, enabled, chatIds, sendTo, editTo, ackCb } from "./telegram.js";
import { kbCard, kbMeeting, REASONS } from "./cards.js";

// Reason buttons stay on the card after a call is logged, so Vince can still
// flag a bad lead later. Only a reason tap clears the keyboard.
const reasonRows = (id) => kbCard(id).inline_keyboard.slice(1);
const kbAfterAnswer = (id) => ({
  inline_keyboard: [...kbMeeting(id).inline_keyboard, ...reasonRows(id)],
});
const kbReasons = (id) => ({ inline_keyboard: reasonRows(id) });

// Recap for legacy multi-lead days (the one-a-day flow has one lead, so the
// edited card already is the recap).
function daySummary(outcomes, date) {
  const today = Object.values(outcomes).filter((o) => o.date === date);
  if (today.length < 2) return null;
  const booked = today.filter((o) => o.meeting === true);
  const noAns = today.filter((o) => o.answered === false);
  const parts = [
    `📋 <b>Today's recap.</b> We sent ${today.length} leads: ${today.map((o) => o.name).join(", ")}.`,
  ];
  if (booked.length)
    parts.push(
      `You booked meetings with ${booked.map((o) => o.name).join(", ")}.`,
    );
  if (noAns.length)
    parts.push(
      `${noAns.map((o) => o.name).join(", ")} did not answer, so they are worth a follow-up call.`,
    );
  return parts.join(" ");
}

// Parse "act:oid" or "bad:code:oid" into { action, oid, code }.
export function parseCallback(data) {
  const parts = String(data || "").split(":");
  if (parts[0] === "bad")
    return { action: "bad", code: parts[1], oid: parts[2] };
  return { action: parts[0], oid: parts[1] };
}

// Apply one tap to an outcome. Returns { note, tag, kb } for the ack + card edit.
export function applyTap(o, { action, code }) {
  if (action === "ans") {
    o.answered = true;
    return {
      note: "Answered. Did you book a meeting?",
      tag: "🟢 Answered. Did you book a meeting?",
      kb: kbAfterAnswer,
    };
  }
  if (action === "no") {
    o.answered = false;
    return { note: "No answer logged.", tag: "🔴 No answer logged.", kb: kbReasons };
  }
  if (action === "mtg") {
    o.meeting = true;
    return { note: "Meeting booked. Nice work.", tag: "📅 Meeting booked.", kb: kbReasons };
  }
  if (action === "nomtg") {
    o.meeting = false;
    return { note: "No meeting logged.", tag: "❌ No meeting logged.", kb: kbReasons };
  }
  if (action === "bad" && REASONS[code]) {
    o.reason = REASONS[code].reason;
    o.reasonAt = new Date().toISOString();
    const t = `Marked as a bad lead: ${REASONS[code].label}. Thanks, this makes tomorrow's pick better.`;
    return { note: t, tag: `⚠️ ${t}` };
  }
  return null;
}

const resolved = (x) => x.answered === false || x.meeting != null || !!x.reason;

export async function pollCallbacks(stateFile) {
  if (!enabled()) return { handled: 0 };
  const state = loadState(stateFile);
  const j = await tg("getUpdates", {
    offset: state.offset || 0,
    timeout: 0,
    allowed_updates: ["callback_query"],
  });
  if (!j?.ok || !(j.result || []).length) return { handled: 0 };

  let handled = 0;
  const recapped = new Set();
  for (const u of j.result || []) {
    state.offset = Math.max(state.offset || 0, u.update_id + 1);
    const cq = u.callback_query;
    if (!cq?.data) continue;
    const tap = parseCallback(cq.data);
    const o = state.outcomes[tap.oid];
    if (!o) {
      await ackCb(cq.id, "This lead has expired.");
      continue;
    }
    const res = applyTap(o, tap);
    if (!res) {
      await ackCb(cq.id);
      continue;
    }
    const kb = res.kb ? res.kb(tap.oid) : null;
    // Reflect the outcome on every copy of the card and of the follow-up.
    const body = o.cardText || `${o.name}, <b>${o.address}</b>`;
    for (const m of o.msgs || [])
      await editTo(m.chatId, m.msgId, `${body}\n\n${res.tag}`, kb);
    for (const m of o.followUpMsgs || [])
      await editTo(
        m.chatId,
        m.msgId,
        `${o.name}, <b>${o.address}</b>\n${res.tag}`,
        kb,
      );
    await ackCb(cq.id, res.note);
    handled++;

    const day = o.date;
    if (!recapped.has(day)) {
      const dayLeads = Object.values(state.outcomes).filter(
        (x) => x.date === day,
      );
      if (dayLeads.length && dayLeads.every(resolved)) {
        const text = daySummary(state.outcomes, day);
        if (text) for (const id of await chatIds()) await sendTo(id, text);
        recapped.add(day);
      }
    }
  }
  saveState(stateFile, state);
  return { handled };
}
