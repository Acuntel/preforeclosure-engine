// Vince distressed-lead pings via the dedicated bot @BradyVinceCook_bot. Fires the
// moment a NEW record appears in a scrape (run-diffing against the previous run),
// carrying all the valuable info Vince acts on. Degrades to a silent no-op if the
// bot token isn't present, so a scrape is always safe. This bot is SEPARATE from
// the Nesso content / tentacle bot on purpose.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { secret, rememberSecret } from "./secrets.js";
import { shouldPing, recordAgeDays } from "./quality.js";
import { emailLead } from "./email.js";

const API = (token, method) => `https://api.telegram.org/bot${token}/${method}`;
const MAX_PINGS_PER_RUN = Number(process.env.VINCE_MAX_PINGS || 8);

const esc = (s) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
const money = (n) =>
  n == null ? "?" : "$" + Math.round(n).toLocaleString("en-US");

export function enabled() {
  // hard off-switch for tests/dry-runs — set VINCE_PING_OFF=1 to guarantee no
  // Telegram send regardless of the token in the private file. (Setting the token
  // env to "" does NOT disable: secret() treats empty as unset and falls back.)
  if (process.env.VINCE_PING_OFF === "1") return false;
  return !!secret("VINCE_BOT_TOKEN");
}

async function tg(method, payload) {
  const token = secret("VINCE_BOT_TOKEN");
  if (!token) return null;
  try {
    const r = await fetch(API(token, method), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return await r.json();
  } catch {
    return null;
  }
}

// Chat ids to ping = the UNION of (a) whatever's configured in VINCE_CHAT_ID and
// (b) everyone who has messaged the bot (getUpdates). So the moment Brady — or
// Vince, or anyone he shares the bot with — taps Start, they auto-subscribe and
// get every future ping; no manual id entry. The union is persisted back so it
// survives even after Telegram ages the updates out of getUpdates.
async function chatIds() {
  const configured = secret("VINCE_CHAT_ID")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  // If chats are already configured, use them and do NOT call getUpdates here —
  // pollCallbacks() owns the getUpdates long-poll and two concurrent getUpdates
  // callers make Telegram 409. New subscribers are auto-added by pollCallbacks.
  if (configured.length) return configured;
  const token = secret("VINCE_BOT_TOKEN");
  if (!token) return [];
  try {
    const r = await fetch(API(token, "getUpdates"), { method: "GET" });
    const j = await r.json();
    const ids = new Set();
    for (const u of j?.result || []) {
      const id = u?.message?.chat?.id ?? u?.my_chat_member?.chat?.id;
      if (id) ids.add(String(id));
    }
    const arr = [...ids];
    if (arr.length) rememberSecret("VINCE_CHAT_ID", arr.join(","));
    return arr;
  } catch {
    return [];
  }
}

export async function sendText(text) {
  const ids = await chatIds();
  const results = [];
  for (const id of ids)
    results.push(
      await tg("sendMessage", {
        chat_id: id,
        text: text.slice(0, 4000),
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
    );
  return { sentTo: ids.length, results };
}

// The ping body — everything Vince needs to decide + knock, value-gap first.
export function formatLead(l) {
  const addr =
    [l.address, l.city].filter(Boolean).join(", ") ||
    "(address pending enrichment)";
  const gapLine =
    l.valueGap != null
      ? `💰 <b>Value gap: ${money(l.valueGap)}${l.valueGapPct != null ? ` (${l.valueGapPct}%)` : ""}</b> · ${esc(l.valueConfidence || "?")} conf`
      : "💰 Value gap: pending value data";
  const tierBadge = l.tier ? `[${esc(l.tier)}·${l.quality}]` : "";
  const lines = [
    `🏠 <b>VINCE DISTRESSED LEAD</b> ${tierBadge} — ${esc(l.county)}`,
    `<b>${esc(addr)}</b>`,
    l.distress || l.signal ? `🎯 ${esc(l.distress || l.signal)}` : null,
    gapLine,
    l.estMarketComps || l.estMarket
      ? `   market ${money(l.estMarketComps || l.estMarket)}${l.compsCount ? ` (${l.compsCount} comps)` : ""} − debt ${money(l.estDebt)}  ·  ${esc(l.valueBasis || "")}`
      : null,
    l.owner ? `👤 ${esc(l.owner)}` : "👤 owner: (pending)",
    l.occupant ? `🏠 occupant: ${esc(l.occupant)}` : null,
    l.phone
      ? `📞 ${esc(l.phone)}${l.phones && l.phones.length > 1 ? ` (+${l.phones.length - 1} more)` : ""}`
      : "📞 phone: address+name ready → Forewarn",
    l.email ? `✉️ ${esc(l.email)}` : null,
    l.stage
      ? `📄 stage: ${esc(l.stage)}${l.filing ? ` · recorded ${esc(l.filing)}` : ""}`
      : null,
    l.judgment ? `⚖️ judgment ${esc(l.judgment)}` : null,
    l.openingBid ? `🔨 opening bid ${money(l.openingBid)}` : null,
    l.sale ? `📅 sale ${esc(l.sale)}` : null,
    l.caseNumber
      ? `# ${esc(l.caseNumber)}`
      : l.docNumber
        ? `doc ${esc(l.docNumber)}`
        : null,
    l.heirName
      ? `👪 heir: ${esc(l.heirName)}${l.heirMailing ? ` — ${esc(l.heirMailing)}` : ""}`
      : null,
    l.lender ? `🏦 ${esc(l.lender)}` : null,
    l.sourceUrl ? `🔗 ${esc(l.sourceUrl)}` : null,
    // WHY this lead qualified — the criteria it hit, so Vince trusts the ping
    l.qualityReasons && l.qualityReasons.length
      ? `✅ why: ${esc(l.qualityReasons.join(" · "))}`
      : null,
    l.qualityMisses && l.qualityMisses.length
      ? `⚠️ gaps: ${esc(l.qualityMisses.join(" · "))}`
      : null,
  ];
  return lines.filter(Boolean).join("\n");
}

// The person Vince actually calls / runs in his app — the heir on a probate lead,
// else the record owner.
function contactName(l) {
  return l.heirName || l.owner || l.occupant || "(owner name pending)";
}

// Card message 1: JUST the name (so Vince can drop it into his app to pull a phone).
export function formatLeadName(l) {
  return `👤 <b>${esc(contactName(l))}</b>`;
}

// Card message 2: everything ELSE (name lives in its own message above).
export function formatLeadDetails(l, rank) {
  const addr =
    [l.address, l.city].filter(Boolean).join(", ") || "(address pending)";
  const lines = [
    `#${rank} · <b>${esc(addr)}</b> — ${esc(l.county)}  [${esc(l.tier)}·${l.quality}]`,
    l.distress || l.signal ? `🎯 ${esc(l.distress || l.signal)}` : null,
    l.distanceMi != null ? `📍 ${l.distanceMi} mi from Elmhurst` : null,
    l.valueGap != null
      ? `💰 <b>Value gap ${money(l.valueGap)}${l.valueGapPct != null ? ` (${l.valueGapPct}%)` : ""}</b> · ${esc(l.valueConfidence || "?")} conf`
      : null,
    l.estMarketComps || l.estMarket
      ? `   market ${money(l.estMarketComps || l.estMarket)}${l.compsCount ? ` (${l.compsCount} comps)` : ""} − cost ${money(l.estDebt)}`
      : null,
    l.phone
      ? `📞 ${esc(l.phone)}${l.phoneType ? ` (${esc(l.phoneType)})` : ""}`
      : `📞 put the name above into your app for the number`,
    l.email ? `✉️ ${esc(l.email)}` : null,
    l.heirMailing ? `✉️ heir mailing: ${esc(l.heirMailing)}` : null,
    l.sale ? `📅 sale ${esc(l.sale)}` : null,
    l.openingBid ? `🔨 opening bid ${money(l.openingBid)}` : null,
    l.caseNumber
      ? `# ${esc(l.caseNumber)}`
      : l.docNumber
        ? `doc ${esc(l.docNumber)}`
        : null,
    l.sourceUrl ? `🔗 ${esc(l.sourceUrl)}` : null,
    l.qualityReasons && l.qualityReasons.length
      ? `✅ why: ${esc(l.qualityReasons.join(" · "))}`
      : null,
  ];
  return lines.filter(Boolean).join("\n");
}

const kbAnswered = (id) => ({
  inline_keyboard: [
    [
      { text: "🟢 Answered", callback_data: `ans:${id}` },
      { text: "🔴 No Answer", callback_data: `no:${id}` },
    ],
  ],
});
const kbMeeting = (id) => ({
  inline_keyboard: [
    [
      { text: "📅 Meeting booked", callback_data: `mtg:${id}` },
      { text: "❌ No meeting", callback_data: `nomtg:${id}` },
    ],
  ],
});

async function sendTo(chatId, text, reply_markup) {
  const r = await tg("sendMessage", {
    chat_id: chatId,
    text: text.slice(0, 4000),
    parse_mode: "HTML",
    disable_web_page_preview: true,
    ...(reply_markup ? { reply_markup } : {}),
  });
  return r?.result?.message_id ?? null;
}
async function editTo(chatId, msgId, text, reply_markup) {
  await tg("editMessageText", {
    chat_id: chatId,
    message_id: msgId,
    text: text.slice(0, 4000),
    parse_mode: "HTML",
    disable_web_page_preview: true,
    reply_markup: reply_markup || { inline_keyboard: [] },
  });
}
const ackCb = (id, text = "") =>
  tg("answerCallbackQuery", {
    callback_query_id: id,
    text: text.slice(0, 180),
  });

// County-scoped identity key so the same property doesn't re-ping across runs.
export function leadKey(l) {
  const id = l.caseNumber || l.docNumber || l.pin || `${l.address}|${l.city}`;
  return `${l.county}::${String(id).toUpperCase().trim()}`;
}

function loadState(file) {
  try {
    if (existsSync(file)) {
      const s = JSON.parse(readFileSync(file, "utf8"));
      s.outcomes = s.outcomes || {};
      s.offset = s.offset || 0;
      return s;
    }
  } catch {}
  return {
    seen: [],
    sentKeys: [],
    lastDigestDate: null,
    offset: 0,
    outcomes: {},
    updatedAt: null,
  };
}
function saveState(abs, s) {
  try {
    writeFileSync(
      abs,
      JSON.stringify({ ...s, updatedAt: new Date().toISOString() }, null, 2),
    );
  } catch {}
}
const absPath = (f) => (path.isAbsolute(f) ? f : path.join(process.cwd(), f));

const DIGEST_COUNT = Number(process.env.VINCE_DAILY_COUNT || 3);

// Daily curated digest: rank the ENTIRE current pool, and once per Chicago day
// send the best N leads Vince hasn't already been sent. This replaces per-record
// pinging — IL's lead pool is finite, so we evaluate everything and hand him the
// few best each morning rather than alerting on every new filing.
//   dueDate = today's Chicago date IF it's past the send hour, else null.
//   force   = send now regardless (for `--digest-now`).
export async function runDailyDigest(
  leads,
  stateFile,
  { dueDate = null, force = false } = {},
) {
  const abs = absPath(stateFile);
  const state = loadState(abs);
  const seen = new Set(state.seen || []);
  const sentKeys = new Set(state.sentKeys || []);

  let newCount = 0;
  for (const l of leads) {
    const k = leadKey(l);
    if (!seen.has(k)) (seen.add(k), newCount++);
  }

  // Vince's preference: among equally-GOOD leads (same tier), the one closest to
  // home base goes first — a far A-tier is never dropped, it just queues behind
  // the close As and surfaces once they've been sent. (Proximity also feeds the
  // score itself, so close leads tier-promote; see quality.js §7.)
  const tierRank = { A: 0, B: 1, C: 2, D: 3 };
  const qualified = leads
    .filter((l) => shouldPing(l))
    .sort(
      (a, b) =>
        (tierRank[a.tier] ?? 9) - (tierRank[b.tier] ?? 9) ||
        (a.distanceMi ?? Infinity) - (b.distanceMi ?? Infinity) ||
        (b.quality ?? 0) - (a.quality ?? 0) ||
        (b.valueGap ?? -Infinity) - (a.valueGap ?? -Infinity),
    );

  // An empty scan means the network/process is broken, not that there are no
  // leads — don't burn the day's digest (or message "no new leads") on it; a
  // later healthy pass the same day will send the real top picks.
  let dueToday = force || (dueDate && dueDate !== state.lastDigestDate);
  if (dueToday && !force && !leads.length) dueToday = false;
  let sentNow = 0;
  if (dueToday && enabled()) {
    const picks = qualified
      .filter((l) => !sentKeys.has(leadKey(l)))
      .slice(0, DIGEST_COUNT);
    const ids = await chatIds();
    if (picks.length && ids.length) {
      for (const id of ids)
        await sendTo(
          id,
          `☀️ <b>Vince — top ${picks.length} lead${picks.length > 1 ? "s" : ""} today</b>\nBest of ${qualified.length} qualified across metro Illinois. Tap 🟢/🔴 after you call each one.`,
        );
      const dateStr = dueDate || "today";
      for (let i = 0; i < picks.length; i++) {
        const l = picks[i];
        const oid = `${(dateStr || "").replace(/-/g, "").slice(4)}${i + 1}`; // e.g. 07161
        const msgs = [];
        for (const chatId of ids) {
          // message 1: the NAME on its own
          await sendTo(chatId, formatLeadName(l));
          // message 2: all other info + the answered/no-answer buttons
          const mid = await sendTo(
            chatId,
            formatLeadDetails(l, i + 1),
            kbAnswered(oid),
          );
          if (mid) msgs.push({ chatId, msgId: mid });
        }
        state.outcomes[oid] = {
          name: contactName(l),
          address: [l.address, l.city].filter(Boolean).join(", "),
          quality: l.quality,
          date: dateStr,
          msgs,
          answered: null,
          meeting: null,
        };
        await emailLead(l, {
          contactName: contactName(l),
          source: "digest",
        }).catch(() => {});
        sentKeys.add(leadKey(l));
        sentNow++;
      }
    } else if (!force && ids.length) {
      for (const id of ids)
        await sendTo(
          id,
          `☀️ <b>Vince</b> — no new qualifying leads today (${qualified.length} already active).`,
        );
    }
  }

  state.seen = [...seen];
  state.sentKeys = [...sentKeys];
  if (dueToday) state.lastDigestDate = dueDate || state.lastDigestDate;
  saveState(abs, state);
  return {
    newCount,
    qualified: qualified.length,
    sentNow,
    digestSent: dueToday,
  };
}

// ── Instant "be-first" alerts ────────────────────────────────────────────────
// Vince still gets his daily 3 at digest time — but if a truly exceptional lead
// shows up BRAND-NEW on a scan ("a fully new one comes on the market and you just
// want to be the first one to know"), it pings the moment we see it, on top of
// the 3. Gated hard so it stays rare: A-tier + quality ≥ VINCE_INSTANT_MIN (80)
// + the record itself filed within VINCE_INSTANT_FRESH_DAYS (7) + capped at
// VINCE_INSTANT_MAX (2) per day. Anything sent here is excluded from later
// digests. Never fires on the baseline pass (fresh state = everything "new").
const INSTANT_MIN = Number(process.env.VINCE_INSTANT_MIN || 80);
const INSTANT_FRESH_DAYS = Number(process.env.VINCE_INSTANT_FRESH_DAYS || 7);
const INSTANT_MAX = Number(process.env.VINCE_INSTANT_MAX || 2);

export async function runInstantAlerts(leads, stateFile, { date } = {}) {
  const abs = absPath(stateFile);
  const state = loadState(abs);
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
    .sort(
      (a, b) =>
        (b.quality ?? 0) - (a.quality ?? 0) ||
        (b.valueGap ?? -Infinity) - (a.valueGap ?? -Infinity),
    );

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
        `🚨 <b>HOT NEW LEAD — just hit the records</b> [${esc(l.tier)}·${l.quality}]\nToo good to wait for tomorrow's digest. Tap 🟢/🔴 after you call.`,
      );
      await sendTo(chatId, formatLeadName(l));
      const mid = await sendTo(
        chatId,
        formatLeadDetails(l, "🚨"),
        kbAnswered(oid),
      );
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
  saveState(abs, state);
  return { sent, hot: hot.length };
}

// One paragraph recapping the day's calls for Vince — sent once all of today's
// leads have a final outcome. Plain prose, not a list.
function daySummary(outcomes, date) {
  const today = Object.values(outcomes).filter((o) => o.date === date);
  if (!today.length) return null;
  const answered = today.filter((o) => o.answered === true);
  const booked = today.filter((o) => o.meeting === true);
  const noAns = today.filter((o) => o.answered === false);
  const parts = [
    `📋 <b>Today's recap.</b> We sent ${today.length} lead${today.length > 1 ? "s" : ""}: ${today.map((o) => o.name).join(", ")}.`,
  ];
  if (answered.length)
    parts.push(
      `${answered.map((o) => o.name).join(" and ")} answered — ${booked.length ? `booked ${booked.length} meeting${booked.length > 1 ? "s" : ""} (${booked.map((o) => o.name).join(", ")})` : "no meeting booked yet"}.`,
    );
  if (noAns.length)
    parts.push(
      `${noAns.map((o) => o.name).join(", ")} didn't answer — worth a follow-up touch.`,
    );
  parts.push(
    booked.length
      ? `Net: ${booked.length} appointment${booked.length > 1 ? "s" : ""} set from ${today.length} leads. Nice work — go close.`
      : `Net: no appointments yet; keep dialing the follow-ups.`,
  );
  return parts.join(" ");
}

// Poll the bot for button taps and drive the call-outcome flow:
//   🟢 Answered → asks "meeting booked?"   🔴 No Answer → logs it.
//   📅 Meeting booked / ❌ No meeting → records + (when all resolved) sends the recap.
// Safe to call every loop; no-op when the token is absent.
export async function pollCallbacks(stateFile) {
  const token = secret("VINCE_BOT_TOKEN");
  if (!token || process.env.VINCE_PING_OFF === "1") return { handled: 0 };
  const abs = absPath(stateFile);
  const state = loadState(abs);
  let j;
  try {
    const r = await fetch(API(token, "getUpdates"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        offset: state.offset || 0,
        timeout: 0,
        allowed_updates: ["callback_query"],
      }),
    });
    j = await r.json();
  } catch {
    return { handled: 0 };
  }
  if (!j?.ok) return { handled: 0 };

  let handled = 0;
  const recapped = new Set();
  for (const u of j.result || []) {
    state.offset = Math.max(state.offset || 0, u.update_id + 1);
    const cq = u.callback_query;
    if (!cq?.data) continue;
    const [action, oid] = cq.data.split(":");
    const o = state.outcomes[oid];
    if (!o) {
      await ackCb(cq.id, "expired");
      continue;
    }
    let note = "";
    let kb = null;
    let tag = "";
    if (action === "ans") {
      o.answered = true;
      note = "Answered ✓ — did you book a meeting?";
      kb = kbMeeting(oid);
      tag = "🟢 Answered — book a meeting?";
    } else if (action === "no") {
      o.answered = false;
      note = "No answer logged";
      tag = "🔴 No answer";
    } else if (action === "mtg") {
      o.meeting = true;
      note = "Meeting booked 🎉";
      tag = "📅 Meeting booked!";
    } else if (action === "nomtg") {
      o.meeting = false;
      note = "No meeting logged";
      tag = "❌ No meeting";
    }
    // reflect the outcome on every copy of this lead's detail card
    for (const m of o.msgs || [])
      await editTo(
        m.chatId,
        m.msgId,
        `${o.name} — <b>${o.address}</b>\n${tag}`,
        kb,
      );
    await ackCb(cq.id, note);
    handled++;

    // once every lead for that day is resolved (answered=false, or meeting decided), recap
    const day = o.date;
    if (!recapped.has(day)) {
      const dayLeads = Object.values(state.outcomes).filter(
        (x) => x.date === day,
      );
      const done = dayLeads.every(
        (x) => x.answered === false || x.meeting !== null,
      );
      if (done && dayLeads.length) {
        const text = daySummary(state.outcomes, day);
        if (text) for (const id of await chatIds()) await sendTo(id, text);
        recapped.add(day);
      }
    }
  }
  saveState(abs, state);
  return { handled };
}

