// Telegram transport for the Vince bot (@BradyVinceCook_bot). Every Bot API call
// goes through tg(), which tests can replace with setTransport(fn) so the whole
// digest flow runs against a fake Telegram. VINCE_PING_OFF=1 is a hard stop:
// with no injected transport, tg() returns null without touching the network.
//
// 409 rule: only pollCallbacks() may call getUpdates while a chat id is
// configured. Two concurrent getUpdates callers make Telegram return 409.
import { secret, rememberSecret } from "./secrets.js";

const API = (token, method) => `https://api.telegram.org/bot${token}/${method}`;
const TIMEOUT_MS = 20000;

let transport = null;
// Test hook: fn(method, payload) -> Telegram-shaped JSON ({ ok, result }).
export function setTransport(fn) {
  transport = fn || null;
}

export const esc = (s) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
export const money = (n) =>
  n == null ? "?" : "$" + Math.round(n).toLocaleString("en-US");

// Real sends only happen on Railway (the one live instance), unless a local run
// opts in with VINCE_ALLOW_LOCAL_SEND=1. The Mac holds a real token in the
// private json, and a stray local run would send Vince a second lead that day.
export const liveHost = () =>
  !!(process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_ENVIRONMENT_NAME || process.env.RAILWAY_PROJECT_ID) ||
  process.env.VINCE_ALLOW_LOCAL_SEND === "1";

export function enabled() {
  if (transport) return true;
  // Setting the token env to "" does NOT disable: secret() treats empty as
  // unset and falls back to the private file. VINCE_PING_OFF=1 does.
  if (process.env.VINCE_PING_OFF === "1") return false;
  if (!liveHost()) return false;
  return !!secret("VINCE_BOT_TOKEN");
}

// Errors where the request never left this machine, so nothing was delivered.
const PRE_CONNECT = /ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ENETUNREACH|EHOSTUNREACH/;

// Returns the parsed Bot API JSON, null on a definite failure, or
// { ok:false, unknown:true } when the request timed out (Telegram may or may not
// have delivered it, so the digest must not blindly resend).
export async function tg(method, payload) {
  if (transport) return transport(method, payload);
  if (process.env.VINCE_PING_OFF === "1") return null;
  if (!liveHost()) return null;
  const token = secret("VINCE_BOT_TOKEN");
  if (!token) return null;
  let r;
  try {
    r = await fetch(API(token, method), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload || {}),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    const code = `${e?.cause?.code || ""} ${e?.code || ""} ${e?.cause?.message || ""}`;
    if (PRE_CONNECT.test(code)) return null; // never sent: safe to retry
    return { ok: false, unknown: true }; // may have been delivered
  }
  try {
    return await r.json();
  } catch {
    return { ok: false, unknown: true }; // reached Telegram, reply unreadable
  }
}

// Chat ids = VINCE_CHAT_ID when configured (the normal case on Railway). Only
// when nothing is configured do we read getUpdates to auto-capture whoever
// tapped Start, and remember it.
export async function chatIds() {
  const configured = secret("VINCE_CHAT_ID")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (configured.length || transport) return configured;
  if (!enabled()) return [];
  const j = await tg("getUpdates", {});
  const ids = new Set();
  for (const u of j?.result || []) {
    const id = u?.message?.chat?.id ?? u?.my_chat_member?.chat?.id;
    if (id) ids.add(String(id));
  }
  const arr = [...ids];
  if (arr.length) rememberSecret("VINCE_CHAT_ID", arr.join(","));
  return arr;
}

// Send one message; returns { id, unknown }. id is the Telegram message_id, the
// only proof that a message was delivered.
export async function sendMsg(chatId, text, reply_markup) {
  const r = await tg("sendMessage", {
    chat_id: chatId,
    text: String(text).slice(0, 4000),
    parse_mode: "HTML",
    disable_web_page_preview: true,
    ...(reply_markup ? { reply_markup } : {}),
  });
  return { id: r?.result?.message_id ?? null, unknown: !!r?.unknown };
}

export async function sendTo(chatId, text, reply_markup) {
  return (await sendMsg(chatId, text, reply_markup)).id;
}

export async function editTo(chatId, msgId, text, reply_markup) {
  await tg("editMessageText", {
    chat_id: chatId,
    message_id: msgId,
    text: String(text).slice(0, 4000),
    parse_mode: "HTML",
    disable_web_page_preview: true,
    reply_markup: reply_markup || { inline_keyboard: [] },
  });
}

export const ackCb = (id, text = "") =>
  tg("answerCallbackQuery", {
    callback_query_id: id,
    text: String(text).slice(0, 180),
  });

export async function sendText(text) {
  const ids = await chatIds();
  const results = [];
  for (const id of ids) results.push(await sendTo(id, text));
  return { sentTo: results.filter(Boolean).length, results };
}
