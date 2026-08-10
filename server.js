// Zero-dependency local server + 24h scheduler for the Live Scrape CRM.
//   npm start   ->   http://localhost:8787
//
// On boot it loads the last saved leads, then AUTO-SCRAPES every 24h (configurable
// via AUTO_REFRESH_HOURS) — so the data populates on its own. It also runs a scrape
// immediately if the saved data is missing or older than the refresh window.
// The scrape is a SERVER-SIDE JOB: it keeps running if you switch tabs / close the
// page; the CRM polls /api/scrape/status for the progress bar and loads /api/leads
// on open. All sources are free public platforms. Lifts to AWS Lambda + EventBridge.
import { createServer } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { runAll } from "./src/collectors/index.js";
import { PROFILE } from "./src/profile.js";
import { diffAndNotify } from "./src/notify.js";

const PORT = process.env.PORT || PROFILE.port;
const ROOT = process.cwd();
const MAX = process.env.MAX_LEADS ? Number(process.env.MAX_LEADS) : Infinity; // default: ALL data
const AUTO_MIN = Number(process.env.AUTO_REFRESH_MINUTES || 60);
const AUTO_MS = AUTO_MIN * 60_000;
const LEADS_FILE = path.join(ROOT, "demo", PROFILE.leadsFile);
const TYPES = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "text/javascript",
  ".json": "application/json",
  ".csv": "text/csv",
};

let job = null; // in-flight/last job state (progress)
let lastResult = null; // last completed { leads, sources, ... }
let lastRunAt = null; // ms epoch of last successful scrape
let nextRunAt = null; // ms epoch of next scheduled scrape
let autoTimer = null;

function freshJob() {
  return {
    id: Date.now(),
    state: "running",
    startedAt: Date.now(),
    endedAt: null,
    triggersDone: 0,
    triggersTotal: 5,
    enrichDone: 0,
    enrichTotal: 0,
    phaseText: "Starting…",
    sources: [],
    result: null,
    error: null,
  };
}

function startJob(reason = "manual") {
  if (job && job.state === "running") return job; // never double-run
  job = freshJob();
  console.log(`\n▶ scrape #${job.id} (${reason})`);
  runAll(
    (e) => {
      if (!job) return;
      if (e.phase === "trigger") {
        if (e.state === "done") {
          job.triggersDone = e.i;
          if (e.source) {
            const k = job.sources.findIndex((s) => s.id === e.source.id);
            if (k >= 0) job.sources[k] = e.source;
            else job.sources.push(e.source);
          }
        }
        job.triggersTotal = e.total;
        job.phaseText =
          e.state === "running"
            ? `Scanning ${e.label}…`
            : `Scanned ${e.label} (${e.i}/${e.total} feeds)`;
      } else if (e.phase === "enrich-start") {
        job.enrichTotal = e.total || 0;
        job.phaseText = `Pulling county records for ${job.enrichTotal} properties…`;
      } else if (e.phase === "enrich") {
        job.enrichDone = e.done;
        job.enrichTotal = e.total;
        job.phaseText = `Enriching county records (${e.done}/${e.total})`;
      }
    },
    { max: MAX },
  )
    .then(async (result) => {
      job.result = result;
      job.state = "done";
      job.endedAt = Date.now();
      job.sources = result.sources;
      job.phaseText = "Done";
      lastResult = result;
      lastRunAt = Date.now();
      await writeFile(LEADS_FILE, JSON.stringify(result, null, 2)).catch(
        () => {},
      );
      console.log(
        `▶ #${job.id} done: ${result.leads.length} leads (${result.rawTotal} scanned) in ${((job.endedAt - job.startedAt) / 1000).toFixed(0)}s`,
      );
      // Vince profile: ping the moment NEW records appear (run-diff vs last run).
      if (PROFILE.ping) {
        try {
          const d = await diffAndNotify(result.leads, PROFILE.stateFile);
          if (d.newCount)
            console.log(
              `  📲 ${d.newCount} new lead(s) — pinged ${d.pinged} via @BradyVinceCook_bot${d.firstRun ? " (baseline)" : ""}`,
            );
        } catch (e) {
          console.error("  ping error", e.message);
        }
      }
      scheduleAuto(); // re-arm 24h timer relative to this completion
    })
    .catch((e) => {
      job.state = "error";
      job.error = String(e.message || e);
      job.endedAt = Date.now();
      console.error("scrape error", e);
      scheduleAuto();
    });
  return job;
}

