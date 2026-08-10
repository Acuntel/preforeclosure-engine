// Registry + orchestrator. Loads every collector that exists (fault tolerant),
// runs all trigger feeds, keeps leads in the investor's TARGET counties,
// prioritizes his home turf, caps for a snappy run, enriches each by county
// (concurrently), then scores + dedupes. A missing/broken module is reported in
// `sources`, never crashes the run.
import { finalize } from "../score.js";
import { corroborate } from "../match.js";
import { PROFILE, inScope, priority } from "../profile.js";
import { attachValue } from "../value.js";
import { skipTrace, enabled as skiptraceEnabled } from "./skiptrace.js";
import { endatoTrace, enabled as endatoEnabled } from "./skiptrace-endato.js";
import { enrichPhones } from "./people-search.js";
import { scoreQuality } from "../quality.js";

const TRIGGER_IDS = [
  "tjsc",
  "intercounty",
  "public-notice-il",
  "judici-boone",
  "boone-sheriff",
  "roup-winnebago",
  "will-treasurer",
  "recorder-will",
  "will-sheriff",
  "kane-sheriff",
  "mchenry-sheriff",
  "lake-sheriff",
  "recorder-lake",
  "recorder-cook",
  "probate-dailyherald",
  "chicago-violations",
  "craigslist-fsbo",
];
const ENRICH_IDS = [
  "enrich-dupage",
  "enrich-cook",
  "enrich-winnebago",
  "enrich-boone",
  "enrich-lake",
  "enrich-will",
  "enrich-mchenry",
  "enrich-kane",
];

// County scope + priority come from the active PROFILE (src/profile.js):
//   z     -> Winnebago + Boone + collar (the original REDLINE)
//   vince -> DuPage + whitelisted west-Cook suburbs (value-gap ranked)
// inScope() handles Vince's Cook municipality whitelist; priority() sorts home
// turf first. Leads outside scope are dropped.

// Per-source timeout caps (ms). Known login-gated sources fast-fail so they
// can't drag the run; everything else gets the generous default.
// lake-sheriff fetches a detail page per sale for the case# — give it room on a cold run.
const TIMEOUTS = {
  "judici-boone": 8000,
  "lake-sheriff": 120000,
  "recorder-lake": 120000, // WebSocket, paginated
  "recorder-will": 150000, // chunked by month over 180d
  "recorder-cook": 120000, // token + POST + paginated result fetches
  "recorder-dupage": 360000, // headless browser, one query per day over lookback
  "probate-dailyherald": 90000, // fetches each notice detail page
};

// In-process result caches so a 10-minute refresh stays POLITE: heavy/slow feeds
// re-scrape only every few hours, light sale lists refresh ~every cycle, and a
// property is re-enriched at most every ENR_TTL. Caches live in the server
// process (cold on restart). A manual ⚡ refresh still reuses warm caches.
const _trig = new Map(); // id -> {ts, result}
const _enr = new Map(); // key -> {ts, fields, verified}
const TRIG_TTL = {
  "public-notice-il": 3 * 3600e3, // 40-page ASP.NET crawl — don't hammer
  "lake-sheriff": 3 * 3600e3, // 112 detail fetches
  "will-treasurer": 3 * 3600e3, // AWS Lambda relay sweep
  "recorder-lake": 3 * 3600e3, // Kofile WebSocket pagination (519 lis pendens)
  "recorder-will": 3 * 3600e3, // Fidlar Breeze, month-chunked (735 lis pendens)
  "recorder-cook": 3 * 3600e3, // CRS ASP.NET search — index lags ~1-2wk, no need to hammer
  "recorder-dupage": 2 * 3600e3, // headless browser, rate-limited site — poll gently
  "probate-dailyherald": 60 * 60e3, // notices update a few times/day
  "chicago-violations": 60 * 60e3, // Socrata refreshes daily
  "craigslist-fsbo": 2 * 3600e3, // headed browser — poll gently
};
const TRIG_TTL_DEFAULT = 9 * 60e3; // light single-GET lists: refresh ~every cycle
const ENR_TTL = 6 * 3600e3; // assessor/parcel data barely changes
const enrKey = (l) =>
  (
    (l.caseNumber || l.pin || l.address || "") +
    "|" +
    (l.county || "")
  ).toUpperCase();

