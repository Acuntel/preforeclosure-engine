// Vince lead tracker: scan the whole metro Illinois pool all day and send Vince
// exactly ONE lead per day at 10:00 Chicago, the best one src/pick.js finds
// (or an honest "no deal worth your time today" line).
//
//   node vince-track.js                  # run all day (Railway start command)
//   node vince-track.js --once           # one scan pass; sends the daily pick only if it is due
//   node vince-track.js --digest-now     # one scan pass, then send the daily pick right now
//   node vince-track.js --dry-run [--from leads.json] [--as-of YYYY-MM-DD]
//                                        # scan (or load) the pool, print the pick, 5 runners-up,
//                                        # every EV term and the gate drops. Never writes state,
//                                        # never sends.
// Tunables: VINCE_DIGEST_HOUR=10 VINCE_INTERVAL_MIN=60 VINCE_PRE_DIGEST_MIN=20
//           VINCE_DIGEST_CUTOFF_HOUR=14 VINCE_INSTANT=1 (legacy instant alerts, default off)
//
// Cadence: a scan every VINCE_INTERVAL_MIN (60), plus a forced scan that starts
// VINCE_PRE_DIGEST_MIN (20) before the digest hour. At the digest hour the pick
// is made from that fresh pool (under 30 minutes old) without waiting for the
// next scan. A degraded pool defers the pick to later passes until the cutoff.
// The daily pick is hard-capped at 1 in code; VINCE_DAILY_COUNT is ignored.
// Bot = @BradyVinceCook_bot.

process.env.PROFILE = "vince";

const argv = process.argv.slice(2);
const arg = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : null;
};
const ONCE = argv.includes("--once");
const DIGEST_NOW = argv.includes("--digest-now");
const RESEND = argv.includes("--resend"); // with --digest-now: allow a second send today
const DRY_RUN = argv.includes("--dry-run");
if (DRY_RUN) {
  // belt and braces: a dry run can never send, whatever else is configured
  process.env.VINCE_PING_OFF = "1";
  process.env.VINCE_EMAIL_OFF = "1";
}

const path = await import("node:path");
const { writeFile, readFile } = await import("node:fs/promises");
const { PROFILE } = await import("./src/profile.js");
const {
  runDailyDigest,
  runInstantAlerts,
  pollCallbacks,
  enabled: pingEnabled,
} = await import("./src/notify.js");
const { writePoolArchive, writePickSnapshot, buildSnapshot, archiveDir } =
  await import("./src/archive.js");
const { applyDupageCancellations, syncDupageCancellations } =
  await import("./src/dupage-cancel.js");

const ROOT = process.cwd();
const INSTANT = process.env.VINCE_INSTANT === "1";
const INTERVAL_MS = Number(process.env.VINCE_INTERVAL_MIN || 60) * 60_000;
const DIGEST_HOUR = Number(process.env.VINCE_DIGEST_HOUR || 10); // 10am
const PRE_DIGEST_MIN = Number(process.env.VINCE_PRE_DIGEST_MIN || 20);
const CUTOFF_HOUR = Number(process.env.VINCE_DIGEST_CUTOFF_HOUR || 14);
const FRESH_POOL_MS = 30 * 60_000;
const LEADS_FILE = path.join(ROOT, "demo", PROFILE.leadsFile);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Cloud bootstrap: seed the state file from VINCE_STATE_B64 (base64 JSON) so a
// fresh host (e.g. Railway volume) carries over sentKeys/lastDigestDate and
// doesn't re-send leads Vince already received. Only writes if no state exists.
if (!DRY_RUN) {
  const { existsSync, writeFileSync } = await import("node:fs");
  const seed = process.env.VINCE_STATE_B64;
  const stateAbs = path.isAbsolute(PROFILE.stateFile)
    ? PROFILE.stateFile
    : path.join(ROOT, PROFILE.stateFile);
  if (seed && !existsSync(stateAbs)) {
    try {
      writeFileSync(stateAbs, Buffer.from(seed, "base64"));
      console.log(`Seeded state from VINCE_STATE_B64 → ${stateAbs}`);
    } catch (e) {
      console.error("State seed failed (continuing fresh):", e.message);
    }
  }
}

