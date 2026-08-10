# MASTER_PROMPT — preforeclosure-engine (V2 — post-dinner spec)

> The binding spec for the acquisitions-side lead engine + CRM ("REDLINE", working brand)
> for the Rockford/Barrington investor — **"Z"**. **V2, updated 2026-06-10 after the dinner
> with Z, his attorney Vincent (REAL Law Group), and his money partner Vikram.** V1 of this
> file was the pitch spec; this version locks the build to what Z actually asked for at the
> table (dinner transcripts archived privately, outside this folder). Z is also sending his
> own written transcript — reconcile it against this spec when it arrives.
>
> His acquisitions entity name was garbled in the audio (transcript renders it "azbrg") —
> **confirm spelling before using it anywhere in branding.** REDLINE stays the working brand
> until then.

---

## 0. What the dinner answered (2026-06-10) — read this first

| Open question (V1 §11/§12)            | Answer from the table                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Target counties                       | **Winnebago + Boone ONLY** ("my county is Winnebago, and Boone, which is Belvidere — I want that too"). "One city, not 30." Lake/Will/McHenry/Kane are **not his** — already built, keep behind config, deprioritize.                                                                                                                                                                                                                                                                                                                                                               |
| Sites he scrubs by hand               | Public Notice Illinois (**"the holy grail... this is what I need you to scrape"**), TJSC ("great"), **Intercounty** ("love it"), **LOGS.com** ("a big one"), an **unnamed auction-calendar site** (2-state coverage growing to ~5, IL county dropdown, columns: auction date / file # / address / opening bid — never named in the audio; roup.com is Brady's guess only; **get the URL**), Tapestry (judgment pulls), PropWire/PropStream/BatchLeads (enrichment). **He committed to sending the full list of the ~5–10 sites he uses** ("I need the list of the sites" → "yeah"). |
| Outreach: send vs draft, channel      | **Neither email nor SMS.** Skip-trace texting is dead to him ("5 cents a trace... old, obsolete, garbage... that way does not work anymore"). Channel = **check-style direct mail** via a vendor he met at a convention (~$0.40/piece). We build the **funnel + curated export file**; the vendor mails.                                                                                                                                                                                                                                                                            |
| Skip-trace (BatchData)                | **Demoted.** Do not build cheap skip-trace or SMS blast. A _quality_ phone/email lookup + pre-set text was floated at the table (speaker unclear) — later phase, TCPA-gated (our compliance requirement).                                                                                                                                                                                                                                                                                                                                                                           |
| Pricing model                         | One-time custom build, **he owns it, no subscription** — Brady proposed it, Z restated it approvingly to Vikram ("customized to my level, no subscription, let the machine just run and spit data"). Commercials tracked privately, not in this folder.                                                                                                                                                                                                                                                                                                                             |
| Timeline anchors                      | Brady quoted two at the table: a bare **scraper in 1–2 weeks** ("that was my question," Z said) and **a few months for every feature** (Z restated: "basis takes three months is what I think you said"). v1.0 sits between them — far more than the scraper (already built), far less than the 3-month everything (Phases 3–5).                                                                                                                                                                                                                                                    |
| Cadence                               | **Weekly working sessions** ("you come Tuesday... this is the plan this week") until live v1, then versioned releases (1.1, 1.2…). Venue TBD (Brady is the one who lives nearby).                                                                                                                                                                                                                                                                                                                                                                                                   |
| Fractional vendor / ILFLS / ProBidder | **Never came up.** Drop from the critical path; ask only if relevant later.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| New stakeholder                       | **Vincent wants the same engine for Elmhurst** ("I want Elmhurst, that's where he lives" / "he is doing this learning this thing for his neck of the woods"). Exact town list TBD — ask Vincent (§12). DuPage enricher already exists. Separate instance, separate deal.                                                                                                                                                                                                                                                                                                            |

---

## 1. Who this is for (the people)

| Person      | Role                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Z**       | The client. Rockford/Barrington investor. Management side runs on Buildium (~380 doors per the original intake call — unconfirmed at dinner; the dinner confirmed a 147-door purchase Vincent closed). Buildium = **OUT of scope** — he demoed it only as his quality bar for mature software. Acquisitions side = pre-foreclosure / **subject-to** ("'step into' is a better choice of word"). Proof case: Burr Ridge taken subject-to — "650… I got it for 60 grand, I'm riding out the guy's mortgage" (hold ~1yr, rent, exit; numbers from noisy audio — confirm). Plans to work the first leads **manually**, one city, to find his strengths — don't over-build ahead of that loop. |
| **Vincent** | Z's attorney, REAL Law Group (did Z's 147-door purchase). Also a licensed broker at **Nexus** (MLS access, lists/rents Z's exits, "Illuminate" drone-photo vendor, sends bulk offers from his own CRM). **Step 4 of every deal.** Brady already built/runs his system — the handoff target. Wants his own Elmhurst instance.                                                                                                                                                                                                                                                                                                                                                              |
| **Vikram**  | Z's capital partner (12–15% target returns). Runs a VA/workforce business (PH/MX/AR) + recruiting SaaS + gaming ops. No direct software requirements from him. Z's voluntary-lien capital plumbing with him and his sister = OUT of scope (Vincent papers it).                                                                                                                                                                                                                                                                                                                                                                                                                            |

**Z's 4-step operating model — the CRM stages must mirror it verbatim:**

1. **Data mining** — the engine (this build).
2. **Reaching out** — foot in the door: check-style mail, door knock, call.
3. **Working it out** — in person with the homeowner.
4. **Bring in Vincent** — paper the subject-to. (Future: one-button deal handoff into Vincent's system.)

---

## 2. The product in one sentence (V2)

**Every hour it pulls — for free, from public records — every Winnebago/Boone property
entering or moving through foreclosure, alerts Z the moment a lis pendens is filed, enriches
each lead with owner / mortgage / equity / comps, walks it down a funnel whose criteria Z
sets at every level, and turns his check-marked shortlist into the export file his mail
house prints checks from — while tracking every door-knock, call, text, and letter in his
command center.**

His one-liner for it: _"Take the information of different sources that I look at for finding
people in distress, scrub the data, consolidate it, and present it"_ — with download/export/
connect. And the standing UX mandate: **eliminate buttons, don't add them** — _"it already
calendars it, it already diaries it, it already pulls the data… line them all up and just do
them, kind of self-execute, so a lot of the mundane is gone."_

---

## 3. The spine: IL judicial foreclosure timing → his 30/60/90 windows (unchanged + 2 fixes)

Illinois judicial foreclosure (735 ILCS 5/Art. XV) leaves a public paper trail at three
moments; those moments ARE his 30/60/90 windows:

| Stage                           | Public artifact                           | Lead time | Where (FREE)                                         |
| ------------------------------- | ----------------------------------------- | --------- | ---------------------------------------------------- |
| **1. Lis Pendens / Complaint**  | FC suit filed; LP recorded                | ~90+ days | Circuit Clerk docket + Recorder LP index             |
| **2. Judgment of Foreclosure**  | Judgment entered; redemption clock starts | ~60 days  | Circuit Clerk docket                                 |
| **3. Notice of Sale → Auction** | Notice published 3 consecutive weeks      | ≤30 days  | **publicnoticeillinois.com** + auction/sheriff sites |

**V2 fixes from the table:**

- **LP age matters.** _"Lis pendens could also be two, three, four years in the making."_ The
  LP filing is still the action trigger ("starts the race for everybody"), but the engine must
  track **time-since-filing and case stage** so stale/stalled cases don't pollute the fresh-
  lead funnel. Alerts distinguish _fresh filing_ from _aged case that just moved_.
- **The redemption sweet spot — ⚠️ formula UNVERIFIED.** Vincent's (noisy, mid-crosstalk) line:
  _"You have 30 days after the entry of the judgment to redeem… that's the sweet spot."_ Z can
  act up to confirmation. But under the IMFL (735 ILCS 5/15-1603) statutory redemption for
  residential property generally runs to the **later of 7 months from service or 3 months from
  judgment** — the 30-day figure resembles the post-sale special right / confirmation window,
  not the main redemption period. **Confirm the exact formula with Vincent before deriving or
  displaying any `redemptionDeadline` field** — a wrong legal deadline shown to an investor
  making time-sensitive offers is the worst field to get wrong (§12).
- **Auction math he's undercutting:** auction investors bid 65–70% ARV (stretch 72–75%); the
  winning bidder posts 25(%) at the sale. Z's edge is contracting the owner **before** that
  room fills. (Auction-side bidding is NOT the product — these numbers WILL parameterize the
  deal-economics scoring once comps/estARV land; current `score.js` weights are
  equity/absentee/urgency/confirmation only.)

---

## 4. Counties / markets

| Priority | Market                                    | Who          | Status                                                                                                                                        |
| -------- | ----------------------------------------- | ------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| **P0**   | **Winnebago** (Rockford)                  | Z            | Triggers + enricher LIVE; deepen LP coverage (recorder module exists, not yet registered)                                                     |
| **P0**   | **Boone** (Belvidere) — "I want that too" | Z            | Enricher (wEdge) is the best of all counties; trigger side thin (Judici captcha-blocked) — needs the unnamed auction site + PNI               |
| **P1**   | **Elmhurst corridor** (DuPage)            | Vincent      | Separate instance, separate deal. DuPage enricher already built (property-intel). Needs DuPage FC triggers (PNI + TJSC already cover DuPage). |
| —        | Lake / Will / McHenry / Kane              | nobody (yet) | Already built and working — **flip TARGET config to Winnebago+Boone only**; keep the collectors dormant.                                      |
| ❌       | Cook / DuPage for Z                       | —            | Stays excluded from Z's instance (floods 600+ Chicago leads).                                                                                 |

---

## 5. Data-source map (V2)

> Brand rule unchanged: county side = **public records, not scraping** — free/official sources,
> polite throttle, on-disk cache. Gated/credentialed sources live in **isolated modules**.

### Triggers (who/when)

- **publicnoticeillinois.com** — **his #1, "the holy grail", "this is what I need you to
  scrape."** It's where notices land first; TJSC is "too late" to _start_ from. Scrape spec
  straight from his live demo (their keyword search returned nothing — it's broken): **select
  ALL publications, constrain to a ~40-day window ("I don't want two years old"), pull
  everything, keyword-filter locally** (as-demoed keywords: lis pendens / foreclosure / notice
  of foreclosure; add our own variants separately). ✅ already live and paginated — BUT ⚠️ the
  collector currently has no `TIMEOUTS` entry, so the 40-page crawl hits the 45s default and
  **timed out in the latest saved run (PNI contributed 0 leads)** — fix first (TODO #1), then
  tighten to his spec. Fast-loop design: lightweight page-1/newest-first diff on the hourly
  loop, full 40-page crawl on the existing 3h TTL (don't hammer).
- **TJSC** ✅ + **Intercounty** ✅ + **LOGS.com** (NEW — foreclosure-attorney network, "a big
  one") + the **unnamed auction-calendar site** (NEW — get URL; likely roup-family; columns:
  auction date / file # / address / opening bid; covers Winnebago + Boone). He says there are
  **~5 auction houses** total — these are _stage/deadline_ trackers, not lead origination.
- County sheriff sales ✅ (Roup/Winnebago, Boone sheriff), recorder LP feeds (Will/Lake LIVE —
  Fidlar Breeze + Kofile WebSocket). ⚠️ **Winnebago + McHenry recorders are reCAPTCHA-v3-blocked**
  (modules exist, can't register) — Winnebago's earliest-LP gap fills via PNI Details + the 17th
  Circuit clerk docket instead, NOT the recorder.
- **Vincent's legal check (pending):** he believes IMFL requires publication (state paper + 2
  others) or the FC can be thrown out — i.e., PNI should be near-complete _by law_. He's
  verifying with his "foreclosure friend." Follow up.

### Enrichment (what/how much)

- County assessors ✅ (wincoil ASPX, Boone wEdge = best-in-class, ArcGIS stack for the rest).
- **PropWire** (NEW) — his current favorite ("I use BatchLeads a lot but now I like this
  better"). Free account, modest paid tier. Per-property: est. value, **open mortgage (lender,
  est. balance, rate, recorded date, maturity, lien position)**, equity, sqft, tax, owner's
  full portfolio ("finding whales"). _"Everything here could be scraped."_ Caveats he stated:
  est. values ~90% accurate, data lags ~1 month. **Isolated module, his account, best-effort.**
- **Tapestry** — V1 said skip entirely; V2 correction: it's his **judgment-amount fallback**
  when no opening bid is posted ("you go to Tapestry, you pull the judgment"). Paid per-search:
  keep manual-queue first (surface a "pull judgment" task on shortlisted leads), automate later
  only if volume justifies.
- **Lien position** — new required field; "make sure it is the primary lien being auctioned…
  sometimes [it's] a secondary." PropWire shows it; flag anything not first-position.

### Outreach layer (replaces V1's BatchData plan)

- **Direct-mail house** (he's meeting them ~2026-06-11) — sends check-style mailers ("a bill
  goes in the trash, the check goes in your bank") with save-your-house copy + auction date.
  They bill ~$0.40/piece and _want_ to blast 10,000 — **he refuses**; the funnel's whole job is
  to hand them only the vetted shortlist. **Get their import-file format** → that's our export
  schema.
- **Phone/email lookup + pre-set text** — he floated it, then killed cheap skip-trace as
  garbage. If ever built: quality data source only, TCPA review first. Later phase.
- **AI cold/answer calling** — he asked directly ("can you get AI agents to cold call for
  you?"). Roadmap item, not v1.
- **No VAs on data, ever** — _"I have your social security… I'd rather pay for high-end
  security than somebody in the Philippines."_ Human calling (possibly Vikram's workforce) is
  _his_ op for step 2/3, not ours.

### Tools verdict table (V2)

| Tool                                                        | Verdict                                                                                                                               |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Public Notice IL                                            | #1 trigger — scrape-all + local filter                                                                                                |
| TJSC / Intercounty / LOGS / unnamed auction site / sheriffs | Stage + auction-date + opening-bid trackers                                                                                           |
| PropWire                                                    | Enrichment layer (isolated module, his acct)                                                                                          |
| Tapestry                                                    | Judgment fallback — manual queue first                                                                                                |
| PropStream / BatchLeads                                     | What we're replacing — benchmark only                                                                                                 |
| BatchData skip-trace                                        | **Dead** per Z — do not build                                                                                                         |
| SMS blast                                                   | **Dead** per Z + TCPA — do not build                                                                                                  |
| Buildium                                                    | OUT (management). Note: he pitched Brady on building a Buildium **marketplace add-on** someday — separate opportunity, not this repo. |
| Mail house                                                  | The outreach channel — we export, they mail                                                                                           |

---

## 6. Architecture — extend the live engine, don't rebuild

Base = **this repo's zero-dep Node engine** — already LIVE: 16 trigger modules (13 registered;
recorder-winnebago / recorder-mchenry are reCAPTCHA-blocked, tax-meyer has no list API — keep
inventoried, don't rebuild) incl. 2 recorder lis-pendens feeds / 8 enrichers / county-scoped
cross-confirmation (`match.js`) / scoring / server / LaunchAgent autorun, **hourly refresh**
(`AUTO_REFRESH_MINUTES=60`, proven polite at 10-min via TTL caching), a per-lead "reached out"
checkmark and a drag-and-drop deal-pipeline tracker in the CRM (localStorage, survives
re-scrape). Runs: peak observed 3,856 scanned → 1,640 leads (93% with owner names, 2026-06-08
session); latest saved artifact 2,056 → 922 (`demo/leads.json` 2026-06-11 — **5 feeds timed
out that run, incl. PNI**; fix = TODO #1). Keep the collector contract (`src/CONTRACT.md`).
V2 adds four subsystems:

```
collectors (✅) ─→ match (✅) ─→ score (✅) ─→ NEW: diff/alert daemon  ─→ text/email Z on fresh LP + late opening bids
                                      │
                                      ├─→ NEW: funnel store           ─→ levels w/ Z-editable criteria; leads HELD at level; check/X
                                      ├─→ NEW: watchers               ─→ opening-bid re-poll as sale nears; "call law firm" task w/ phone
                                      └─→ NEW: task engine (v1.x — Phase 3; v1.0 ships the derived dates as a static per-lead task list)
                                                  │
                                                  └─→ exports: mail-house file (their format), CSV, (later) one-button → Vincent's system
```

- **Cadence: ✅ ALREADY DONE** — hourly default, 15-min capable (`AUTO_REFRESH_MINUTES`),
  per-source TTLs keep heavy feeds polite ("every 15 minutes or every hour" is the line that
  sold him — we already do it). The missing piece is what happens AFTER a run: diff + alert.
- **Diffing:** persist previous run; a lead is _new_ if its strong key (case#/PIN/addr) is
  unseen. New + stage=lis_pendens ⇒ **alert** (start with email/iMessage to Z; SMS later).
- **Schema additions** to `ForeclosureLead`: `mortgage {lender, balance, rate, recordedDate,
maturity, lienPosition}`, `judgmentAmount`, `defaultDate`, `trustee`, `lawFirm {name, phone}`,
  `comps[] / estARV`, `caseAgeDays`, `redemptionDeadline`, `funnelLevel`, `approved (✓/✗/null)`,
  `touches {doorKnock[], call[], text[], letter[]}`, `tasks[]`.
- **Multi-market:** county set + funnel criteria + branding per config file ⇒ Vincent's
  Elmhurst instance is a config + DuPage triggers, not a fork.
- **Security:** local-first stays the default (LaunchAgent on his/our box, no third-party data
  processors) — that IS the "high-end security" answer. If hosted later: auth + encryption at
  rest before anything else.

---

## 7. The CRM = his **"Command Center"** (his word, his columns)

He dictated the lead-table spec at the table — build exactly this, auto-populated ("and this
scrapes, or is this manual? You need something you can scrape this"):

**Per-lead columns:** outreach touches (**DK [door knock] / call / text / letter** — date +
status each) · **auction date** · **lender** (_"very important — that's who we got to stop and
talk to"_) · **law firm** · **trustee** · **website** (source link) · **case number** ·
**mortgage date** · **mortgage** (balance) · **judgment** · **default** · **comps** · **equity**.
Plus from elsewhere in the conversation: opening bid (+ watch status), lien position, stage,
case age, days-to-sale, redemption deadline, score.

**Head start:** the CRM already has a single "reached out ✓" chip and a drag-and-drop deal
pipeline (New→Contacted→Negotiating→Under Contract→Closed/Dead) persisted by case#+county —
the Command Center **extends** those (split ✓ into the four touch types, add the new columns),
it does not start from zero.

**The funnel (agreed at the table, his words in quotes):**

- Level 1 = _everything_ scraped. Each next level applies **his parameters** ("there's got to
  be comps and mortgage… we gotta set our own parameters for each level") — editable in the UI,
  not hard-coded.
- Leads that miss a level's bar **stay visible at that level** ("it keeps all these to see them
  but doesn't move them on… so you could review back and see each level"). Nothing disappears.
- Bottom of funnel ≈ a shortlist ("a list of like 10 that fit your range") → **manual check or
  X** per lead → **one-click export** of approved leads in the mail house's format. Expected
  yield he quoted: **1–3% of a thousand**.

**Self-executing tasks** (the "eliminate buttons" mandate): each lead auto-generates its
dated playbook — mail drop now, door notice/visit **Saturday 10–2** (his line was about
_posting a notice on the door_: "the best time to put up a notice on your door is Saturday
between 10 and 2" — confirm the door-knock mapping with him), re-check opening bid at T-3
days, redemption deadline (formula UNVERIFIED — §3), auction countdown. **v1.0 ships these as
a static per-lead task list; the full auto-calendar engine is Phase 3.**

**Later (his asks, post-v1):** guided **contract generation** ("send me the contract — it
knows, it asks questions, it puts everybody on the map"), and the **two-systems handoff**:
one button pushes the deal file into Vincent's system, "it's going to know what to do, know
where to put it… I don't want any more emails." (Brady runs Vincent's system already; an
intake endpoint there is the other half.)

---

## 8. Legal / ToS posture (V2)

- County/public-notice side: unchanged — legally-public records, throttled, cached, brand it
  proudly.
- **PropWire**: account-based; isolated module, his login, no redistribution, best-effort only.
- **Tapestry**: paid per-search; manual queue keeps us clean.
- **Mail piece**: the check-style mailer is the **vendor's** product and the copy is Z's call —
  we only produce the data file. Don't advise on the mailer itself.
- **Texting**: TCPA — do not build SMS until a compliance pass happens (our own requirement;
  no reliable transcript support for him flagging it).
- **No PII to VAs / offshore** — his explicit rule; keep everything local/encrypted.

---

## 9. Roadmap (V2 — supersedes V1 phases)

- ✅ **Phase 1 (DONE 2026-06-08):** live engine — 13 registered triggers, 8 enrichers,
  corroboration, scoring, offline CRM, hourly autorun. Latest saved run: 2,056 → 922
  (`demo/leads.json` 2026-06-11; 5 feeds timed out — fix is v1.0 item 0).
- **Phase 2 = v1.0 LIVE (16–18 working days ≈ 3–4 weeks full-time, weekly Tuesday demos;
  assumes §12 items 1–2 land in week 1 — the auction-site collector and final export format
  ship whenever Z delivers them):** 0. **Fix the PNI timeout** (`TIMEOUTS` entry 120–180s; his #1 source currently contributes
  0 leads to the saved run) + re-check lake-sheriff/recorder-lake timeouts; regenerate
  `demo/leads.json`.
  1. Retarget to **Winnebago+Boone**; run diffing (cadence is already hourly/15-min capable).
  2. **LP alerts** (fresh-filing detection → email/text Z).
  3. **Command Center UI** with his exact columns + touch tracking.
  4. **Funnel levels** w/ editable criteria, held leads, check/X, **mail-house export**.
  5. **PropWire enrichment** (mortgage/lien/equity/portfolio) — isolated module.
  6. **Opening-bid watcher** + law-firm phone surfacing + Tapestry "pull judgment" task queue.
  7. New triggers: **LOGS.com**, **Intercounty deepening**, the **unnamed auction site** (once
     URL arrives). Winnebago early-LP via PNI Details + clerk docket (recorder is
     reCAPTCHA-blocked).
  8. **Comps v1** (assessor recent-sales → rough `estARV`) + static per-lead task list (the
     derived dates).
- **Phase 3 = v1.x:** self-executing task engine + calendar (the full auto-calendar version);
  comps/ARV proper (beyond the v1 rough cut); contract intake flow; **Vincent handoff**
  (one-button → his system).
- **Phase 4:** AI calling (his direct ask), quality contact-lookup + TCPA-cleared texting.
- **Phase 5:** **Vincent's Elmhurst instance** (config + DuPage triggers — separate deal);
  later markets (he floated Dallas on the H1B-default thesis).
- **Never:** management/Buildium clone; cheap skip-trace; SMS blasts; VAs on data.

---

## 10. Pricing & positioning (V2)

- Model **confirmed at dinner**: one-time custom build, he owns it, **no subscription** — he
  repeated it back to Vikram as the selling point.
- The value story: it replaces the manual sifting/sorting he said he'd otherwise pay somebody
  to do, displaces his PropStream/BatchLeads spend, and the funnel turns the mail house's
  10,000-piece blast (~$4k/run at $0.40) into a vetted shortlist.
- Post-v1 features are scoped and priced **per module, one at a time** (Phase 3–5 above), and
  Vincent's Elmhurst instance is its own conversation with Vincent.
- Numbers, floors, and negotiation notes live **privately, outside this folder** — this file
  is shown on a shared screen every Tuesday.

---

## 11. Engagement cadence (agreed)

- **Weekly working session** (Tuesday mentioned; venue TBD): "this is the project, this is
  where I've gone, this is the plan this week" → live v1.0 → then **version releases**
  (1.1, 1.2…). Bring a demo every week, even small.
- Z sends his **own transcript** of the dinner — reconcile against §0/§5/§7 on arrival.
- He works the first shortlist **manually** (one city) to find his strengths before any
  outreach automation — don't over-build ahead of his learning loop.

## 12. Open items

**Ask Z (only 2 real asks):**

1. **Mail house**: vendor name + import-file format (his meeting was ~6/11) → export schema.
2. **His complete list of the ~5–10 sites he uses** — he committed to sending it ("I need the
   list of the sites" → "yeah"). Include a one-line confirm that the auction site he demoed =
   **roup.com** (identified 2026-06-11: online sheriff/judicial auction platform, IL + OH =
   his "two states", listings show address/opening bid/auction date; we already scrape the
   Winnebago roup subdomain — check for a Boone one).

**Answer ourselves / settle at a Tuesday session (don't text Z about these):**

3. His name + entity spelling — Brady met him; fill in directly (audio garbled "azbrg").
4. Redemption formula — implement the statute (735 ILCS 5/15-1603: later of 7 months from
   service or 3 months from judgment, residential); Vincent sanity-checks at a session. Same
   for PNI publication completeness (15-1507(c): 3 consecutive weekly publications).
5. Funnel criteria v1 — ship editable defaults; tune live with him at the first session.
6. Burr Ridge numbers (650/60) + Saturday 10–2 mapping (door notice vs knock) + session
   day/venue — in person.
7. Vincent's Elmhurst instance: exact town list + scope + commercial conversation (separate
   from Z's build).
8. Z's own dinner transcript — reconcile against §0 when it arrives.
