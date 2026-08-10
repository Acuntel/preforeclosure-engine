// Loads Vince-instance secrets from OUTSIDE the repo (never committed): the
// dedicated bot token + chat id + optional skip-trace key. Falls back to
// process.env so the same names work on a server. The private file is JSON at
// ~/Documents/redline-private/vince-bot.local.json (see MASTER_PROMPT / memory).
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const PRIVATE_FILE = path.join(
  homedir(),
  "Documents",
  "redline-private",
  "vince-bot.local.json",
);

let _cache = null;
function raw() {
  if (_cache) return _cache;
  let fromFile = {};
  try {
    if (existsSync(PRIVATE_FILE))
      fromFile = JSON.parse(readFileSync(PRIVATE_FILE, "utf8"));
  } catch {}
  _cache = fromFile;
  return _cache;
}

export function secret(name) {
  return process.env[name] || raw()[name] || "";
}

// Persist a value back into the private JSON (used to remember an auto-captured
// chat id). No-ops if the private folder isn't present.
export function rememberSecret(name, value) {
  try {
    if (!existsSync(path.dirname(PRIVATE_FILE))) return false;
    const obj = raw();
    obj[name] = value;
    writeFileSync(PRIVATE_FILE, JSON.stringify(obj, null, 2));
    _cache = obj;
    return true;
  } catch {
    return false;
  }
}

export const PRIVATE_PATH = PRIVATE_FILE;