// Chicago wall-clock without a tz lib. hourCycle "h23" (NOT hour12:false) is
// load-bearing: this Node's ICU formats the midnight hour as "24" under
// hour12:false, which made `hour >= DIGEST_HOUR` true at 12:10am and fired the
// 07-26 digest at midnight. The % 24 is a safety net for the same class of bug.
function chicago() {
  const now = new Date();
  const hour =
    Number(
      new Intl.DateTimeFormat("en-US", {
        timeZone: "America/Chicago",
        hour: "numeric",
        hourCycle: "h23",
      }).format(now),
    ) % 24;
  const minute = Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Chicago",
      minute: "numeric",
    }).format(now),
  );
  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
  }).format(now); // YYYY-MM-DD
  return { hour, minute, date, second: now.getUTCSeconds() };
}

async function scan() {
  const { runAll } = await import("./src/collectors/index.js");
  return runAll(
    (e) => {
      if (e.phase === "trigger" && e.state === "done" && e.source)
        console.log(
          `  ✓ ${e.source.label}: ${e.source.count} (${e.source.status})`,
        );
    },
    { max: Infinity },
  );
}

// ── --dry-run: print what the digest would send. No state write, no send. ──
async function dryRun() {
  const { loadState } = await import("./src/vstate.js");
  const { loadPick, makeIsSent, backfillAliases, sentSetFor } =
    await import("./src/sentkeys.js");
  const { dryRunReport } = await import("./src/pickreport.js");
  const from = arg("--from");
  let result = from ? JSON.parse(await readFile(from, "utf8")) : await scan();
  if (Array.isArray(result)) result = { leads: result };
  const asOf = arg("--as-of");
  const now = asOf ? new Date(`${asOf}T15:00:00Z`) : new Date(); // ~10am Chicago
  const pick = await loadPick();
  const state = loadState(PROFILE.stateFile); // read only, never saved
  backfillAliases(state, pick);
  applyDupageCancellations(state, result, asOf || chicago().date); // in memory only
  // same sent set the real digest checks (legacy keys expanded + outcome aliases)
  const sent = sentSetFor(pick, state);
  if (state.pending?.phase === "sending")
    for (const k of state.pending.keys || []) sent.add(k);
  const r = pick.pickDaily(result.leads, {
    isSent: makeIsSent(pick, sent),
    now,
    sources: result.sources,
  });
  const eligible = result.leads.filter((l) => l.pickEval?.ok).length;
  const { hour, date } = chicago();
  console.log(
    `DRY RUN (${from ? `from ${from}` : "live scan"}, as of ${asOf || date}, state ${PROFILE.stateFile}, read only)`,
  );
  console.log(
    dryRunReport(r, {
      poolSize: result.leads.length,
      eligible,
      cutoffHour: CUTOFF_HOUR,
      hour: asOf ? DIGEST_HOUR : hour,
    }),
  );
  if (process.env.VINCE_ARCHIVE_DIR) {
    const snap = buildSnapshot(asOf || date, r, {
      decision: "dry-run",
      poolSize: result.leads.length,
      eligible,
    });
    const f = await writePickSnapshot(asOf || date, snap, { dryRun: true });
    if (f) console.log(`\nsnapshot: ${f}`);
  }
}

let lastPool = null; // { result, at, digestTried }

async function digestTick(result, force = false) {
  const { hour, date } = chicago();
  const dueDate = force || hour >= DIGEST_HOUR ? date : null;
  const d = await runDailyDigest(result.leads, PROFILE.stateFile, {
    dueDate,
    force,
    resend: RESEND,
    hour,
    sources: result.sources,
  });
  const p = d.pick ? `${d.pick.address}, ${d.pick.city}` : "none";
  console.log(
    `  ${d.qualified} pass every gate · ${d.newCount} new this pass · ` +
      (d.decision === "not-due"
        ? `next pick at ${DIGEST_HOUR}:00 Chicago`
        : `daily pick: ${d.sentNow} (${d.decision}; pick ${p})`),
  );
  if (d.decision === "deferred")
    console.log(
      `  pool degraded (${(d.result.health?.why || []).join("; ")}); retrying until ${CUTOFF_HOUR}:00`,
    );
  return d;
}

