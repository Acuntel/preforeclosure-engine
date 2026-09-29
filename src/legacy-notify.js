// Legacy send paths kept for compatibility, both OFF in the one-a-day flow:
//   runInstantAlerts: be-first pings for brand-new A-tier filings. vince-track
//     calls it only when VINCE_INSTANT=1 (default off, decision D1).
//   diffAndNotify: server.js per-record pinging (Z's REDLINE server; the Vince
//     profile uses vince-track.js instead).
// Anything sent here is excluded from later digests via sentKeys.
import { shouldPing, recordAgeDays } from "./quality.js";
import { emailLead } from "./email.js";
import { loadState, saveState, leadKey } from "./vstate.js";
import { enabled, chatIds, sendTo, sendText, esc } from "./telegram.js";
import {
  formatLead,
  formatLeadName,
  formatLeadDetails,
  contactName,
} from "./cards.js";

const MAX_PINGS_PER_RUN = Number(process.env.VINCE_MAX_PINGS || 8);
const INSTANT_MIN = Number(process.env.VINCE_INSTANT_MIN || 80);
const INSTANT_FRESH_DAYS = Number(process.env.VINCE_INSTANT_FRESH_DAYS || 7);
const INSTANT_MAX = Number(process.env.VINCE_INSTANT_MAX || 2);
const byQuality = (a, b) =>
  (b.quality ?? 0) - (a.quality ?? 0) ||
  (b.valueGap ?? -Infinity) - (a.valueGap ?? -Infinity);

export async function runInstantAlerts(leads, stateFile, { date } = {}) {
  const state = loadState(stateFile);
  if (!state.updatedAt || !(state.seen || []).length)
    return { sent: 0, hot: 0, firstRun: true };
  const seen = new Set(state.seen);
  const sentKeys = new Set(state.sentKeys || []);
  const hot = leads
    .filter((l) => {
      const k = leadKey(l);
      if (seen.has(k) || sentKeys.has(k)) return false;
      if (l.tier !== "A" || (l.quality ?? 0) < INSTANT_MIN) return false;
      const age = recordAgeDays(l);
      if (age == null || age < 0 || age > INSTANT_FRESH_DAYS) return false;
      return shouldPing(l);
    })
    .sort(byQuality);
  const st =
    state.instant && state.instant.date === date
      ? state.instant
      : { date, count: 0 };
  if (!hot.length || !enabled() || st.count >= INSTANT_MAX)
    return { sent: 0, hot: hot.length };
  const ids = await chatIds();
  if (!ids.length) return { sent: 0, hot: hot.length };

  let sent = 0;
  for (const l of hot) {
    if (st.count >= INSTANT_MAX) break;
    const oid = `i${(date || "").replace(/-/g, "").slice(4)}${st.count + 1}`;
    const msgs = [];
    for (const chatId of ids) {
      await sendTo(
        chatId,
        `🚨 <b>Hot new lead that just hit the records</b> [${esc(l.tier)} ${l.quality}]. It was too good to wait for tomorrow's pick.`,
      );
      await sendTo(chatId, formatLeadName(l));
      const mid = await sendTo(chatId, formatLeadDetails(l));
      if (mid) msgs.push({ chatId, msgId: mid });
    }
    state.outcomes[oid] = {
      name: contactName(l),
      address: [l.address, l.city].filter(Boolean).join(", "),
      quality: l.quality,
      date,
      msgs,
      answered: null,
      meeting: null,
    };
    await emailLead(l, {
      contactName: contactName(l),
      source: "instant",
    }).catch(() => {});
    const k = leadKey(l);
    sentKeys.add(k);
    seen.add(k);
    st.count++;
    sent++;
  }
  state.seen = [...seen];
  state.sentKeys = [...sentKeys];
  state.instant = st;
  saveState(stateFile, state);
  return { sent, hot: hot.length };
}

// Per-record pinging for server.js: ping good leads not pinged before.
export async function diffAndNotify(leads, stateFile) {
  const state = loadState(stateFile);
  const seen = new Set(state.seen || []);
  const pingedKeys = new Set(state.pinged || []);
  const firstRun = !state.updatedAt;
  let newCount = 0;
  for (const l of leads) {
    const k = leadKey(l);
    if (!seen.has(k)) (seen.add(k), newCount++);
  }
  const candidates = leads
    .filter((l) => shouldPing(l) && !pingedKeys.has(leadKey(l)))
    .sort(byQuality);

  let pinged = 0;
  if (enabled()) {
    if (firstRun)
      await sendText(
        `✅ <b>The Vince lead monitor is live.</b> It is tracking ${leads.length} leads across your metro Illinois counties. You will get a message when a new good lead appears.`,
      );
    for (const l of candidates.slice(0, MAX_PINGS_PER_RUN)) {
      const r = await sendText(formatLead(l));
      if (r.sentTo) (pinged++, pingedKeys.add(leadKey(l)));
    }
    if (candidates.length > MAX_PINGS_PER_RUN)
      await sendText(
        `There are ${candidates.length - MAX_PINGS_PER_RUN} more good leads this run (capped at ${MAX_PINGS_PER_RUN}). Open the board to see them all.`,
      );
  }
  saveState(stateFile, { seen: [...seen], pinged: [...pingedKeys] });
  return { newCount, goodCount: candidates.length, pinged, firstRun };
}
