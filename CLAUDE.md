# CLAUDE.md — preforeclosure-engine

Acquisitions-side pre-foreclosure lead engine + CRM ("REDLINE", working brand) for the
Rockford/Barrington investor **"Z"** (sibling of `property-intel`, built for Vince / Cook+DuPage).

**Read `MASTER_PROMPT.md` first — it is the binding spec (V2, post-dinner 2026-06-10).**
**`TODO.md` is the live build checklist for v1.0.** Quick orientation:

## Vince live tracker (added 2026-07-13) — separate from Z's REDLINE

Brady's investor **Vince** wants under-market cash deals (offers ~$5k, steps into the deal
where a home is worth well MORE than what's owed — ranked by the biggest UNDER-MARKET gap, NOT
cheapest price). He works **DuPage** (where he lives) + four **west-Cook** suburbs: **Berkeley,
Hillside, Northlake, Bellwood**. One command tracks it live and pings new leads to Telegram:

```
node vince-track.js            # track forever, ping each NEW lead as it appears
node vince-track.js --once     # single pass (cron-friendly)
VINCE_INTERVAL_MIN=30 node vince-track.js
```

- **Data set** is selected internally (`PROFILE=vince`, `src/profile.js`) — Brady doesn't manage
  profiles; Z's default instance (`npm start` / `npm run scrape`) is untouched (own ports/files).
- **Earliest signal = DuPage recorded LIS PENDENS** (`src/collectors/recorder-dupage.js`,
  Playwright): `recorder.dupagecounty.gov/Search.aspx` is free but double-gated — ASP.NET **NoBot**
  JS challenge + a client-side "narrow criteria" alert on date+type. We clear both with a headless
  browser + a direct `__doPostBack` (bypasses the blocking onclick; browser still computes NoBot).
  Queries **one day at a time** over `DUPAGE_LP_LOOKBACK_DAYS` (default 30). ⚠️ site is slow &
  rate-limits repeated hits; collector retries + degrades, never breaks the run. **Still needs one
  populated-grid capture to confirm the results-table column parser** (a run returned 0 rows w/o
  the throttle dialog — either genuinely-no-LPs or a parse miss; status note distinguishes them).
- Other Vince triggers reuse existing working collectors filtered to scope: **tjsc, intercounty,
  public-notice-il**. Cook munis whitelisted in `src/profile.js` (`inScope`); Chicago excluded.
- **Value gap** (`src/value.js`): market (Cook neighborhood comps by PIN-prefix sales, else
  assessor fair-cash) − debt (judgment ∥ opening bid ∥ mortgage). ⚠️ `datacatalog.cookcountyil.gov`
  is blocked in the sandbox — comps degrade gracefully; verify comps when network allows.
- **Pings** (`src/notify.js`) go through the **dedicated bot `@BradyVinceCook_bot`** — token in
  `~/Documents/redline-private/vince-bot.local.json` (NEVER in repo; loaded by `src/secrets.js`).
  This bot is SEPARATE from the Nesso/tentacle bot. Run-diff state in `.vince-state.json` (first
  run = baseline, no blast). ⚠️ **Brady must tap Start in @BradyVinceCook_bot once** so `getUpdates`
  captures his chat id (auto-remembered); until then pings send to 0 chats.
- **Phones** (`src/collectors/skiptrace.js`): owner phone via pay-per-match API (BatchData),
  shortlist-only, HARD OFF unless `SKIPTRACE_API_KEY` set. No key = no cost, no PII call.

## What this is

Z buys distressed homes with private money, targeting **pre-foreclosures / subject-to**
("step into" the mortgage), reaching owners **30/60/90 days before the auction** to stop the
sale — never bidding at auction. This tool finds those owners from free public records,
enriches + scores them, walks them down **his funnel**, and exports his check-marked
shortlist to his **direct-mail house** (check-style mailers). His Buildium management side
(~380 doors per the original intake call) is explicitly **out of scope**.

His 4-step model = the CRM stages: **1 data mining → 2 reach out → 3 work it out in person →
4 bring in Vincent** (his REAL Law Group attorney — whose system Brady also runs; a one-button
deal handoff to it is a post-v1 feature). Vincent also wants his own **Elmhurst** instance
(separate deal).

## Dinner outcomes 2026-06-10 (what changed)

- Counties for Z = **Winnebago + Boone ONLY** (current TARGET config still lists 6 — narrow it).
- Public Notice IL confirmed as **his #1 source** ("the holy grail"); their search is broken —
  scrape ALL publications in a ~40-day window, keyword-filter locally.
- New triggers wanted: **LOGS.com**, Intercounty (deepen), an **unnamed auction-calendar site**
  (URL pending from Z). ⚠️ `recorder-winnebago`/`recorder-mchenry` exist but are
  reCAPTCHA-v3-blocked — Winnebago early-LP coverage comes from PNI Details + 17th Circuit
  clerk docket instead.
- **LP-filed alert** is the core ask ("as soon as that LP gets filed you want to get an alert").
  Cadence is ALREADY hourly/15-min capable (`AUTO_REFRESH_MINUTES`) — the missing piece is
  run-diffing + the alert itself.
