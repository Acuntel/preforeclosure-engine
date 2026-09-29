// Vince tracker state file: load, crash-safe save, and the legacy lead key.
// The state file holds sentKeys (every alias of every lead Vince was sent),
// outcomes (one per sent lead, keyed by outcome id), lastDigestDate, the
// pending digest marker (see digest.js) and the Telegram getUpdates offset.
import {
  readFileSync,
  writeFileSync,
  existsSync,
  renameSync,
  mkdirSync,
} from "node:fs";
import path from "node:path";

export const absPath = (f) =>
  path.isAbsolute(f) ? f : path.join(process.cwd(), f);

// Legacy county-scoped identity key (case#, else doc#, else PIN, else address).
// Kept because the 314 production sentKeys use this exact shape; alias keys from
// pick.js aliasKeys() are stored and checked alongside it.
export function leadKey(l) {
  const id = l.caseNumber || l.docNumber || l.pin || `${l.address}|${l.city}`;
  return `${l.county}::${String(id).toUpperCase().trim()}`;
}

export function emptyState() {
  return {
    seen: [],
    sentKeys: [],
    lastDigestDate: null,
    pending: null,
    offset: 0,
    outcomes: {},
    updatedAt: null,
  };
}

export function loadState(file) {
  const abs = absPath(file);
  try {
    if (existsSync(abs)) {
      const s = JSON.parse(readFileSync(abs, "utf8"));
      s.outcomes = s.outcomes || {};
      s.offset = s.offset || 0;
      s.sentKeys = s.sentKeys || [];
      s.seen = s.seen || [];
      if (s.pending === undefined) s.pending = null;
      return s;
    }
  } catch (e) {
    // The file exists but can't be read: saving an empty state over it would
    // wipe every outcome and sentKey and resend old leads. Stop this pass.
    throw new Error(`state read failed (${abs}): ${e.message}`);
  }
  return emptyState();
}

// Write to a temp file and rename over the real one, so a crash mid-write can
// never leave a truncated state file. Returns false on failure: callers that
// must persist BEFORE sending (the digest) refuse to send when this fails.
export function saveState(file, s) {
  const abs = absPath(file);
  const tmp = `${abs}.tmp-${process.pid}`;
  try {
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(
      tmp,
      JSON.stringify({ ...s, updatedAt: new Date().toISOString() }, null, 2),
    );
    renameSync(tmp, abs);
    return true;
  } catch (e) {
    console.error(`  state save failed (${abs}): ${e.message}`);
    return false;
  }
}
