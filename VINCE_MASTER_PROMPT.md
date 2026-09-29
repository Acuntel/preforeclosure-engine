# VINCE MASTER PROMPT: One Lead a Day, and Make It the Best One

> Binding spec for the next change to the Vince tracker (`vince-track.js`, Railway project
> `vince-tracker`, service `tracker`). Written 2026-09-28 from a read-only 4-agent audit of the
> code AND 60 days of production data. Raw evidence: `docs/vince-audit-2026-09-28.md`.
> Prototype ranker from the audit: `docs/vince-audit-scripts/proto.mjs`.
> This file is NOT `MASTER_PROMPT.md` (that one is Z's REDLINE spec).
>
> **Status: APPROVED by Brady 2026-09-28 with the decisions locked in section 2.**

---

## 0. Mission

Vince gets **exactly one lead per day** at 10:00 Chicago time, on Telegram and by email. That lead
must be the deal a sharp human acquisitions person would pick from the whole pool:

- **real equity** (a market value and a payoff we can defend, not a zip median minus a guess),
- **a clock the owner cannot stop**, with enough runway for Vince to act (not an auction tomorrow),
- **a real person** who owns and can sell the house (not an LLC, a condo association, or the US government),
- **inside Vince's radius** of his Elmhurst office,
- **never a dead deal** (cancelled, already sold to the bank, sale date passed) and **never a repeat**.

If no lead clears that bar on a given day, Vince gets an honest one-line "no deal worth your time
today" message instead of a filler lead. One great lead beats five mediocre ones. That is the whole point of the change.

## 1. What the audit proved (why this change is needed)

The process is healthy: pass #3598, no restarts since 08-05, and scans take about 80s. What it sends is not.

1. **The ranking never picks the best lead on purpose.** `notify.js:295-303` sorts tier, then
   distance, then quality, and uses the value gap only as the last tie-breaker. Every day holds
   120 to 155 A-tier leads (13 at q100 today), so distance alone decides. The digest has worked
   outward from Elmhurst in rings: median send distance was 7.8 mi in early August and 21.7 mi by
   early September. Every A-tier lead within 20 mi is now used up. On 09-28 it sent two leads in
   Antioch at 40 mi, and one of them had a sale date that had already passed. Under the current
   code, tomorrow's #1 is 905 Winthrop Ct, Zion: 39 mi away, with the auction on 09-29.
2. **The value gap is mostly fabricated.**
   - 76% of sends used "debt = last sale × 0.8" (`score.js:35`), and 62% used a whole-zip MyDec median capped at 80 rows (`value.js:129`).
   - Multi-PIN single sales get counted as several comps. That produced the fake gaps at 1826 S 13th Ave, Broadview ($721k, sent at q100, real value about $290k) and 4125 Konrad Ave, Lyons ($381k).
   - Cook uses assessed × 3, but Cook assesses residential property at 10% (`score.js:27`).
   - The **judgment amount, the real payoff, is never used**, even though 58 leads carry one.
3. **Dead deals qualify.** Intercounty's `status` (Cancelled / To Plaintiff / Third Party) is never read. When a sale date has passed, the lead falls through to "judgment" or "lis_pendens" and keeps 34 to 38 distress points. Intercounty's post-sale winning bid is stored as `openingBid`, which earns "high" confidence.
4. **Auction imminence is rewarded exactly when Vince has no runway.** A sale 7 days or less away is the maximum score. 35 sends had a sale within 3 days.
5. **The 20 mi radius only applies to Cook** (`profile.js:99-107`). Out-of-radius Lake, Will, Kane and McHenry leads compete for the slot: 37 A-tier leads today.
6. **Entity, government and HOA owners get through.** 2305 Sanders Rd, Northbrook (an LLC, with "$1.6M gap"), a condo association in Evanston, and "UNITED STATES OF AMER" at a −$197k gap all qualified or were sent.
7. **Absentee +12 is often false.** A substring check flips on "N" / "AVE" differences, which affects 20 of 52 absentee-flagged leads.
8. **The same property gets re-sent under a new key.** There were 7 repeat addresses in 306 sends (`leadKey` at `notify.js:233-236`).
9. **Vince's best signals are dead in production:**
   - **Daily Herald probate** has been behind Cloudflare since about 09-10, and it still reports "ok". Result: 0 probate leads ever sent.
   - **DuPage recorder** needs Playwright, which is not on Railway.
   - **Lake recorder** needs Node 22 (Railway runs 20.20.2).
   - **Kane and McHenry sheriff** use a hardcoded `/opt/homebrew/bin/pdftotext`.
   - **DuPage, Vince's home county, has 24 leads**, all from Intercounty.
10. **The feedback loop is empty.** 1 button tap in 306 sends, 0 meetings logged, 0 phones ever, and no instant alert since 07-21.
11. **Two found-money wins:**
    - A free **DuPage Sheriff JSON feed** (`apps.myocv.com/feed/rtjb/a36160187/foreclosureListings`) works from Railway: 86 sales, all within 20 mi, 44 within 10 mi, about 65 new to us. It includes two in Elmhurst itself, 132 S Linden Ave (sale 10/01) and 204 Clinton Ave (11/17).
    - **Public Notice Illinois** already carries the same probate "claims notices" Daily Herald had: 301 in 45 days, 84 DuPage, 38+ with the decedent's address.

## 2. Decisions (LOCKED 2026-09-28 by Brady)

**Brady's answers:**
- D1: literally one a day. One message per day, instant alerts OFF.
- D2: **30 mi** radius for every county.
- D6: **no** phone lookups. Skip P1-5 and do not add Endato keys.
- D7: **keep Railway as it is.** No Node 22 or poppler image change, so recorder-lake, kane-sheriff and mchenry-sheriff stay dead. Skip that P2 item.
- **Claude changes the Railway var** `VINCE_DAILY_COUNT` to 1, in the same deploy as the new picker (a var change triggers a redeploy, so archives are pulled first).
- D3, D4, D5, D8: the defaults below stand.

Original decision table, for reference:

| #   | Decision                                  | Default in this spec                                                                                                                                                                 | Alternative                                                                                                                       |
| --- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| D1  | What "one a day" means                    | **1 lead in the 10am send. Instant alerts OFF.** Scan hourly, plus a forced fresh pass at 9:40am.                                                                                    | Also keep instant alerts, redefined as "a new lead that beats today's pick".                                                      |
| D2  | Radius                                    | **Hard 20 mi for every county.** Env `VINCE_RADIUS_MI` to change.                                                                                                                    | 30 mi. This lets the Will County judgment-backed estate deals (Romeoville, Tinley Park, Lockport, $170k to $300k equity) compete. |
| D3  | Minimum runway before a sale              | **10 days** (`VINCE_MIN_RUNWAY_DAYS`).                                                                                                                                               | 7 or 14.                                                                                                                          |
| D4  | No-deal day                               | **Send "No deal worth your time today. Closest miss: <address>, <reason>."**                                                                                                         | `VINCE_FALLBACK=best`: send the top near-miss, clearly labeled as weaker.                                                         |
| D5  | HUD / US as co-defendant next to a person | **Allowed, and treated as a mild positive** (often a reverse mortgage or FHA partial claim, which often means an elderly or deceased owner). HUD or US as the only party is dropped. | Drop any government party.                                                                                                        |
| D6  | Phones                                    | **Use Endato's free tier (100/mo) on the winner plus 2 backups only.** Brady signs up and adds `ENDATO_AP_NAME` + `ENDATO_AP_PASSWORD` on Railway.                                   | Keep the name-only card. Vince uses Forewarn.                                                                                     |
| D7  | Railway image change                      | **Yes: Node 22 + poppler-utils** (revives Lake LP and Kane/McHenry). No Playwright (about 300MB for a site that still throttles).                                                    | Skip. Those 3 sources stay dead.                                                                                                  |
| D8  | Where Vince actually works                | **Assume both Telegram and email.** Add a next-day follow-up in both.                                                                                                                | Ask Vince. The 1-tap-in-306 number suggests he never uses the buttons.                                                            |

Brady must also **delete the Railway var `VINCE_DAILY_COUNT=5`** himself (or approve Claude doing it).
The code will hard-cap at 1 anyway, but a stale var is a trap.

## 3. Hard constraints for the implementer

- **Never ping Vince or Brady during development.** Every test run uses `VINCE_PING_OFF=1`, `VINCE_EMAIL_OFF=1` (new, see P0-1) and a scratch `VINCE_STATE_FILE` under the scratchpad. ⚠️ Today `test-digest.js` emails Vince real leads because `emailLead` ignores `VINCE_PING_OFF`. Fix that FIRST.
- **Exactly one live instance** may poll Telegram (two pollers cause a 409). Do not run the loop locally against the real bot while Railway is up.
- **Before ANY redeploy, pull the lead archives off the container.** The 55 daily archives (08-05 to 09-28, 217MB) live in `/app/data` on the container filesystem, NOT the volume. A redeploy deletes them, and they are the only backtest data we have. Pull them with `railway ssh` into local `data/prod-archives/` (gitignored).
- **Deploy is `railway up` from the repo dir** (`.railwayignore` keeps `/data/` root-anchored; do not break `src/data/il-geo.json`). Push to GitHub once, for the whole unit of work.
- **User-facing copy** (Telegram + email): no em or en dashes, full sentences, and keep Brady's number line in the email.
- **Files under 300 lines.** `notify.js` is already 648, so new ranking logic goes in a new `src/pick.js` and not into notify.js. Split notify.js if you touch it heavily.
- **Do not revert** `hourCycle:"h23"` in `vince-track.js` `chicago()` (the midnight-digest fix).
- Keep Z's default profile behavior untouched (`PROFILE` unset means Z).

## 4. The build, in order

### P0: ship these together (this is "one a day, the best one")

**P0-1. Safety + dry-run + backtest harness (do this before touching ranking).**

- `emailLead` honors `VINCE_PING_OFF=1` and new `VINCE_EMAIL_OFF=1`. `test-digest.js` sets both.
- `node vince-track.js --dry-run [--from <leads.json>]` scans (or loads) the pool, runs the picker, and prints the #1 pick plus 5 runners-up with every EV term and every gate failure. It never writes state and never sends.
- `scripts/backtest-pick.js <archiveDir> <stateFile>` runs the picker over every archived day and prints one pick per day, plus gate-drop counts.
- Accept: the dry-run on the live pool prints one pick, the state file mtime is unchanged, there is no "emailed" line, and the backtest prints 53+ days with no errors.

**P0-2. Value math you can defend** (`src/score.js`, `src/value.js`).

- Market value:
  - Assessor anchor = Cook AV × 10, collar AV × 3.
  - Comps are used only if there are at least 5 **distinct** sale events (dedupe on price+date), with MyDec multi-parcel rows (`line_2_total_parcels>1`) and related-party, in-lieu and partial-interest sales excluded.
  - The comps median must sit within 0.55× to 1.8× of the anchor; otherwise use the anchor.
  - Prefer $/sqft × subject sqft when sqft is known.
- Payoff:
  - Use the first figure that exists: **judgment × 1.1**, then a true opening bid (NOT Intercounty's post-sale bid), then a recorded mortgage amount if available, then last arm's-length sale ≥2008 × 0.9, flagged `guess`.
  - Rename the numeric judgment field to `judgmentAmount` (it collides with a date field in CONTRACT.md).
- Confidence:
  - `high` = judgment or real bid payoff plus a sane market.
  - `medium` = anchor and comps agree, with a real payoff.
  - `low` = guessed payoff.
  - `suspect` = a gap over 60% not backed by a judgment or bid.
- Accept: Broadview 1826 S 13th and Lyons 4125 Konrad lose their fake gaps. Will-sheriff leads with judgments show basis `judgment`. No qualified lead shows "est. cost" at medium confidence.

**P0-3. Hard gates in one place** (new `src/pick.js`; `profile.js` `inScope`).
Before ranking, drop a lead if any of these hold:

- status matches `/cancel|plaintiff|third party|sold|vacat|dismiss/i` on any merged source
- the sale date is before today **in Chicago time** (fix `daysTo` in `score.js`, which uses container UTC midnight)
- the sale is less than `VINCE_MIN_RUNWAY_DAYS` away
- the address or owner name is missing
- the owner is only an entity or the government (LLC, INC, CORP, ASSN, CONDO, TRUST/LTC land trusts, UNITED STATES, HUD, STATE OF, BANK); HUD or US next to a person is allowed (D5)
- the gap is unknown or ≤ 0, or below $50k or 20%
- the lead is outside `VINCE_RADIUS_MI`, applied to **every** county
- the lead is already sent, matched on **any** alias (see P0-5)

Accept: on the 09-28 pool, all of these are excluded: 61 Pier Dr Westmont, 2310 Cuyler Ave Berwyn, 791 Derby Ct Antioch, 905 Winthrop Ct Zion, 9 N 5th Ave Maywood, 1209 S 15th Ave Maywood, 2305 Sanders Rd Northbrook, 426 Hamilton St Evanston. A unit test covers each gate.

**P0-4. Rank by expected profit, send exactly one** (`src/pick.js`, `notify.js`, `vince-track.js`).

- `EV = equity$ × P_stage × P_contact × P_conf × P_prox`. It is uncapped, so no 100-point ties.
- P_stage:

  | Stage                      | Weight |
  | -------------------------- | ------ |
  | Sale 22 to 90 days out     | 1.0    |
  | Judgment, no sale set      | 0.9    |
  | Sale 10 to 21 days out     | 0.85   |
  | Lis pendens                | 0.8    |
  | Sale more than 90 days out | 0.8    |

  Dead-owner or estate markers add ×1.15 (see P1-1). A distinct second distress category, such as probate plus foreclosure or tax plus foreclosure, adds ×1.1. More sources for the same sale do NOT stack.

- P_contact: owner name present 1.0, missing is gated out, verified phone 1.1.
- P_conf: high 1.0, medium 0.85, low 0.6, suspect is gated out.
- P_prox: ≤10 mi 1.0, ≤20 mi 0.9, ≤30 mi 0.7 (only if D2 = 30). Proximity counts **only here**.
- Tie-breaks: runway closest to 21 to 45 days, then distance, then freshness. Freshness counts only for true filing or recording dates, never a newspaper publication date.
- Hard-cap the digest at 1 in code, regardless of `VINCE_DAILY_COUNT`. Remove the `runInstantAlerts` call, or put it behind `VINCE_INSTANT=1` (default off).
- The card shows the EV reasoning in plain sentences: "Worth about $X, owes about $Y (judgment), so about $Z of equity. Sale in N days. M miles from the office."
- Accept: across 53 backtest days there are 0 picks with dead status or a past sale, 0 beyond the radius, and every pick has a known positive gap. Brady eyeballs the 53 picks against the old sends.

**P0-5. Idempotent, crash-safe send + alias dedupe** (`notify.js`).

- Save `lastDigestDate` and a pending pick id BEFORE sending.
- Mark a lead sent only when a Telegram `message_id` comes back; otherwise retry on the next pass.
- Store every alias (case#, doc#, PIN, normalized address with unit kept) in `sentKeys`, and check all of them.
- Backfill aliases from the addresses in the existing 306 outcomes.
- Accept: a simulated crash between send and save produces no duplicate. The 7 known repeats (e.g. 9807 N Greenwood Ave Niles, 630 W Glencoe Rd Palatine) read as already sent.

**P0-6. No-deal days + degraded pools** (`src/pick.js`, `notify.js`).

- **Nothing passes the gates:** send the D4 message and mark the day done.
- **Pool health check:** comps coverage among in-radius leads is under 50%, or tjsc, intercounty or recorder-cook is blocked. When that happens, defer to later passes until `VINCE_DIGEST_CUTOFF_HOUR` (default 14), then decide.
- Accept: the dry-run with gates forced to fail prints the no-deal message, and the dry-run with comps stubbed to null defers, then sends at the cutoff.

### P1: make the best lead findable (sources + signals + feedback)

**P1-1. Dead-owner signals from captions.** Match owner, defendant or lender against
`/UNKNOWN HEIRS|LEGATEES|SPECIAL REPRESENTATIVE|ESTATE OF|DECEASED|\bEST\b/`.

- A match counts as probate distress and gets the ×1.15 stage bonus.
- In `recorder-cook`, when the "lender" is the estate (e.g. `SHEMECHKO JOHN L EST`), swap it into owner.
- About 20 live leads match today, and 3 qualify under the old code.

**P1-2. DuPage Sheriff collector** (new `src/collectors/dupage-sheriff.js`, about 60 lines, plain fetch).

- Owner = the title after " VS " (strip ET AL), lender = the part before it.
- Address, city and zip come from "Property Address: …". Stage `auction_imminent`, county DuPage, TTL 1h.
- A case# that vanishes before its sale date is a cancellation signal (tracked in state).
- Accept: status ok with 60+ rows, and 132 S Linden Ave + 204 Clinton Ave Elmhurst are in the pool.

**P1-3. Probate via Public Notice Illinois**, replacing the Daily Herald scrape.

- Parameterize the PNI keyword and add a probate parser ("claims notice", 45 days).
- Pull decedent, case#, and address when present.
- Fix `CASE_FIX` so "Du Page" and "Mc Henry" normalize.
- Give probate its own qualifying path that doesn't need a debt figure. It qualifies when all of these hold:
  - it is an estate
  - the anchor value is above $X
  - the last purchase was 10+ years ago, or there is no mortgage on record
  - the owner is inside the radius
- Retire `probate-dailyherald` or mark it `blocked` honestly, and fix its `_seen` skip bug if kept.

**P1-4. Feedback loop that actually collects data.**

- Write `/data/picks/<date>.json` (the pick plus the top 5 with every EV input) and the daily archive to the **volume**.
- Add "bad lead" reason buttons: value wrong / already sold / too far / can't reach.
- Send a next-day follow-up on Telegram AND email when the outcome is still empty.
- Re-weighting waits for 30 labeled outcomes.

**P1-5. Skip-trace only the winner** plus 2 backups, AFTER EV ranking (D6).

**P1-6. Absentee fix.** Compare house number plus first street token, with directionals and suffixes stripped. A lead is absentee only if the city or zip differs, or the house number differs by more than 2 ("1/2" two-flats count as the same).

### P2: cleanup and cost

- **Railway image (D7):** `engines >=22`, poppler via nixpacks aptPkgs, and `pdftotext` resolved from `PDFTOTEXT` or PATH. An empty McHenry list reports `ok`. After deploy, `recorder-lake` + `kane-sheriff` report ok with a count above 0.
- **Remove dead triggers** from the Vince profile: `chicago-violations` (0 in scope), `craigslist-fsbo`, `recorder-dupage`.
- **Cadence:** default `VINCE_INTERVAL_MIN=60`, plus a forced pass starting at DIGEST_HOUR minus 20 minutes, so the pick comes from a pool less than 25 minutes old.
- **recorder-cook:** raise `MAX_PAGES` to 25, since the pool is truncated at exactly 750 today.
- **Copy:** remove all em dashes from Telegram and email strings (26 in notify.js), and fix the stale "3" / "55" comments.
- Keep unit numbers in `normAddr` unless one side has none. Prune `.cache` (80k files).

## 5. How we'll know it worked

1. **Backtest (before deploy).** Run the new picker over all 53 archived days:
   - 0 dead, past-sale or out-of-radius picks
   - 0 entity owners
   - 0 unknown gaps
   - every pick's gap backed by a judgment or bid, or by anchor-agreeing comps
   - Brady reads the 53 picks next to what was actually sent and agrees they are better.
2. **Dry-run on the live pool** prints the pick plus its EV reasoning. Brady sanity-checks today's winner.
3. **First 7 live days:** exactly 1 send per day at 10:00 Chicago, no repeats, and a snapshot on the volume every day.
4. **First 30 days:** at least 20 outcomes labeled through the follow-up. Answer rate and meeting rate get compared against the old 5-a-day baseline, which is unknown because only 1 tap was ever logged. That is exactly why P1-4 matters.

## 6. Order of operations for the implementing session

1. Pull `/app/data` archives + `/data/.vince-state.json` from Railway to local `data/prod-archives/`.
2. P0-1 harness, then run the **current** picker in the backtest (the baseline).
3. P0-2 → P0-6. Re-run the backtest after each step and compare the picks.
4. Show Brady the backtest table + today's dry-run pick. **Wait for his go.**
5. Delete the Railway var `VINCE_DAILY_COUNT` (per D-section approval), `railway up`, and confirm the next pass logs `daily pick: 1` and a healthy pool.
6. P1, then P2, each as its own unit: backtest, dry-run, deploy, and one push.
7. Update memory `project_vince_distressed_tracker.md` + `project_vince_one_a_day_state.md` and the Vince section of CLAUDE.md, in the same commit as the code.