- **Command Center** lead table = his dictated columns (DK/call/text/letter touches, auction
  date, lender, law firm, trustee, website, case #, mortgage date, mortgage, judgment, default,
  comps, equity) + opening-bid watcher (posts 1–3 days pre-sale; Tapestry judgment fallback).
- **Funnel**: levels with HIS editable criteria; leads stay visible at their level; bottom =
  manual ✓/✗ → export file for the mail house (format pending his vendor meeting).
- **Outreach pivot**: skip-trace + SMS blast are DEAD per Z — BatchData plan demoted. Channel
  = curated direct mail. AI calling + contract generation + Vincent handoff are post-v1 asks.
- Engagement: **one-time build, he owns it, no subscription** (confirmed); **weekly Tuesday
  working sessions** until v1.0 live, then 1.x releases. Z is sending his own dinner
  transcript — reconcile it with MASTER_PROMPT §0 when it arrives.

## Hard rules

- County side = **public records, not scraping**. Free/official sources only; gated sources
  (PropWire = his account, Tapestry = paid) live in **isolated modules**.
- **No cheap skip-trace, no SMS blasts** (his explicit verdict + TCPA), **no VAs / no PII
  off-box** ("I'd rather pay for high-end security"). Local-first stays the default.
- Boone enricher (DEVNET wEdge) is the model county; its trigger side is thin (Judici
  captcha-blocked) — the unnamed auction site + PNI are the fill.
- Demo data is clearly labeled SAMPLE — never represent it as live.

## Layout

- `MASTER_PROMPT.md` — binding spec V2 (dinner answers in §0, command center §7, roadmap §9,
  pricing §10).
- `TODO.md` — v1.0 build checklist with estimates.
- `demo/index.html` — self-contained CRM (auto-populates from the server; offline-capable).
- `src/` — zero-dep engine: 16 trigger modules (13 registered; recorder-winnebago +
  recorder-mchenry reCAPTCHA-blocked, tax-meyer no list API — inventoried, don't rebuild) +
  8 enrichers + match/score (see `src/CONTRACT.md`; add a county/source = new module + id in
  `collectors/index.js`). ⚠️ Known bug: `public-notice-il` has no `TIMEOUTS` entry → 45s
  default vs a 40-page crawl → **timed out in the latest saved run (his #1 source contributed
  0 leads)**. Fix first (TODO #1).
- `server.js` — zero-dep node server on :8787, scheduler, `/api/leads`, `/api/scrape/*`.
- `autorun/` — macOS LaunchAgent installer (login autostart, KeepAlive, scheduled scrape).
- `data/` — dated lead archives. (Dinner transcripts + commercials live privately, outside
  this folder — it's on a shared screen every Tuesday.)

## Running it

```
bash autorun/install-autorun.sh     # LaunchAgent: autostart + KeepAlive + scheduled scrape
npm start                           # manual server on :8787
npm run scrape                      # one-off full scrape -> demo/leads.json + data/leads-<date>.json
```

⚠️ TARGET counties: currently Winnebago, Boone, McHenry, Lake, Kane, Will — **v1.0 narrows the
default to Winnebago+Boone** (Z's ask); keep the rest behind config. Cook+DuPage stay excluded
from Z's instance (they're Vince's / flood 600+ Chicago leads) — but DuPage powers Vincent's
future Elmhurst instance.

## Status

- 2026-06-10: **Dinner with Z + Vincent + Vikram.** V2 spec written (MASTER_PROMPT), TODO.md
  added, transcripts archived privately. v1.0 scope locked: alerts, command center, funnel +
  mail export, PropWire enrich, opening-bid watcher, new triggers, comps v1. ~3 weeks
  full-time. Open items in §12 (his site list, mail-house format, entity spelling, redemption
  formula via Vincent).
- 2026-06-08 (later phases, same day): **cross-confirmation** (`match.js corroborate()`,
  county-scoped keys, confidence/conflicts), **hourly refresh** (`AUTO_REFRESH_MINUTES=60`,
  proven at 10-min w/ TTL caching, cold 109s → warm 8s), **2 recorder lis-pendens feeds**
  (recorder-will Fidlar Breeze + recorder-lake Kofile WebSocket = earliest signal + owner
  names), CRM **"reached out ✓" chip** + **drag-drop deal pipeline** (localStorage by
  case#+county, survives re-scrape), 45s live page refresh. Peak run: **3,856 scanned → 1,640
  leads, 93% with owner name, 1,290 lis_pendens**. recorder-winnebago/mchenry reCAPTCHA-blocked;
  tax-meyer blocked.
- 2026-06-08: **Phase 1 + auto-run.** 24h scheduler + LaunchAgent, CRM auto-populate, uncapped,
  PNI pagination (50→1000), parallel triggers w/ timeouts. Cold run ~37s, 1,741 scanned → 74
  leads; later run 2,056 → 922.
- 2026-06-07: **Phase 1 LIVE.** 12/13 collectors live (Judici-Boone captcha-blocked). Known
  gaps: equity fills only on assessor address-match; TJSC opening bids TBD until ~1 day
  pre-sale; PNI street address/sale-date gated to a free Details.aspx account.
- 2026-06-07: Phase 0 — spec + offline demo.