async function load(id) {
  try {
    const m = await import(`./${id}.js`);
    return { id, mod: m, meta: m.meta || { id, label: id } };
  } catch (e) {
    return { id, error: String(e.message || e) };
  }
}

async function pool(items, n, fn) {
  const out = [];
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++;
        out[idx] = await fn(items[idx], idx);
      }
    }),
  );
  return out;
}

export async function runAll(onProgress = () => {}, { max = Infinity } = {}) {
  const sources = [];
  // active trigger set: profile override (e.g. Vince) or the default registry
  const triggerIds = PROFILE.triggers || TRIGGER_IDS;
  const triggers = await Promise.all(triggerIds.map(load));
  const enrichers = await Promise.all(ENRICH_IDS.map(load));

  const enrichByCounty = {};
  for (const e of enrichers) {
    if (e.error) {
      sources.push({
        id: e.id,
        label: e.id,
        kind: "enrich",
        status: "missing",
        count: 0,
        note: e.error,
      });
      continue;
    }
    for (const c of e.meta.counties || []) enrichByCounty[c] = e.mod.enrich;
  }

  // 1. run every trigger feed IN PARALLEL (independent domains), each with a
  // timeout cap so one slow/gated source (e.g. Judici) can't stall the whole run.
  let raw = [];
  const nT = triggers.length;
  let iT = 0;
  onProgress({
    phase: "trigger",
    i: 0,
    total: nT,
    label: "all feeds",
    state: "running",
  });
  const settled = await Promise.all(
    triggers.map(async (t) => {
      if (t.error) {
        const src = {
          id: t.id,
          label: t.id,
          kind: "trigger",
          status: "missing",
          count: 0,
          note: t.error,
        };
        onProgress({
          phase: "trigger",
          i: ++iT,
          total: nT,
          label: t.id,
          state: "done",
          source: src,
        });
        return { src, leads: [] };
      }
      try {
        const id = t.meta.id;
        const ttl = TRIG_TTL[id] ?? TRIG_TTL_DEFAULT;
        const hit = _trig.get(id);
        let r,
          cached = false;
        if (hit && Date.now() - hit.ts < ttl) {
          r = hit.result;
          cached = true;
        } else {
          r = await withTimeout(t.mod.collect(), TIMEOUTS[id] ?? 45000);
          _trig.set(id, { ts: Date.now(), result: r });
        }
        const leads = (r.leads || []).map((l) => ({ ...l, _src: t.meta.id }));
        const inTarget = leads.filter((l) => inScope(l)).length;
        const src = {
          id: t.meta.id,
          label: t.meta.label,
          kind: "trigger",
          counties: t.meta.counties,
          status: r.status || "ok",
          count: leads.length,
          inTarget,
          note: (cached ? "cached · " : "") + (r.note || ""),
        };
        onProgress({
          phase: "trigger",
          i: ++iT,
          total: nT,
          label: t.meta.label,
          state: "done",
          source: src,
        });
        return { src, leads };
      } catch (e) {
        const timedOut = String(e.message || e).includes("timeout");
        const src = {
          id: t.meta.id,
          label: t.meta.label,
          kind: "trigger",
          status: timedOut ? "blocked" : "error",
          count: 0,
          note: timedOut
            ? "skipped — slow/login-gated source"
            : String(e.message || e),
        };
        onProgress({
          phase: "trigger",
          i: ++iT,
          total: nT,
          label: t.meta.label,
          state: "error",
          source: src,
        });
        return { src, leads: [] };
      }
    }),
  );
  for (const { src, leads } of settled) {
    sources.push(src);
    raw.push(...leads);
  }

  // 2. keep target counties, then CORROBORATE (pass 1): merge records that refer
  // to the same property across sources by case#/address, counting confirmations.
  const rawTotal = raw.length;
  let kept = corroborate(raw.filter((l) => inScope(l)));
  kept.sort(
    (a, b) =>
      priority(a.county) - priority(b.county) || saleKey(a) - saleKey(b),
  );
  const dropped = Math.max(0, kept.length - max);
  kept = kept.slice(0, max);

  // 3. enrich each kept lead by county (concurrent, fill-only-missing, never throw)
  onProgress({ phase: "enrich-start", total: kept.length });
  let eDone = 0;
  await pool(kept, 6, async (lead) => {
    const fn = enrichByCounty[lead.county];
    if (fn) {
      try {
        // reuse a recent enrichment for this property (assessor data is static)
        const ek = enrKey(lead);
        const cached = _enr.get(ek);
        let e;
        if (cached && Date.now() - cached.ts < ENR_TTL) {
          e = cached.fields;
        } else {
          e = (await fn(lead)) || {};
          _enr.set(ek, {
            ts: Date.now(),
            fields: e,
            verified: !!(e.pin || e.owner),
          });
        }
        for (const [k, v] of Object.entries(e))
          if ((lead[k] == null || lead[k] === "") && v != null && v !== "")
            lead[k] = v;
        // the county assessor returning a matching parcel is an INDEPENDENT
        // verification of the property + owner (a second confirming source).
        if (e.pin || e.owner) lead.recordVerified = true;
      } catch {}
    }
    onProgress({ phase: "enrich", done: ++eDone, total: kept.length });
  });
  for (const e of enrichers) {
    if (e.error) continue;
    const n = kept.filter((l) =>
      (e.meta.counties || []).includes(l.county),
    ).length;
    if (n)
      sources.push({
        id: e.meta.id,
        label: e.meta.label,
        kind: "enrich",
        counties: e.meta.counties,
        status: "ok",
        count: n,
        note: "enriched",
      });
  }

  // 3b. CORROBORATE (pass 2): now that enrichment added PINs, merge any records
  // that only match on PIN (address variants), unioning their source lists.
  kept = corroborate(kept);

  // 4. finalize (fills estMarket/estDebt/estEquity + base score)
  const today = new Date();
  const leads = kept.map((l, i) => finalize(l, i, today));

  // 4a. Vince value-gap pass: anchor market value with neighborhood comps and
  // compute the under-market spread (his ranking signal — NOT cheapest price).
  if (PROFILE.valueGap) {
    await pool(leads, 6, async (l) => {
      await attachValue(l);
    });
  }

  // 4b. Vince contact pass — owner phone/email for the SHORTLIST only (the leads
  // most likely to be a daily top pick). Contactability is a scoring input, so we
  // score first, trace the top candidates, then re-score. Source order, best first:
  //   Endato/Enformion API (clean, free 100/mo tier, cached)  →
  //   free people-search scrape (headed browser)  →  BatchData (paid, if keyed).
  if (PROFILE.valueGap) scoreQuality(leads); // pre-phone quality to pick the shortlist
  if (PROFILE.skiptrace) {
    const top = Number(process.env.VINCE_SKIPTRACE_TOP || 6);
    const shortlist = [...leads]
      .sort((a, b) => (b.quality ?? 0) - (a.quality ?? 0))
      .slice(0, top);
    if (endatoEnabled()) {
      for (const l of shortlist) Object.assign(l, await endatoTrace(l));
    } else {
      await enrichPhones(shortlist, (m) =>
        onProgress({ phase: "enrich", note: m, done: 0, total: 0 }),
      ).catch(() => {});
      if (skiptraceEnabled()) {
        const stillMissing = shortlist.filter((l) => !l.phone);
        await pool(stillMissing, 4, async (l) => {
          const st = await skipTrace(l);
          Object.assign(l, st);
        });
      }
    }
  }

  // 4b-2. re-score with contact info folded in (a reachable lead ranks higher).
  if (PROFILE.valueGap) scoreQuality(leads);

  // 4c. sort: Vince = biggest under-market gap first; else confirmations + score.
  leads.sort(
    PROFILE.valueGap
      ? (a, b) =>
          (b.valueGap ?? -Infinity) - (a.valueGap ?? -Infinity) ||
          b.score - a.score
      : (a, b) =>
          (b.confirmations || 1) - (a.confirmations || 1) || b.score - a.score,
  );
  return {
    leads,
    sources,
    rawTotal,
    kept: leads.length,
    dropped,
    scrapedAt: today.toISOString(),
    profile: PROFILE.name,
  };
}

function saleKey(l) {
  return l.sale ? new Date(l.sale + "T00:00:00").getTime() : 8.64e15;
}

function withTimeout(promise, ms) {
  let timer;
  const guard = new Promise((_, rej) => {
    timer = setTimeout(() => rej(new Error("timeout")), ms);
  });
  return Promise.race([promise, guard]).finally(() => clearTimeout(timer));
}