async function pass(n) {
  const t0 = Date.now();
  console.log(
    `\n[${new Date().toISOString()}] pass #${n}: scanning metro Illinois…`,
  );
  const result = await scan();
  const { hour, date } = chicago();
  const dc = syncDupageCancellations(PROFILE.stateFile, result, date);
  if (dc.vanished.length)
    console.log(`  DuPage sheriff dropped ${dc.vanished.join(", ")} before its sale; marked cancelled`);
  await writeFile(LEADS_FILE, JSON.stringify(result, null, 2)).catch(() => {});
  await writePoolArchive(date, result);

  const byC = {};
  const tiers = { A: 0, B: 0, C: 0, D: 0 };
  for (const l of result.leads) {
    byC[l.county] = (byC[l.county] || 0) + 1;
    tiers[l.tier] = (tiers[l.tier] || 0) + 1;
  }
  console.log(
    `  ${result.leads.length} leads (${result.rawTotal} scanned) ${JSON.stringify(byC)} in ${((Date.now() - t0) / 1000).toFixed(0)}s`,
  );
  console.log(
    `  quality: A ${tiers.A} · B ${tiers.B} · C ${tiers.C} · D ${tiers.D}`,
  );

  if (INSTANT) {
    const ia = await runInstantAlerts(result.leads, PROFILE.stateFile, {
      date,
    });
    if (ia.sent) console.log(`  🚨 instant-pinged ${ia.sent} hot new lead(s)`);
  }
  const d = await digestTick(result, DIGEST_NOW);
  lastPool = {
    result,
    at: Date.now(),
    digestTried: DIGEST_NOW || hour >= DIGEST_HOUR,
  };
  return { ...d, rawTotal: result.rawTotal };
}

// When to start the next scan: after the interval, or earlier so a scan starts
// PRE_DIGEST_MIN before the digest hour.
function nextScanAt() {
  const { hour, minute, second } = chicago();
  const untilPre =
    (DIGEST_HOUR * 60 - PRE_DIGEST_MIN - (hour * 60 + minute)) * 60_000 -
    second * 1000;
  return (
    Date.now() +
    (untilPre > 0 && untilPre < INTERVAL_MS ? untilPre : INTERVAL_MS)
  );
}

if (DRY_RUN) {
  await dryRun();
  process.exit(0);
}

if (!pingEnabled())
  console.log(
    "⚠️  No bot token (or VINCE_PING_OFF=1): set VINCE_BOT_TOKEN (or ~/Documents/redline-private/vince-bot.local.json). Scans, but won't send.",
  );
console.log(`archives + pick snapshots → ${archiveDir()}`);

let n = 0;
if (ONCE || DIGEST_NOW) {
  await pass(++n);
  process.exit(0);
} else {
  console.log(
    `Running all day. Scanning every ${(INTERVAL_MS / 60000).toFixed(0)}m plus a fresh scan at ${DIGEST_HOUR - 1}:${String(60 - PRE_DIGEST_MIN).padStart(2, "0")}; ONE lead a day at ${DIGEST_HOUR}:00 Chicago. Instant alerts ${INSTANT ? "ON" : "off"}. Listening for button taps.`,
  );
  // A long-lived process can lose the ability to fetch after the host changes
  // networks mid-pass (every source then reads "blocked" forever while a fresh
  // process works fine). Detect the wedge and exit so the supervisor restarts us.
  let emptyStreak = 0;
  for (;;) {
    try {
      const d = await pass(++n);
      emptyStreak = d.rawTotal === 0 ? emptyStreak + 1 : 0;
      if (emptyStreak >= 3) {
        console.error(
          `  ${emptyStreak} consecutive empty scans; network likely wedged, exiting so the supervisor restarts fresh.`,
        );
        process.exit(1);
      }
    } catch (e) {
      console.error("  pass error:", e.message);
    }
    // Between scans: poll every 5s for button taps, and send the daily pick the
    // moment the digest hour arrives if the last scan is still fresh.
    const until = nextScanAt();
    while (Date.now() < until) {
      await pollCallbacks(PROFILE.stateFile).catch(() => {});
      const fresh = lastPool && Date.now() - lastPool.at < FRESH_POOL_MS;
      if (fresh && !lastPool.digestTried && chicago().hour >= DIGEST_HOUR) {
        lastPool.digestTried = true;
        await digestTick(lastPool.result).catch((e) =>
          console.error("  digest error:", e.message),
        );
      }
      await sleep(5000);
    }
  }
}
