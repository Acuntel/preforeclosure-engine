# TODO — v1.0 build checklist (post-dinner 2026-06-10)

> Scope locked by MASTER_PROMPT.md V2 (§9 Phase 2). Honest arithmetic: the sections below sum
> to **16–18 solo working days ≈ 3–4 weeks full-time**, assuming the §0 unblocks land in week 1.
> The auction-site collector and the final mail-house export format ship **whenever Z delivers
> them** — don't let a blocked item make v1.0 look late. Weekly Tuesday demo cadence.

## 0. Genuinely blocked on Z (only 2 real asks)

- [ ] **Mail house**: vendor name + import-file format (his meeting ~6/11) → defines our export schema
- [ ] **Z's complete list of the ~5–10 sites he uses** — committed at dinner ("I need the list of the sites" → "yeah")
- [ ] One-line confirm: the auction site he demoed = **roup.com**? (Identified 2026-06-11: Roup = online sheriff/judicial auction platform, **IL + OH = his "two states"**, listings show address/opening bid/auction date, and we ALREADY scrape `winnebagocountysheriff-il.roup.com`. Check for a Boone roup subdomain while building.)
- [ ] Z's own dinner transcript (he's sending it) — reconcile vs MASTER_PROMPT §0

## 0b. Answerable ourselves (don't ask Z)

- [x] ~~Entity spelling~~ — Brady met him at dinner; fill his name + company into the project record directly (audio garbled it as "azbrg")
- [x] ~~Funnel criteria~~ — ship **editable defaults** (equity floor, ARV band, case-age cutoff) and tune them live with him at the first Tuesday session; don't block on asking
- [x] ~~Redemption formula~~ — implement the statute (735 ILCS 5/15-1603: later of **7 months from service** or **3 months from judgment**, residential) and have Vincent sanity-check at a session; same for PNI publication requirement (15-1507(c): 3 consecutive weekly publications) — both are statute lookups, not client questions
- [ ] Saturday 10–2 mapping (door notice vs knock) + session day/venue — settle in person, not by text

## 1. Bug first: un-block the #1 source (~half day)

