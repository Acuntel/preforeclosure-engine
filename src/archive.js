// Durable daily records (P1-4): the scanned pool per Chicago day and the
// picks/<date>.json snapshot of every digest decision. Both go to the archive
// dir, which on Railway must be the volume (/data), not the container disk that
// a redeploy wipes.
//   VINCE_ARCHIVE_DIR          explicit dir
//   else dirname(VINCE_STATE_FILE) when that is set (the volume on Railway)
//   else <cwd>/data
//   VINCE_ARCHIVE_KEEP_DAYS    prune pool archives older than this (default 120)
import { writeFile, mkdir, readdir, unlink } from "node:fs/promises";
import path from "node:path";

export function archiveDir() {
  if (process.env.VINCE_ARCHIVE_DIR)
    return path.resolve(process.env.VINCE_ARCHIVE_DIR);
  if (process.env.VINCE_STATE_FILE)
    return path.dirname(path.resolve(process.env.VINCE_STATE_FILE));
  return path.join(process.cwd(), "data");
}

export async function writePoolArchive(date, result, dir = archiveDir()) {
  try {
    await mkdir(dir, { recursive: true });
    const f = path.join(dir, `leads-vince-${date}.json`);
    await writeFile(f, JSON.stringify(result));
    await prunePools(dir, date);
    return f;
  } catch (e) {
    console.error(`  archive write failed: ${e.message}`);
    return null;
  }
}

async function prunePools(dir, today) {
  const keep = Number(process.env.VINCE_ARCHIVE_KEEP_DAYS || 120);
  if (!(keep > 0)) return;
  const cutoff = new Date(Date.parse(today + "T00:00:00Z") - keep * 864e5)
    .toISOString()
    .slice(0, 10);
  for (const f of await readdir(dir).catch(() => [])) {
    const m = /^leads-vince-(\d{4}-\d{2}-\d{2})\.json$/.exec(f);
    if (m && m[1] < cutoff) await unlink(path.join(dir, f)).catch(() => {});
  }
}

// A lead plus its full EV evaluation. comps stay in: they are EV inputs.
const withEval = (l) => (l ? { ...l, pickEval: l.pickEval || null } : null);

export function buildSnapshot(date, r, extra = {}) {
  return {
    date,
    writtenAt: new Date().toISOString(),
    ...extra,
    pick: withEval(r.pick),
    runnersUp: (r.runnersUp || []).slice(0, 5).map(withEval),
    nearMiss: r.nearMiss
      ? {
          gate: r.nearMiss.gate,
          reason: r.nearMiss.reason,
          lead: withEval(r.nearMiss.lead),
        }
      : null,
    dropCounts: r.dropCounts || {},
    health: r.health || null,
  };
}

export async function writePickSnapshot(date, snap, { dryRun = false } = {}) {
  try {
    const dir = path.join(archiveDir(), "picks");
    await mkdir(dir, { recursive: true });
    const f = path.join(dir, `${date}${dryRun ? ".dryrun" : ""}.json`);
    await writeFile(f, JSON.stringify(snap, null, 2));
    return f;
  } catch (e) {
    console.error(`  pick snapshot write failed: ${e.message}`);
    return null;
  }
}
