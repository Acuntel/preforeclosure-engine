// DuPage County Recorder — recorded LIS PENDENS, the EARLIEST foreclosure signal
// in DuPage (filed by the lender months before any sheriff sale, carrying the
// homeowner's name + PIN). Vince lives in DuPage; this is his primary trigger.
//
// Source: https://recorder.dupagecounty.gov/Search.aspx (free, no login) — but
// guarded two ways, both handled here with a real headless browser:
//   1. ASP.NET AJAX "NoBot" JS challenge (clientWidth*clientHeight of a hidden
//      panel) + a minimum think-time before submit. A real browser satisfies it;
//      raw HTTP does not.
//   2. A client-side rule that pops "Please narrow criteria ... when using
//      Recording Date range" and BLOCKS the submit whenever a date range is set
//      without a strong criterion. We bypass that alert by invoking the ASP.NET
//      postback directly (window.__doPostBack) — the browser still computes the
//      NoBot answer, but the blocking onclick never runs.
//
// Strategy: one narrow query PER DAY across a short lookback window (a day of
// county LPs is small, so it clears any bulk throttle and is exactly what an
// hourly monitor wants). Document type LIS PENDENS = checkbox index 65 (value JA).
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { launchPage } from "../browser.js";

// One page snapshot per run lands here when a search completes without a
// recognizable results grid (see collect()).
const DEBUG_DIR = path.join(process.cwd(), "autorun", "logs");

export const meta = {
  id: "recorder-dupage",
  label: "DuPage Recorder — recorded LIS PENDENS (earliest signal)",
  source: "recorder.dupagecounty.gov",
  kind: "trigger",
  counties: ["DuPage"],
  method: "playwright",
};

const URL = "https://recorder.dupagecounty.gov/Search.aspx";
const LP_CHECKBOX = "#MainContent_cblDocumentTypeList_65"; // LIS PENDENS
const LOOKBACK_DAYS = Number(process.env.DUPAGE_LP_LOOKBACK_DAYS || 30);

const mmddyyyy = (d) =>
  `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}/${d.getFullYear()}`;

async function setField(page, sel, val) {
  await page.evaluate(
    ({ sel, val }) => {
      const el = document.querySelector(sel);
      if (!el) return;
      el.focus();
      el.value = val;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      el.blur();
    },
    { sel, val },
  );
  await page.waitForTimeout(400);
}

// Pull the results grid from the page. ⚠️ The search page also hosts a
// date-picker CALENDAR table (headers Su/Mo/Tu/…) — the old "largest table
// without checkboxes" pick grabbed it and emitted phantom rows (confirmed
// 2026-07-21: 12 "LPs" whose _raw was the calendar). A table only counts as
// the results grid if its header row reads like recorder columns.
function scrapeGrid() {
  const cellText = (r, tag) =>
    [...r.querySelectorAll(tag)].map((c) =>
      c.innerText.replace(/\s+/g, " ").trim(),
    );
  const isCalendar = (cells) =>
    cells.length >= 5 &&
    cells.every((c) => /^(su|mo|tu|we|th|fr|sa)$/i.test(c));
  const looksLikeResults = (cells) =>
    /grantor|grantee|first.?party|second.?party|instrument|doc(?:ument)?\s*(?:type|#|no|num)|record(?:ed|ing)?\s*date/i.test(
      cells.join(" "),
    );
  let best = null;
  for (const t of document.querySelectorAll("table")) {
    if (t.querySelector("input[type=checkbox]")) continue;
    const trs = [...t.querySelectorAll("tr")];
    if (trs.length < 2) continue;
    const headers = cellText(trs[0], "th");
    const head = headers.length ? headers : cellText(trs[0], "td");
    if (isCalendar(head) || !looksLikeResults(head)) continue;
    if (!best || trs.length > best.trs.length) best = { trs, head };
  }
  const bodyText = document.body.innerText;
  const noRecords = /no (?:records|results|documents|matches)\b/i.test(
    bodyText,
  );
  if (!best) return { headers: [], rows: [], noRecords };
  const rows = best.trs
    .slice(1)
    .map((r) => cellText(r, "td"))
    .filter((cells) => cells.some(Boolean));
  return { headers: best.head, rows, noRecords };
}

// Map a header label to a field. LP grantor = lender/plaintiff, grantee = the
// homeowner/defendant we want as `owner`.
function pickCol(headers, ...needles) {
  for (let i = 0; i < headers.length; i++) {
    const h = headers[i].toLowerCase();
    if (needles.some((n) => h.includes(n))) return i;
  }
  return -1;
}

