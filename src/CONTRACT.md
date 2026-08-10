# Collector contract — every county wired the same way

A **collector** is one ES module in `src/collectors/`. Two kinds: **trigger** (finds who/when is
in foreclosure) and **enrich** (fills the property record for a given address). The registry
(`src/collectors/index.js`) runs every trigger, then enriches each result by county, then scores +
dedupes. Use the shared client `src/http.js` (`fetchText`, `fetchJson`) — never raw `fetch` (we want
the UA, retry/backoff, and cache). Zero npm deps; Node ≥20; parse HTML with regex/string ops.

## Every module exports `meta`

```js
export const meta = {
  id: "judici-boone", // unique, kebab
  label: "Judici — Boone chancery",
  source: "judici.com",
  kind: "trigger", // "trigger" | "enrich"
  counties: ["Boone"], // counties this serves
  method: "http", // "http" | "playwright" (http only for now)
};
```

## Trigger collectors export `collect()`

```js
export async function collect() {
  // ...hit the real live source via fetchText/fetchJson...
  return {
    status: "ok", // "ok" | "partial" | "blocked"
    note: "12 foreclosure notices, last 60d",
    leads: [
      {
        county: "Boone",
        address: "624 Logan Ave", // street only
        city: "Belvidere",
        zip: "61008",
        owner: "Foster, Tanya", // optional
        caseNumber: "07-2026-FC-0051", // optional
        court: "17th Judicial Circuit, Boone County", // optional
        lender: "Rocket Mortgage LLC", // plaintiff, optional
        attorney: "Codilis & Associates PC", // optional
        filing: "2025-10-07", // YYYY-MM-DD, optional
        judgment: null, // YYYY-MM-DD | null
        sale: "2026-06-22", // YYYY-MM-DD | null
        openingBid: 131900, // number | null
        sourceUrl: "https://...",
      },
    ],
  };
}
```

If the source is unreachable/gated/needs a login, return `{ status:"blocked", note:"reason", leads:[] }`
— **do NOT invent data**. `status:"partial"` = got some leads but a sub-step failed.

## Enrich collectors export `enrich(lead)`

Given a lead with `{ address, city, zip, county }`, return the property fields you can find
(all optional; return `{}` if nothing). Never throw — catch and return `{}` with a logged note.

```js
export async function enrich(lead) {
  return {
    pin: "05-26-426-018",
    owner: "Foster, Tanya",
    mailing: "624 Logan Ave, Belvidere IL 61008",
    beds: 3,
    baths: 2,
    sqft: 1520,
    year: 1968,
    assessed: 47200,
    tax: 4520,
    taxYear: 2025,
    lastSaleDate: "2016-04-15",
    lastSalePrice: 139900,
  };
}
```

## Hard rules

- **Live only.** Each module must actually hit its real endpoint and return real records when run.
- **Verify before finishing**: run `node -e "import('./src/collectors/<id>.js').then(m=>m.collect?m.collect():m.enrich({address:'...',city:'...',county:'...'})).then(r=>console.log(JSON.stringify(r,null,2)))"` and confirm ≥1 real record (or an honest `blocked`).
- **Free public sources only** for `http`. ILFLS / ProBidder = do not scrape (return `blocked`).
- Reference proven adapters in `~/Desktop/property-intel/src/county/{dupage,cook}.ts` (ArcGIS + Socrata) and `~/Desktop/distressed-scraper/*.py` (Will treasurer Wildfire API, lis-pendens).
- Keep each file < 300 lines.
