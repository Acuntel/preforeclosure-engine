# A1 ranking brain: progress log

Owner: builder A1. Files: src/pick.js (+ pick-* helpers), src/value-math.js (new), src/owner.js (new),
src/score.js, src/value.js, src/quality.js, src/profile.js, src/proximity.js, src/match.js, test/*.

- [start] Read spec, audit, proto, archives. Archive leads keep only 5 stored comps (compsCount = full count),
  so pick.js estimates distinct comp events for archived leads and uses `compsDistinct` when value.js sets it.
- [done] src/value-math.js (new, pure): assessor anchor (Cook AV x10, collar x3, DuPage prefers fcvTotal),
  distinct comp events (>=5), 0.55x-1.8x band, $/sqft when comps carry sqft, payoff order
  judgment x1.1 > true opening bid (ignored when any status is a completed sale) > mortgage > asking >
  last sale >=2008 x0.9 guess (and >=35% of market), confidence high/medium/low/suspect.
- [done] src/value.js: MyDec rows filtered (multi-parcel, additional PINs, 10b related, 10c partial, 10e in-lieu,
  current use B/D, condo vs house), Cook sales filtered (multisale, parcels, sale filters, class 2xx),
  dedupe on price+date, compsDistinct set, applyValuation() writes estMarket/estDebt/estEquity/valueBasis
  (estMarketComps only when comps trusted). valueGap() legacy shape kept.
- [done] src/score.js: chicagoDate/chicagoToday, daysTo on Chicago calendar dates, Cook x10 in estMarketFrom,
  judgmentAmount set in finalize, isAbsentee() (P1-6) used only under PROFILE=vince (Z unchanged).
- [done] src/proximity.js: RADIUS_MI default 30, locationPrecision(), proxFactor().
- [done] src/profile.js: inScope radius for every county under Vince (county-centroid-only leads kept for
  enrichment; pick gates them). Chicago proper excluded (Chicago Heights / Chicago Ridge no longer caught).
- [done] src/match.js: normAddrUnit() (unit kept), mergeGroup keeps `statuses` from every merged source.
- [done] src/owner.js (new): ESTATE_RE, isEstate, effectiveOwner (estate in lender swaps in), ownerClass.
- [done] src/alias.js (new): aliasKeys, expandLegacyKey, outcomeAliasKeys, buildSentSet, isSentIn.
- [done] src/pick-eval.js + pick-copy.js + pick-health.js + pick.js: gates, EV, probate path, reasons,
  pool health, pickDaily, noDealMessage. Added gate `weak_value` (spec section 5: every pick's gap backed
  by judgment/bid or anchor-agreeing comps; probate path exempt).
- [done] src/quality.js: estate captions count as probate distress; qualityRaw uncapped; tiers unchanged.
- NOTE for A2: sentkeys.js compares aliasKeys against raw state.sentKeys. Old keys like
  "Cook::2025 CH 01328" only match a lead whose raw caseNumber is formatted the same. pick.js exports
  buildSentSet(state) / expandLegacyKey(k), which add normalized C:/D:/P:/A:/AC: forms of every old key
  plus outcome address aliases; using it closes format-variant repeats.
- [done] owner.js folds caption boilerplate ("UNKNOWN OWNERS AND NON-RECORD CLAIMANTS", "et. al.",
  HUD's full name) before splitting parties, so "ACME LLC; UNKNOWN OWNERS..." reads as entity.
- [done] Tests: test/pick-gates.test.js + test/pick-rank.test.js (27 total, shared fixture test/fixtures/pick-lead.js),
  test/value.test.js + test/keys.test.js (16), test/pick-archive.test.js (6, real archives; skips if absent). All pass on
  Node 20.20.2 (scratchpad binary). Full suite `node --test test/*.test.js`: 98/98 on Node 20.
  NOTE: `node --test test/` also executes test/fixtures/a2-crash-child.js (A2's fixture) and reports it as a failure.
- [result] 09-28 pool, next digest 2026-09-29 10:00 CT, sent = sentKeys + outcome addresses: 14 eligible,
  #1 702 Halstead Ave Romeoville (EV $185k, judgment payoff, comps agree with assessor, sale in 30 d, 19.9 mi).
  Backtest over 55 archives: every day has a pick except 09-18 and 09-23 (no-deal); health BAD on 08-18
  (intercounty blocked) and 09-19 (comps 0 percent).
