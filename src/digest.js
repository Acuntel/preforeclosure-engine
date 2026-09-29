// The daily pick (P0-4, P0-5, P0-6, P1-4): once per Chicago day, send Vince
// EXACTLY ONE lead, the best one pick.js finds, or an honest no-deal line.
//
// Crash safety (at most once per day):
//   1. save lastDigestDate + state.pending { phase:"sending", keys, outcome } BEFORE
//      any Telegram call; if that save fails, nothing is sent.
//   2. a lead counts as sent only when Telegram returns a message_id; then the
//      outcome and every alias key are saved and pending is cleared.
//   3. a definite failure (no message_id, no timeout) sets phase "failed" and the
//      next pass retries. A pending still in "sending" on a later pass means the
//      process died (or timed out) mid-send: Telegram may have delivered it, so it
//      is treated as delivered and never resent.
import { loadState, saveState, leadKey } from "./vstate.js";
import { enabled, chatIds, sendMsg } from "./telegram.js";
import * as C from "./cards.js";
import { emailLead, emailNotice } from "./email.js";
import {
  loadPick,
  allKeys,
  makeIsSent,
  backfillAliases,
  sentSetFor,
} from "./sentkeys.js";
import { buildSnapshot, writePickSnapshot } from "./archive.js";

export const DAILY_CAP = 1; // hard cap, whatever VINCE_DAILY_COUNT says
const MAX_ATTEMPTS = 6;
const cutoffHour = () => Number(process.env.VINCE_DIGEST_CUTOFF_HOUR || 14);
const iso = () => new Date().toISOString();
const addrOf = (l) => [l.address, l.city].filter(Boolean).join(", ");
export const chicagoDate = (d = new Date()) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago" }).format(d);
const dayGap = (a, b) =>
  Math.round(
    (Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 864e5,
  );

// Outcome id = yymmdd (e.g. 260929); a suffix only if a forced resend reuses a day.
function newOid(state, date) {
  const base = String(date).replace(/-/g, "").slice(2);
  let id = base;
  for (let i = 2; state.outcomes[id]; i++) id = `${base}${i}`;
  return id;
}

// Settle a pending marker left by an earlier pass. Returns a log note or null.
function settlePending(state, sent, dueDate) {
  const p = state.pending;
  if (!p) return null;
  if (p.phase === "sending") {
    for (const k of p.keys || []) sent.add(k);
    if (p.kind === "pick" && p.oid && !state.outcomes[p.oid])
      state.outcomes[p.oid] = { ...p.outcome, unconfirmed: true };
    state.pending = null;
    return `the ${p.date} ${p.kind} was mid-send when the last pass stopped, so it counts as delivered (no resend)`;
  }
  if ((dueDate && p.date !== dueDate) || (p.attempts || 0) >= MAX_ATTEMPTS) {
    state.pending = null;
    return `gave up on the ${p.date} ${p.kind} after ${p.attempts} failed attempt(s)`;
  }
  return null;
}

// Deliver one Telegram message set to every chat under the pending protocol.
// build(chatId) sends and returns the { id, unknown } of the message that counts.
async function deliverOnce(stateFile, state, pending, ids, build) {
  state.lastDigestDate = pending.date;
  state.pending = pending;
  if (!saveState(stateFile, state)) return { status: "save-failed", msgs: [] };
  const msgs = [];
  let unknown = false;
  for (const chatId of ids) {
    const m = await build(chatId);
    if (m.id) msgs.push({ chatId, msgId: m.id });
    if (m.unknown) unknown = true;
  }
  if (msgs.length) return { status: "sent", msgs };
  if (unknown) return { status: "unknown", msgs }; // stays "sending"
  pending.phase = "failed";
  return { status: "failed", msgs };
}

// One-time follow-up on the most recent earlier pick with no outcome yet. D1 is
// literally one message a day, so this is NOT sent on its own: it returns one
// line that goes on top of today's card (and the lead email). Picks whose
// delivery was never confirmed get no follow-up.
function followUpLine(state, day) {
  const prev = Object.entries(state.outcomes)
    .filter(([, o]) => o.v === 2 && o.date && o.date < day)
    .sort((a, b) => (a[1].date < b[1].date ? 1 : -1));
  if (!prev.length) return null;
  const [, o] = prev[0];
  if (o.unconfirmed || o.answered != null || o.meeting != null || o.reason || o.followUpAt)
    return null;
  const when = dayGap(o.date, day) === 1 ? "yesterday's lead" : `the lead from ${o.date}`;
  return { o, text: C.formatFollowUp(o, when) };
}

async function sendPick(ctx, l) {
  const { stateFile, state, sent, day, ids, pick } = ctx;
  const oid = newOid(state, day);
  const card = (ctx.followLine ? `${ctx.followLine}\n\n` : "") + C.formatLeadDetails(l);
  const ev = l.pickEval || {};
  const outcome = {
    v: 2,
    name: C.contactName(l),
    address: addrOf(l),
    county: l.county,
    quality: l.quality,
    ev: Math.round(ev.ev || 0),
    terms: ev.terms || null,
    reasons: ev.reasons || [],
    date: day,
    msgs: [],
    cardText: card,
    answered: null,
    meeting: null,
    reason: null,
  };
  const keys = allKeys(pick, l);
  const attempts = (state.pending?.attempts || 0) + 1;
  const pending = {
    date: day,
    kind: "pick",
    oid,
    keys,
    outcome,
    phase: "sending",
    at: iso(),
    attempts,
  };
  const r = await deliverOnce(
    stateFile,
    state,
    pending,
    ids,
    async (chatId) => {
      const name = await sendMsg(chatId, C.formatLeadName(l)); // message 1: the name
      if (!name.id && !name.unknown) return name; // nothing delivered: clean retry
      // The name may be out, so a clean retry would resend it. Try the card a
      // few times now; if it still fails, count the pick as delivered.
      for (let i = 0; i < 3; i++) {
        const m = await sendMsg(chatId, card, C.kbCard(oid)); // message 2: the card
        if (m.id || m.unknown) return m;
        await new Promise((res) => setTimeout(res, 2000 * (i + 1)));
      }
      return { id: name.id, unknown: true };
    },
  );
  if (r.status === "sent") {
    outcome.msgs = r.msgs;
    state.outcomes[oid] = outcome;
    for (const k of keys) sent.add(k);
    state.sentKeys = [...sent];
    state.pending = null;
    saveState(stateFile, state);
    await emailLead(l, {
      contactName: outcome.name,
      source: "digest",
      preface: ctx.followLine ? C.stripHtml(ctx.followLine) : null,
    }).catch(() => {});
  } else saveState(stateFile, state);
  return { status: r.status, oid };
}

async function sendNoDeal(ctx, nearMiss) {
  const { stateFile, state, day, ids } = ctx;
  const text = (ctx.followLine ? `${ctx.followLine}\n\n` : "") + C.formatNoDeal(nearMiss);
  const attempts = (state.pending?.attempts || 0) + 1;
  const pending = {
    date: day,
    kind: "nodeal",
    keys: [],
    phase: "sending",
    at: iso(),
    attempts,
  };
  const r = await deliverOnce(stateFile, state, pending, ids, (chatId) =>
    sendMsg(chatId, text),
  );
  if (r.status === "sent") {
    state.noDeals = state.noDeals || {};
    state.noDeals[day] = {
      nearMiss: nearMiss?.lead ? addrOf(nearMiss.lead) : null,
      gate: nearMiss?.gate || null,
      reason: nearMiss?.reason || null,
      msgs: r.msgs,
    };
    state.pending = null;
    saveState(stateFile, state);
    await emailNotice({
      subject: "No deal worth your time today",
      text: C.stripHtml(text),
    }).catch(() => {});
  } else saveState(stateFile, state);
  return { status: r.status };
}

// dueDate = today's Chicago date once it is past DIGEST_HOUR, else null.
// hour = current Chicago hour (for the degraded-pool cutoff). force = send now.
export async function runDailyDigest(leads, stateFile, opts = {}) {
  const { force = false, hour = null, sources = null, now = new Date() } = opts;
  const pick = opts.pick || (await loadPick());
  const state = loadState(stateFile);
  const backfilled = backfillAliases(state, pick);
  if (backfilled)
    console.log(`  backfilled ${backfilled} alias keys from past outcomes`);
  const sent = new Set(state.sentKeys);
  const day = opts.dueDate || (force ? chicagoDate(now) : null);
  const settled = settlePending(state, sent, day);
  if (settled) console.log(`  digest: ${settled}`);
  state.sentKeys = [...sent];

  const seen = new Set(state.seen);
  let newCount = 0;
  for (const l of leads) {
    const k = leadKey(l);
    if (!seen.has(k)) (seen.add(k), newCount++);
  }
  state.seen = [...seen];

  // Check against every alias of everything sent (legacy keys expanded).
  const isSent = makeIsSent(pick, sentSetFor(pick, state));
  const r = pick.pickDaily(leads, { isSent, now, sources });
  if (r.pick && isSent(r.pick)) {
    // Belt and braces: pick.js gates sent leads already; never resend one.
    console.error(`  digest: pick ${r.pick.address} reads as already sent; dropping it`);
    r.pick = (r.runnersUp || []).find((l) => !isSent(l)) || null;
  }
  const eligible =
    r.eligibleCount ?? leads.filter((l) => l.pickEval?.ok).length;
  const out = {
    newCount,
    qualified: eligible,
    sentNow: 0,
    digestSent: false,
    decision: "not-due",
    pick: r.pick,
    result: r,
  };

  // --digest-now never sends a second message on a day already done, unless
  // the operator also passes --resend (opts.resend).
  const doneToday = day && state.lastDigestDate === day && !state.pending;
  if (!day || (doneToday && !(force && opts.resend)))
    return (saveState(stateFile, state), out);
  if (!force && !leads.length) out.decision = "wait-empty-scan";
  else if (!force && !r.health?.ok && (hour == null || hour < cutoffHour())) {
    out.decision = "deferred";
    state.deferred = { date: day, why: r.health?.why || [], at: iso() };
  } else if (!enabled()) out.decision = "sending-disabled";
  if (out.decision !== "not-due") return (saveState(stateFile, state), out);

  const ids = await chatIds();
  if (!ids.length) {
    out.decision = "no-chats";
    return (saveState(stateFile, state), out);
  }
  if (Number(process.env.VINCE_DAILY_COUNT || 1) !== DAILY_CAP)
    console.log(
      `  VINCE_DAILY_COUNT=${process.env.VINCE_DAILY_COUNT} is ignored: the daily pick is hard-capped at ${DAILY_CAP}.`,
    );
  const fu = followUpLine(state, day);
  const ctx = { stateFile, state, sent, day, ids, pick, followLine: fu?.text || null };
  const res = r.pick
    ? await sendPick(ctx, r.pick)
    : await sendNoDeal(ctx, r.nearMiss);
  if (fu && res.status === "sent") {
    fu.o.followUpAt = iso();
    saveState(stateFile, state);
  }
  out.decision = r.pick ? `pick-${res.status}` : `nodeal-${res.status}`;
  out.digestSent = res.status === "sent";
  out.sentNow = r.pick && res.status === "sent" ? 1 : 0;
  if (res.status === "sent")
    await writePickSnapshot(
      day,
      buildSnapshot(day, r, {
        decision: out.decision,
        oid: res.oid || null,
        poolSize: leads.length,
        eligible,
      }),
    );
  return out;
}
