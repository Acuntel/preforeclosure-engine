// Vince lead tracker — scan the whole IL pool all day, send the best 3 once a day.
//
//   node vince-track.js               # run all day; auto-sends the daily top 3 at 10am Chicago
//   node vince-track.js --once        # single scan (score + persist), no digest (for cron/debug)
//   node vince-track.js --digest-now  # scan once and send the top 3 right now (test the digest)
//   VINCE_DIGEST_HOUR=10 VINCE_DAILY_COUNT=3 VINCE_INTERVAL_MIN=20   # tunables
//
// Model: the Cook+collar-county pool is finite and new filings come in bursts, so
// we don't ping per record. Instead we rescan every VINCE_INTERVAL_MIN (keeping the
// whole pool fresh + enriched + quality-scored), and once per Chicago day — at/after
// VINCE_DIGEST_HOUR (10am) — send the best VINCE_DAILY_COUNT (3) leads Vince hasn't
// seen, ranked by deal quality, each with WHY it qualified. On top of the daily 3,
// an exceptional BRAND-NEW record (A-tier, freshly filed) pings the moment a scan
// spots it — Vince's "be the first one to know". Bot = @BradyVinceCook_bot.

process.env.PROFILE = "vince";

const path = await import("node:path");
const { writeFile, mkdir } = await import("node:fs/promises");
const { runAll } = await import("./src/collectors/index.js");
const { PROFILE } = await import("./src/profile.js");
const {
  runDailyDigest,
  runInstantAlerts,
  pollCallbacks,
  enabled: pingEnabled,
} = await import("./src/notify.js");

const ROOT = process.cwd();
const ONCE = process.argv.includes("--once");
const DIGEST_NOW = process.argv.includes("--digest-now");
const INTERVAL_MS = Number(process.env.VINCE_INTERVAL_MIN || 20) * 60_000;
const DIGEST_HOUR = Number(process.env.VINCE_DIGEST_HOUR || 10); // 10am
const LEADS_FILE = path.join(ROOT, "demo", PROFILE.leadsFile);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Cloud bootstrap: seed the state file from VINCE_STATE_B64 (base64 JSON) so a
// fresh host (e.g. Railway volume) carries over sentKeys/lastDigestDate and
// doesn't re-send leads Vince already received. Only writes if no state exists.
{
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
  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
  }).format(now); // YYYY-MM-DD
  return { hour, date };
}

async function pass(n) {
  const t0 = Date.now();
  console.log(
    `\n[${new Date().toISOString()}] pass #${n} — scanning metro Illinois…`,
  );
  const result = await runAll(
    (e) => {
      if (e.phase === "trigger" && e.state === "done" && e.source)
        console.log(
          `  ✓ ${e.source.label} — ${e.source.count} (${e.source.status})`,
        );
    },
    { max: Infinity },
  );

  await writeFile(LEADS_FILE, JSON.stringify(result, null, 2)).catch(() => {});
  await mkdir(path.join(ROOT, "data"), { recursive: true }).catch(() => {});
  await writeFile(
    path.join(
      ROOT,
      "data",
      `leads-vince-${new Date().toISOString().slice(0, 10)}.json`,
    ),
    JSON.stringify(result, null, 2),
  ).catch(() => {});

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

  const { hour, date } = chicago();

  // instant path first, so a hot brand-new lead pings NOW instead of waiting for
  // (or being burned by) the daily digest
  const ia = await runInstantAlerts(result.leads, PROFILE.stateFile, { date });
  if (ia.sent) console.log(`  🚨 instant-pinged ${ia.sent} hot new lead(s)`);

  // digest is due if it's past the send hour in Chicago and we haven't sent today
  const dueDate = DIGEST_NOW || hour >= DIGEST_HOUR ? date : null;
  const d = await runDailyDigest(result.leads, PROFILE.stateFile, {
    dueDate,
    force: DIGEST_NOW,
  });
  console.log(
    `  ${d.qualified} qualified · ${d.newCount} new this pass` +
      (d.digestSent
        ? ` · 📲 sent today's top ${d.sentNow}`
        : ` · next digest at ${DIGEST_HOUR}:00 Chicago`),
  );
  return { ...d, rawTotal: result.rawTotal };
}

if (!pingEnabled())
  console.log(
    "⚠️  No bot token — set VINCE_BOT_TOKEN (or ~/Documents/redline-private/vince-bot.local.json). Scans, but won't send.",
  );

let n = 0;
if (ONCE || DIGEST_NOW) {
  await pass(++n);
  process.exit(0);
} else {
  console.log(
    `Running all day. Scanning every ${(INTERVAL_MS / 60000).toFixed(0)}m; daily top ${process.env.VINCE_DAILY_COUNT || 3} sends at ${DIGEST_HOUR}:00 Chicago; exceptional brand-new leads ping instantly. Listening for 🟢/🔴 call replies.`,
  );
  // A long-lived process can lose the ability to fetch after the Mac changes
  // networks mid-pass (every source then reads "blocked" forever while a fresh
  // process works fine). Detect the wedge and exit — launchd KeepAlive restarts
  // us with a clean network stack.
  let emptyStreak = 0;
  for (;;) {
    try {
      const d = await pass(++n);
      emptyStreak = d.rawTotal === 0 ? emptyStreak + 1 : 0;
      if (emptyStreak >= 3) {
        console.error(
          `  ${emptyStreak} consecutive empty scans — network likely wedged; exiting so launchd restarts fresh.`,
        );
        process.exit(1);
      }
    } catch (e) {
      console.error("  pass error:", e.message);
    }
    // between scans, poll every 5s for Vince's button taps (answered / meeting)
    const until = Date.now() + INTERVAL_MS;
    while (Date.now() < until) {
      await pollCallbacks(PROFILE.stateFile).catch(() => {});
      await sleep(5000);
    }
  }
}