function scheduleAuto() {
  if (autoTimer) clearTimeout(autoTimer);
  nextRunAt = (lastRunAt || Date.now()) + AUTO_MS;
  const delay = Math.max(0, nextRunAt - Date.now());
  autoTimer = setTimeout(() => startJob("auto-24h"), delay);
  console.log(
    `  next auto-scrape: ${new Date(nextRunAt).toLocaleString()} (in ${(delay / 60_000).toFixed(0)}m)`,
  );
}

function progress(j) {
  const fT = j.triggersTotal ? j.triggersDone / j.triggersTotal : 0;
  const fE = j.enrichTotal ? j.enrichDone / j.enrichTotal : 0;
  let frac = j.state === "done" ? 1 : Math.min(0.99, 0.55 * fT + 0.45 * fE);
  const elapsed = (j.endedAt || Date.now()) - j.startedAt;
  const eta =
    j.state === "done"
      ? 0
      : frac > 0.03
        ? Math.max(0, Math.round((elapsed * (1 - frac)) / frac))
        : null;
  return { frac, elapsed, eta };
}

function statusBody() {
  const base = { autoMinutes: AUTO_MIN, lastRunAt, nextRunAt };
  if (!job) return { state: "idle", ...base };
  const p = progress(job);
  return {
    ...base,
    id: job.id,
    state: job.state,
    phaseText: job.phaseText,
    fraction: p.frac,
    elapsedMs: p.elapsed,
    etaMs: p.eta,
    triggersDone: job.triggersDone,
    triggersTotal: job.triggersTotal,
    enrichDone: job.enrichDone,
    enrichTotal: job.enrichTotal,
    sources: job.sources,
    error: job.error,
    leads: job.state === "done" ? job.result.leads : undefined,
    rawTotal: job.result?.rawTotal,
    kept: job.result?.kept,
    scrapedAt: job.result?.scrapedAt,
  };
}

// latest persisted/in-memory leads (for auto-populate on page open)
function leadsBody() {
  if (!lastResult) return { state: "none", autoMinutes: AUTO_MIN, nextRunAt };
  return {
    state: "ready",
    leads: lastResult.leads,
    sources: lastResult.sources,
    rawTotal: lastResult.rawTotal,
    kept: lastResult.kept,
    scrapedAt: lastResult.scrapedAt,
    lastRunAt,
    nextRunAt,
    autoMinutes: AUTO_MIN,
    scraping: !!(job && job.state === "running"),
  };
}

async function serveFile(res, file) {
  if (!existsSync(file)) {
    res.writeHead(404);
    return res.end("Not found");
  }
  res.writeHead(200, {
    "Content-Type": TYPES[path.extname(file)] || "application/octet-stream",
  });
  res.end(await readFile(file));
}
const json = (res, obj, code = 200) => {
  res.writeHead(code, { "Content-Type": "application/json" });
  res.end(JSON.stringify(obj));
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (url.pathname === "/api/scrape/start") {
    startJob("manual");
    return json(res, statusBody());
  }
  if (url.pathname === "/api/scrape/status") return json(res, statusBody());
  if (url.pathname === "/api/leads") return json(res, leadsBody());
  if (url.pathname === "/api/scrape") {
    try {
      return json(res, await runAll(() => {}, { max: MAX }));
    } catch (e) {
      return json(res, { error: String(e.message || e) }, 500);
    }
  }
  if (url.pathname === "/" || url.pathname === "/index.html")
    return serveFile(res, path.join(ROOT, "demo", "index.html"));
  return serveFile(
    res,
    path.join(ROOT, path.normalize(url.pathname).replace(/^(\.\.[/\\])+/, "")),
  );
});

// boot: load last leads, then schedule (and run now if data is missing/stale)
async function boot() {
  if (existsSync(LEADS_FILE)) {
    try {
      lastResult = JSON.parse(await readFile(LEADS_FILE, "utf8"));
      lastRunAt = lastResult.scrapedAt
        ? new Date(lastResult.scrapedAt).getTime()
        : Date.now();
      console.log(
        `  loaded ${lastResult.leads?.length ?? 0} saved leads from ${lastResult.scrapedAt || "?"}`,
      );
    } catch {}
  }
  const stale = !lastRunAt || Date.now() - lastRunAt > AUTO_MS;
  if (stale) startJob(lastRunAt ? "stale-on-boot" : "first-run");
  else scheduleAuto();
}

server.listen(PORT, () => {
  console.log(`\n  REDLINE engine → http://localhost:${PORT}`);
  console.log(
    `  Auto-scrapes every ${AUTO_MIN}m. Manual refresh: ⚡ Live Scrape. Cap: ${MAX === Infinity ? "ALL data" : MAX}.`,
  );
  boot();
});