// Diff this run against the last, then ping only leads that are BOTH new-to-ping
// AND good enough (quality gate) — so Vince gets a few genuinely good leads, not a
// firehose. A lead that wasn't good before but crosses the bar later (e.g. once a
// phone or value gap fills in) still pings the first time it qualifies. Returns
// { newCount, goodCount, pinged }.
export async function diffAndNotify(leads, stateFile) {
  const abs = path.isAbsolute(stateFile)
    ? stateFile
    : path.join(process.cwd(), stateFile);
  const state = loadState(abs);
  const seen = new Set(state.seen || []);
  const pingedKeys = new Set(state.pinged || []);
  const firstRun = !state.updatedAt;

  let newCount = 0;
  for (const l of leads) {
    const k = leadKey(l);
    if (!seen.has(k)) {
      seen.add(k);
      newCount++;
    }
  }

  // ping candidates = good-enough leads we haven't already pinged, best first
  const candidates = leads
    .filter((l) => shouldPing(l) && !pingedKeys.has(leadKey(l)))
    .sort(
      (a, b) =>
        (b.quality ?? 0) - (a.quality ?? 0) ||
        (b.valueGap ?? -Infinity) - (a.valueGap ?? -Infinity),
    );

  let pinged = 0;
  if (enabled()) {
    if (firstRun)
      await sendText(
        `✅ <b>Vince lead monitor is live.</b> Tracking ${leads.length} leads across your metro-IL counties. You'll get a ping the moment a NEW <b>good</b> lead hits (quality-gated — a few a day, not a firehose).`,
      );
    for (const l of candidates.slice(0, MAX_PINGS_PER_RUN)) {
      const r = await sendText(formatLead(l));
      if (r.sentTo) {
        pinged++;
        pingedKeys.add(leadKey(l));
      }
    }
    if (candidates.length > MAX_PINGS_PER_RUN)
      await sendText(
        `…and ${candidates.length - MAX_PINGS_PER_RUN} more good leads this run (capped at ${MAX_PINGS_PER_RUN}). Open the board to see all.`,
      );
  }

  try {
    writeFileSync(
      abs,
      JSON.stringify(
        {
          seen: [...seen],
          pinged: [...pingedKeys],
          updatedAt: new Date().toISOString(),
        },
        null,
        2,
      ),
    );
  } catch {}
  return { newCount, goodCount: candidates.length, pinged, firstRun };
}
