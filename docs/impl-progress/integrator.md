# Integrator progress (2026-09-28)

- [done] Wiring B: profile.js vince triggers (+dupage-sheriff, +probate-pni; -probate-dailyherald,
  -chicago-violations, -craigslist-fsbo, -recorder-dupage); index.js TIMEOUTS + TRIG_TTL for both;
  public-notice-il.js fixCounty (B's snippet still missed "Du Page": squashed "DuPage" != key "Dupage";
  now title-cases the squashed form); recorder-cook MAX_PAGES 25; match.js SRC_LABEL entries.
- [done] vince profile skiptrace:false (D6 no phone lookups; it launched headed FastPeopleSearch).
- [done] A2 x A1: digest/dry-run/backtest load real src/pick.js. VINCE_PICK_MODULE now honored only with
  VINCE_TEST=1 (dryrun.test sets it). Dry-run sent set now uses sentSetFor() (legacy keys expanded +
  outcome aliases) exactly like the digest; before it used raw sentKeys only.
- [done] New test/digest-real-pick.test.js: real pick.js through real digest + fake Telegram (3 days:
  pick, next pick, no-deal; entity gated; no dashes).
- [done] P1-2 cancellation signal wired: src/dupage-cancel.js (state.dupageCases / dupageCancelled,
  healthy-feed-only, >=50% of prior list), called in vince-track pass() (saved) and dry-run (memory only).
  test/dupage-cancel.test.js 3/3.
- [done] tests: Node 20.20.2 `node --test test/*.test.js` 102/102; node --check on 53 changed files OK; no Node>20 APIs
  found by grep; all 12 vince triggers import on Node 20. package.json "test" script added.
- [done] backtest-pick.js gained section-5 checks (dead status, entity owner, gap backing). Output in
  docs/backtest-2026-09-28.txt: 55 days, 55 picks, 0 no-deal, 2 degraded (08-18 intercounty blocked,
  09-19 comps 0%), all checks 0. 25/55 picks use last-sale x0.9 guessed payoff (low conf, comps agree
  with assessor), 28 judgment, 1 opening bid, 1 judgment/assessor. 18 picks flagged * (prod sent earlier).
- [finding+fix] recorder-cook "truncated at 750" was not MAX_PAGES (only 8 pages came back). Probed CRS:
  the server caps a search at 1000 rows (75d single window = exactly 1000; 14d chunks = 1612). The 45d
  pool is really ~750 today. Added date chunking (COOK_LP_CHUNK_DAYS=14, same 46-day inclusive span;
  live probe = 750, identical to before) + cap warning in the note; recorder-cook TIMEOUT 120s -> 240s.
- [done] CLAUDE.md Vince section rewritten (one-a-day picker, 30 mi, no phones, triggers), no dashes added.
- [running] live dry-run started 16:50 on Node 20 with send-guard preload (blocks+logs telegram/smtp/mail).
- [done] live dry-run (docs/dryrun-2026-09-28.txt): state copy mtime+sha unchanged, 0 blocked send attempts
  (guard preload), no telegram/smtp host contacted. Pool 1979, 9 eligible, health DEGRADED: MyDec
  (data.illinois.gov) DNS SERVFAIL (also via 8.8.8.8) -> comps 25%. Pick = probate estimate (347 Galway Ct).
- [fix] enrich-dupage county-wide fallback took the wrong parcel (610 Catalpa Wood Dale -> 610 N Catalpa
  Itasca). Fallback now requires PROPZIP match (or a single candidate).
- [fix] probate path requires county tax-bill owner (new lead.taxOwner from enrichment) to carry the
  decedent's surname; new gate estate_not_owner with plain copy. Test added. pickreport "runway noned" fixed.
- [done] final live dry-run rerun (final code, MyDec back): pool 2011, 41 eligible, health ok, pick 8645 Cashel Ln
  Tinley Park (judgment, high conf, EV $221k, 10d runway, 23.7 mi, estate). State copy sha/mtime unchanged, 0 blocked
  send attempts, git status unchanged by the run. docs/dryrun-2026-09-28.txt rewritten with final output.
- [done] backtest rerun on final code: identical; appended history-aware variant (55 picks, 0 no-deal).
- [status] integrator complete. Nothing committed/pushed/deployed; Railway untouched.