- [ ] Add `TIMEOUTS` entry for `public-notice-il` (120–180s — the 40-page crawl can't finish in the 45s default; it timed out in the latest saved run and contributed **0 leads**)
- [ ] Re-check why lake-sheriff + recorder-lake timed out despite 120s caps; bump if needed
- [ ] Re-run full scrape, regenerate `demo/leads.json`, confirm PNI leads present
- [ ] Clean stale comments while in there: `server.js:4-5` (AUTO_REFRESH_HOURS → AUTO_REFRESH_MINUTES), `server.js:115` ("auto-24h" → "auto"), `install-autorun.sh:3-4` ("every 24h")

## 2. Retarget + alerts (~2 days)

- [ ] Narrow default TARGET to **Winnebago + Boone** (config-gated, keep the other collectors dormant)
- [x] Cadence — ALREADY hourly (`AUTO_REFRESH_MINUTES=60`, 15-min capable, TTL caches keep heavy feeds polite). Nothing to build; mention it to Z as done.
- [ ] Run-diffing: persist previous run, detect NEW strong-keys (case#/PIN/addr)
- [ ] **LP-filed alert**: new lead + stage=lis_pendens ⇒ email (and/or iMessage) to Z, with address/owner/case/source links
- [ ] Late-breaking **opening-bid alert** (bid appears within T-3 days of sale)
- [ ] `caseAgeDays` + fresh-vs-aged distinction in alerts ("LP can be 2–4 years in the making")

## 3. Schema + enrichment (~3 days)

- [ ] Extend `ForeclosureLead`: `mortgage{lender,balance,rate,recordedDate,maturity,lienPosition}`, `judgmentAmount`, `defaultDate`, `trustee`, `lawFirm{name,phone}`, `estARV/comps[]`, `redemptionDeadline` (⚠️ formula UNVERIFIED — blocked on Vincent, §0; don't display until confirmed), `funnelLevel`, `approved`, `touches{dk,call,text,letter}`, `tasks[]`
- [ ] **PropWire enricher** (isolated module, his account): mortgage/lien/equity/portfolio; mark est-value ~90% + ~1-month lag as confidence metadata
- [ ] **Lien-position flag**: highlight anything not first-position ("make sure it is the primary lien")
- [ ] Comps v1: assessor recent-sales of similar nearby parcels (Boone wEdge supports query-by-sale) → `estARV`
- [ ] Tapestry **"pull judgment" task queue** (manual first; automate only if volume justifies)

## 4. New triggers (~2–3 days)

- [ ] **LOGS.com** collector ("a big one")
- [ ] **Intercounty** deepening (per-sale detail: case #, firm, opening bid)
- [ ] **Unnamed auction site** collector (once URL arrives) — auction date / file # / address / opening bid
- [ ] Winnebago early-LP coverage: `recorder-winnebago` is reCAPTCHA-v3-blocked (do NOT just register it) — use PNI Details.aspx + investigate the 17th Circuit clerk chancery docket instead
- [ ] Inventory note (don't rebuild): `recorder-mchenry` (reCAPTCHA-blocked) + `tax-meyer` (no list API) also exist unregistered — stay dormant with the non-Z counties
- [ ] PNI: confirm scrape follows his spec — ALL publications, ~40-day window, local keyword filter (lis pendens / notice of foreclosure); pull Details.aspx (free account) for address + sale date

## 5. Command Center UI (~3 days)

- [ ] Lead table with **his dictated columns**: DK/call/text/letter (touch tracking w/ dates), auction date, lender, law firm, trustee, website (source link), case #, mortgage date, mortgage, judgment, default, comps, equity (+ opening bid/watch, lien position, stage, case age, days-to-sale, redemption deadline, score)
- [ ] Editable touch tracking — EXTEND the existing "reached out ✓" chip + drag-drop deal pipeline (already in demo/index.html, localStorage by case#+county) into the four touch types (DK/call/text/letter) with dates
- [ ] Opening-bid watcher status per lead + "call law firm" surfacing with phone number

## 6. Funnel + export (~3 days)

- [ ] Funnel levels with **Z-editable criteria** per level (UI, not hard-coded)
- [ ] Leads HELD at their level (visible, review-back; nothing disappears)
- [ ] Shortlist ✓/✗ review flow
- [ ] **Mail-house export**: extend the EXISTING CSV export (demo/index.html "⤓ Export CSV") to approved-leads-only; swap to the mail house's import format when it arrives

## 7. Comps v1 + hardening + ship (~3 days)

- [ ] Comps v1: assessor recent-sales of similar nearby parcels → rough `estARV` (Boone wEdge supports query-by-sale); "proper" comps/ARV stays Phase 3
- [ ] Static per-lead task list (derived dates: mail drop, Sat 10–2 door visit, T-3 bid check, auction countdown) — full auto-calendar engine stays Phase 3

- [ ] Persist funnel/touch/approval state across scrapes (merge on strong key, never clobber his edits)
- [ ] Per-user/market config file (county set, criteria, branding) — also unlocks Vincent/Elmhurst later
- [ ] Run as LaunchAgent on the deployment box; backup `data/` dailies
- [ ] Weekly demo build notes (v0.x changelog for the Tuesday sessions)

## Post-v1 (priced separately — MASTER_PROMPT §9/§10)

- [ ] Self-executing task engine + calendar — the full auto-calendar version of the v1 static task list (mail date, **Sat 10–2** door notice/visit, T-3 bid check, redemption deadline once verified, auction countdown)
- [ ] Contract intake flow ("it asks questions, puts everybody on the map")
- [ ] **Vincent handoff**: one-button deal file → his system (Brady runs it; needs intake endpoint there)
- [ ] AI calling (his direct ask); quality contact lookup + TCPA-cleared texting
- [ ] **Vincent's Elmhurst instance** (config + DuPage triggers — separate deal, $3–5k)

## Never

- Buildium/management clone · cheap skip-trace · SMS blasts · VAs touching data/PII