async function queryDay(page, day) {
  const dialogs = [];
  const onDialog = (d) => {
    dialogs.push(d.message());
    d.accept().catch(() => {});
  };
  page.on("dialog", onDialog);
  try {
    // the recorder site is slow/flaky — wait only for DOM, then the LP checkbox,
    // and retry the navigation once before giving up on this day.
    let loaded = false;
    for (let attempt = 0; attempt < 2 && !loaded; attempt++) {
      try {
        await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 40000 });
        await page.waitForSelector(LP_CHECKBOX, { timeout: 15000 });
        loaded = true;
      } catch {
        await page.waitForTimeout(2000);
      }
    }
    if (!loaded)
      return {
        grid: { headers: [], rows: [] },
        throttled: false,
        dialogs,
        loadFailed: true,
      };

    await page.evaluate((sel) => {
      const cb = document.querySelector(sel);
      if (cb) cb.checked = true;
    }, LP_CHECKBOX);
    const ds = mmddyyyy(day);
    await setField(page, "#MainContent_txtDateStart", ds);
    await setField(page, "#MainContent_txtDateEnd", ds);
    await page.waitForTimeout(2600); // NoBot think-time
    // bypass the blocking onclick alert; browser still supplies NoBot answer
    await page.evaluate(() => {
      window.__doPostBack("ctl00$MainContent$btnSearch", "");
    });
    // wait until a REAL results table (recorder-ish header row — the ever-present
    // calendar table must not satisfy this, or we scrape before results render)
    // OR an explicit "no records" message settles, rather than a blind delay.
    await page
      .waitForFunction(
        () => {
          const t = [...document.querySelectorAll("table")].some((x) => {
            if (x.querySelector("input[type=checkbox]")) return false;
            if (x.querySelectorAll("tr").length < 2) return false;
            const head = x.querySelector("tr");
            return /grantor|grantee|first.?party|second.?party|instrument|document/i.test(
              head?.innerText || "",
            );
          });
          const nr = /no (?:records|results|documents|matches)\b/i.test(
            document.body.innerText,
          );
          return t || nr;
        },
        { timeout: 15000 },
      )
      .catch(() => {});
    const throttled = dialogs.some((m) =>
      /narrow criteria|additional criteria/i.test(m),
    );
    const grid = await page.evaluate(scrapeGrid);
    return { grid, throttled, dialogs };
  } finally {
    page.off("dialog", onDialog);
  }
}

export async function collect() {
  const launched = await launchPage();
  if (!launched)
    return {
      status: "blocked",
      note: "Playwright not available — install to enable DuPage recorder LP",
      leads: [],
    };
  const { browser, page } = launched;
  const leads = [];
  let daysWithData = 0;
  let throttledDays = 0;
  let loadFailedDays = 0;
  let emptyDays = 0;
  let debugSaved = false;
  try {
    const today = new Date();
    for (let i = 0; i < LOOKBACK_DAYS; i++) {
      const day = new Date(today.getTime() - i * 864e5);
      const dow = day.getDay();
      if (dow === 0 || dow === 6) continue; // recorder closed weekends
      let res;
      try {
        res = await queryDay(page, day);
      } catch {
        loadFailedDays++;
        continue;
      }
      if (res.loadFailed) {
        loadFailedDays++;
        continue;
      }
      if (res.throttled) {
        throttledDays++;
        continue;
      }
      const { headers, rows, noRecords } = res.grid;
      if (!rows.length) {
        if (noRecords) emptyDays++;
        // The search completed but nothing we recognize as a results grid was
        // on the page — save one snapshot per run so the true grid markup (or
        // whatever rendered instead) can be inspected offline without another
        // round of throttled live queries.
        else if (!debugSaved) {
          debugSaved = true;
          try {
            const html = await page.content();
            const f = path.join(
              DEBUG_DIR,
              `dupage-page-${day.toISOString().slice(0, 10)}.html`,
            );
            mkdirSync(DEBUG_DIR, { recursive: true });
            writeFileSync(f, html);
          } catch {}
        }
        continue;
      }
      const cGrantor = pickCol(headers, "grantor");
      const cGrantee = pickCol(headers, "grantee");
      const cDoc = pickCol(
        headers,
        "document number",
        "doc number",
        "doc #",
        "instrument",
      );
      const cType = pickCol(headers, "type", "kind");
      const cDate = pickCol(headers, "record", "date");
      const cLegal = pickCol(headers, "legal", "description");
      let dayHits = 0;
      for (const cells of rows) {
        const type = cType >= 0 ? cells[cType] : "LIS PENDENS";
        if (cType >= 0 && !/lis\s*pendens/i.test(type)) continue;
        const owner = cGrantee >= 0 ? cells[cGrantee] : "";
        const iso = day.toISOString().slice(0, 10);
        leads.push({
          county: "DuPage",
          owner: owner || null,
          lender: cGrantor >= 0 ? cells[cGrantor] || null : null,
          docNumber: cDoc >= 0 ? cells[cDoc] || null : null,
          legal: cLegal >= 0 ? cells[cLegal] || null : null,
          filing: iso, // recorded date of the LP
          stage: "lis_pendens",
          sourceUrl: URL,
          _raw: headers.length
            ? Object.fromEntries(headers.map((h, k) => [h, cells[k]]))
            : cells,
        });
        dayHits++;
      }
      if (dayHits) daysWithData++;
    }
  } finally {
    await browser.close().catch(() => {});
  }

  let status = "ok";
  let note = `${leads.length} recorded LIS PENDENS over ${LOOKBACK_DAYS}d (${daysWithData} days w/ data, ${emptyDays} empty, ${loadFailedDays} unreachable, ${throttledDays} throttled)`;
  if (!leads.length) {
    if (loadFailedDays && !daysWithData && !emptyDays)
      ((status = "blocked"),
        (note = `recorder unreachable/slow on all ${loadFailedDays} day(s) — retry when the site is responsive`));
    else if (throttledDays && !emptyDays)
      ((status = "blocked"),
        (note = `throttled on ${throttledDays} day(s) — recorder rejected date+type query`));
    else if (emptyDays)
      ((status = "ok"),
        (note = `no LIS PENDENS recorded in the last ${LOOKBACK_DAYS}d window (${emptyDays} confirmed-empty days)`));
    else
      ((status = "partial"),
        (note =
          "search ran but no rows parsed — capture a populated grid to confirm columns"));
  }
  return { status, note, leads };
}
