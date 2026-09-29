# A2 send path + harness: progress

Owner: builder A2. Files owned: src/notify.js (+ split modules), vince-track.js, src/email.js,
test-digest.js, vince-ping-now.js, scripts/backtest-pick.js, test/*.

- [start 2026-09-28] Read spec, notify.js, vince-track.js, email.js, prod state shape
  (sentKeys 314, outcomes 306, lastDigestDate 2026-09-28). src/pick.js absent at start;
  using scratchpad stub via VINCE_PICK_MODULE.
- [done] Split notify.js (648 lines) into telegram.js, cards.js, digest.js, callbacks.js,
  legacy-notify.js, vstate.js, sentkeys.js, archive.js, pickreport.js; notify.js is now a facade.
- [done] email.js: VINCE_EMAIL_OFF / VINCE_PING_OFF hard stops, EV reasons in the lead email,
  emailNotice() for no-deal + follow-up.
- [done] vince-track.js: --dry-run [--from] [--as-of], instant alerts behind VINCE_INSTANT=1,
  interval default 60, forced scan 20 min pre-digest + digest at the hour from the fresh pool,
  pool archive + picks snapshot to archiveDir().
- [done] digest.js wired to A1's real src/pick.js (buildSentSet/outcomeAliasKeys used when present).
  Dry-run on 09-28 archive (Node 20.20.2 from scratchpad): pick 702 Halstead Ave Romeoville,
  state mtime unchanged, snapshot written only to VINCE_ARCHIVE_DIR as <date>.dryrun.json.
- [done] scripts/backtest-pick.js: 55 days, 55 picks, 0 past-sale, 0 beyond 30 mi, 0 bad gap,
  0 repeats, 18 picks production had already sent earlier (flag *), 2 degraded-pool days (flag !).
- [next] tests under test/ (fake Telegram, crash child), test-digest.js, vince-ping-now.js.
- [done] Tests: test/digest.test.js, callbacks.test.js, email-off.test.js, repeats.test.js,
  dryrun.test.js + fixtures a2-fake-pick.js, a2-fake-telegram.js, a2-crash-child.js.
  Node 20.20.2: `node --test test/` 102/102 (whole dir incl. other builders). Local Node 26:
  `node --test 'test/**/*.test.js'` 98/98. Crash test kills a child after Telegram accepts the
  card; the restarted pass sends nothing. 7 audit repeats read as sent using only outcomes dated
  before each repeat (real pick.js aliasKeys/buildSentSet).
- [done] test-digest.js now prints to a fake Telegram, both off switches forced. vince-ping-now.js
  exits on VINCE_PING_OFF=1, sends welcome + today's ONE pick. contactName trims court captions.
- [status] A2 items complete. Nothing committed, nothing deployed, Railway untouched.
