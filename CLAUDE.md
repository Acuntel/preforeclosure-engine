# CLAUDE.md — preforeclosure-engine

Acquisitions-side pre-foreclosure lead engine + CRM ("REDLINE", working brand) for the
Rockford/Barrington investor **"Z"** (sibling of `property-intel`, built for Vince / Cook+DuPage).

**Read `MASTER_PROMPT.md` first — it is the binding spec (V2, post-dinner 2026-06-10).**
**`TODO.md` is the live build checklist for v1.0.** Quick orientation:

## Vince live tracker (added 2026-07-13; one-a-day picker 2026-09-28)

Separate from Z's REDLINE. Binding spec: `VINCE_MASTER_PROMPT.md` (approved 2026-09-28; decisions in
its section 2 are locked). Vince wants under-market cash deals near his Elmhurst office. He gets
**exactly ONE lead per day at 10:00 Chicago** (Telegram + email), or an honest "No deal worth your
time today. Closest miss: ..." line. Instant alerts are off (`VINCE_INSTANT=1` to revive).

```
node vince-track.js                    # Railway start command: scan hourly, pick at 10:00
node vince-track.js --dry-run [--from leads.json] [--as-of YYYY-MM-DD]   # never sends, never writes state
node scripts/backtest-pick.js data/prod-archives <stateCopy>             # picker over archived pools
npm test                               # node --test test/*.test.js (Node 20.20.2 = Railway)
```

- **Scope** (`src/profile.js`, `PROFILE=vince`): Cook + DuPage, Lake, Will, Kane, McHenry, every
  county held to `VINCE_RADIUS_MI` (default 30) of Elmhurst. Chicago proper and Bellwood excluded.
- **Triggers**: dupage-sheriff (OCV JSON feed), probate-pni (Public Notice IL claims notices),
  tjsc, intercounty, public-notice-il, recorder-will, recorder-cook (date-chunked under the CRS
  1000-row cap), lake/will sheriff. recorder-lake, kane-sheriff, mchenry-sheriff stay dead on
  Railway (Node 20, no poppler; D7). Retired: probate-dailyherald, chicago-violations,
  craigslist-fsbo, recorder-dupage.
- **Picker** (`src/pick.js` + `pick-eval.js`, `value-math.js`, `owner.js`, `alias.js`): hard gates
  (dead status on any source, sale passed or under `VINCE_MIN_RUNWAY_DAYS`=10, no address/owner,
  entity or government owner, outside radius, already sent on any alias, suspect or weak value, gap
  under $50k/20%), then EV = equity x P_stage x P_contact x P_conf x P_prox. Market = assessor
  anchor (Cook AV x10, collar x3) unless 5+ distinct comps agree; payoff = judgment x1.1, true
  opening bid, mortgage, else last sale x0.9 (low confidence). Estates get x1.15 and a probate path.
- **Send path** (`src/digest.js`, split out of notify.js): hard cap 1 (`VINCE_DAILY_COUNT` ignored),
  pending marker saved before sending, at-most-once on crash, every alias stored in sentKeys.
  Degraded pool (comps under 50% or tjsc/intercounty/recorder-cook down) defers until
  `VINCE_DIGEST_CUTOFF_HOUR`=14. Pool archive + `picks/<date>.json` go to `archiveDir()`.
  DuPage cases that leave the sheriff list before their sale are marked cancelled (`src/dupage-cancel.js`).
- **Review fixes 2026-09-29:** market capped at assessor x county lag (Cook 1.15, Will 1.35, DuPage 1.1,
  `VINCE_MARKET_CAP_<COUNTY>`); townhome/condo/PUD falls back to the assessor; a court payoff under 25% of
  value is a possible second loan (low, or suspect for MCLP/association plaintiffs); every pick needs an
  assessor anchor; estate x1.15 only with 21+ days runway; `VINCE_MIN_EV` (50000) floor sends the no-deal
  line instead of filler; collar leads with no sale history get their own last sale from MyDec (24h cache).
- **Send guards:** real Telegram/email only on Railway (or `VINCE_ALLOW_LOCAL_SEND=1`); `--digest-now` never
  sends twice in a day without `--resend`; if the name goes out and the card fails, the card is retried in the
  same pass and the pick is never resent; the follow-up on yesterday's lead rides on today's card (no extra
  message); an unreadable state file stops the pass instead of being overwritten.
- **Phones: none** (D6). Skip-trace is off for Vince; the card is name + address and Vince uses Forewarn.
- **Bot** `@BradyVinceCook_bot`; token from Railway vars or `~/Documents/redline-private/vince-bot.local.json`
  (never in repo). Dev runs always use `VINCE_PING_OFF=1 VINCE_EMAIL_OFF=1` and a scratch `VINCE_STATE_FILE`.

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

## Deploying (for claude-box / phone sessions)
- Live service = Railway project `vince-tracker` (workspace "acuntel's Projects").
- Deploy from this repo's root: `railway link -p vince-tracker` once, then `railway up --detach`.
- ⚠️ ONE instance only: never run a second copy of the bot locally while the Railway one is live (Telegram gives 409 conflicts). A normal redeploy (replace) is fine.
- Secrets come from Railway service variables, never from files in this repo.
- The web page is served by server.js from demo/index.html.
