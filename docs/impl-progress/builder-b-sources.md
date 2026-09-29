# Builder B (sources) progress

Owns: src/collectors/dupage-sheriff.js, src/collectors/probate-pni.js, test/collectors-*.test.js.

- [start 2026-09-28] Read spec, CONTRACT, index.js, will-sheriff, intercounty, probate-dailyherald, public-notice-il.
- [done] src/collectors/dupage-sheriff.js: live run status ok, 85 sales from 86 feed rows (1 verbatim duplicate dropped). 132 South Linden Ave Elmhurst (24 FC 514, sale 2026-10-01) and 204 Clinton Avenue Elmhurst (26 FC 65, sale 2026-11-17) present.
- [done] src/collectors/probate-pni.js + src/collectors/probate-pni-search.js (search mechanics split out to stay under 300 lines). Offline parse of a live 45d "claims notice" pull (301 notices): 120 unique estates, DuPage 84 notices (47 with address) = 25 unique estates (12 with the decedent's street + city).
- [done] tests: test/collectors-dupage-sheriff.test.js (9) + test/collectors-probate-pni.test.js (12), fixture test/fixtures/dupage-sheriff-feed.json (11 live rows). `node --test test/collectors-*.test.js` passes 21/21 on Node 20.20.2 (npx node@20.20.2) and local Node 26.
- [done] live verify on Node 20.20.2: dupage-sheriff ok 85 (Elmhurst: 132 South Linden Ave 10-01, 204 Clinton Avenue 11-17); probate-pni ok, 120 estates from 301 notices, 25 DuPage estates (84 notices), 12 with address (47 notices), about 4 s per pass. Simulated fetch failure: both return status blocked with 0 leads; probate-pni after a good pass returns status partial with the cached estates.
- [done] corroborate check: 85 sheriff + 22 archived Intercounty DuPage rows merge to 86 leads, 20 cross-confirmed on case#. All 85 sheriff sales are within 18.7 mi of Elmhurst (43 within 10 mi).

## WIRING.md (edits for the integrator; Builder B touched no existing file)

New files: src/collectors/dupage-sheriff.js, src/collectors/probate-pni.js,
src/collectors/probate-pni-search.js (PNI session mechanics, split out to keep probate-pni.js
under 300 lines; it is a helper, NOT a trigger id), test/collectors-dupage-sheriff.test.js,
test/collectors-probate-pni.test.js, test/fixtures/dupage-sheriff-feed.json.

1. src/profile.js, `vince.triggers`: remove "probate-dailyherald", "chicago-violations",
   "craigslist-fsbo", "recorder-dupage"; add "dupage-sheriff" and "probate-pni". Result:
   ```js
   triggers: [
     "dupage-sheriff", // DuPage sheriff sales (free OCV JSON feed), Vince's home county
     "probate-pni", // probate claims notices via Public Notice IL (replaces Daily Herald)
     "tjsc",
     "intercounty",
     "public-notice-il",
     "recorder-lake",
     "recorder-will",
     "recorder-cook",
     "lake-sheriff",
     "will-sheriff",
     "kane-sheriff",
     "mchenry-sheriff",
   ],
   ```
   Do NOT add either id to `TRIGGER_IDS` in collectors/index.js (that is Z's default set; Z stays unchanged).

2. src/collectors/index.js:
   - `TIMEOUTS`: add `"dupage-sheriff": 60000,` (one GET, fetchText 30s timeout + retries) and
     `"probate-pni": 90000,` (about 9 requests, measured 3 to 6 s per pass; room for a slow day).
   - `TRIG_TTL`: add `"dupage-sheriff": 60 * 60e3,` (spec P1-2: TTL 1h) and
     `"probate-pni": 3 * 3600e3,` (claims notices publish daily; same politeness as public-notice-il).
   - Keep the existing probate-dailyherald / chicago-violations / craigslist-fsbo / recorder-dupage
     TTL and TIMEOUTS entries: Z's default TRIGGER_IDS still runs the first three.

3. src/collectors/public-notice-il.js CASE_FIX fix ("Du Page", "Mc Henry", "St Clair" normalize):
   ```js
   const fixCounty = (c) => {
     if (!c) return null;
     const t = titleCase(c).replace(/\s+/g, " ").trim();
     return CASE_FIX[t.replace(/[\s.]/g, "")] || CASE_FIX[t] || t;
   };
   ```
   Optional, for the "(unknown)" rows: import `parseCounty` from "./probate-pni.js" and use
   `county: f.county || parseCounty(snip) || "(unknown)"` in parseResults (it handles
   "COUNTY OF DU PAGE" and glued "DU PAGEIN THE" text, all 102 IL counties from il-geo.json).

4. src/match.js `SRC_LABEL` (cosmetic, for card/source text): add
   `"dupage-sheriff": "DuPage County Sheriff",` and `"probate-pni": "Public Notice IL (probate)",`.

5. Cancellation signal (spec P1-2, optional now): dupage-sheriff exports
   `vanishedCases(prev, leads, todayChicago)`. After runAll in vince-track, keep
   `state.dupageCases = leads.filter(l => l._src === "dupage-sheriff" || (l.sources||[]).includes("dupage-sheriff")).map(l => ({caseNumber: l.caseNumber, sale: l.sale}))`
   and, for each case returned by `vanishedCases(state.dupageCases_prev, sheriffLeads, chicagoToday())`,
   treat any pool lead with that case# as status "Cancelled (left the DuPage sheriff list)" so the
   pick.js dead-status gate drops it. Only do this when the collector status is "ok" (a blocked
   pass returns 0 leads and would flag everything).

6. package.json (optional): `"test": "node --test test/*.test.js"` (a bare directory arg fails on Node 21+).

Notes for A1 (pick.js / value), not edits:
- dupage-sheriff leads: stage is NOT hardcoded (derived from sale like will/lake sheriff);
  `openingBid` is a TRUE pre-sale opening bid (only 1 of 85 today), usable as payoff; there is no
  judgment amount in the feed. `defendant` holds the raw caption (e.g. "BURLACH EDWARD E DECEASED
  UNKNOWN HEIRS AND OR LEGATEES OF"), `owner` keeps "DECEASED" so the estate regex fires.
  Entity/land-trust owners appear (CONTINUUM INVESTMENT GROUP LLC, CHICAGO TITLE LAND TRUST CO,
  FIRST MIDWEST BANK); the entity gate must drop them.
- probate-pni leads: `signal/distress/stage = "probate"`, `sale/openingBid/judgment/filing = null`,
  `owner = "ESTATE OF <DECEDENT>"`, `decedent`, `heirName` (rare in the truncated snippet),
  `published` = FIRST publication date (a newspaper date, never use it for freshness),
  `notices` = how many times it was published. caseNumber is "YYYYPR000566" (Cook: "2024P008117").
  Only 12 of 25 DuPage estates carry a street address; address-less estates must be gated out
  (missing address) until a decedent-name to PIN lookup exists. They need the P1-3 probate
  qualifying path (no debt figure), otherwise the gap gate drops every one.
