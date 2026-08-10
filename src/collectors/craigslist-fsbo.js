// FSBO (for-sale-by-owner) — Vince: "a lot of money sleeping with people who don't
// know what their house is worth." Craigslist 'real estate - by owner' (reo) is the
// highest-volume free FSBO source, hyperlocal to the metro counties, and the asking
// price IS "the cost" side of the deal. Craigslist now WAF-blocks plain fetch (hard
// 403), so — like the people-search path — this runs a real headed browser on a
// residential IP. Best-effort: WAF-walled → status 'blocked', never breaks the run.
import { launchPersistentPage } from "../browser.js";
import { homedir } from "node:os";
import path from "node:path";

export const meta = {
  id: "craigslist-fsbo",
  label: "Craigslist — for-sale-by-owner (asking price)",
  source: "craigslist.org",
  kind: "trigger",
  counties: ["Cook", "DuPage", "Lake", "Will", "Kane", "McHenry", "Winnebago"],
  method: "playwright",
};

const PROFILE_DIR = path.join(homedir(), ".vince-people-search-profile");
// CL subdomains → the county each mostly covers (best-effort; refined by city later)
const REGIONS = [
  ["https://chicago.craigslist.org/search/wcl/reo", "DuPage"], // west chicagoland
  ["https://chicago.craigslist.org/search/nwc/reo", "McHenry"], // northwest
  ["https://chicago.craigslist.org/search/nch/reo", "Lake"], // north
  ["https://chicago.craigslist.org/search/sox/reo", "Cook"], // south
  ["https://rockford.craigslist.org/search/reo", "Winnebago"],
];
const MAX_PER_REGION = Number(process.env.FSBO_MAX_PER_REGION || 40);

const price = (s) => {
  const n = Number(String(s || "").replace(/[^0-9]/g, ""));
  return n >= 10000 && n < 5_000_000 ? n : null; // sane home-price band
};

export async function collect() {
  const launched = await launchPersistentPage(PROFILE_DIR);
  if (!launched)
    return { status: "blocked", note: "Playwright unavailable", leads: [] };
  const { ctx, page } = launched;
  const leads = [];
  let walled = 0;
  try {
    for (const [url, county] of REGIONS) {
      try {
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 35000 });
        await page.waitForTimeout(3500);
        const blocked = await page
          .evaluate(() =>
            /blocked|are you a human|unusual activity/i.test(
              document.body?.innerText || "",
            ),
          )
          .catch(() => true);
        if (blocked) {
          walled++;
          continue;
        }
        const rows = await page.evaluate(() => {
          const out = [];
          // CL gallery cards — parse defensively across markup versions
          const cards = document.querySelectorAll(
            "li.cl-search-result, li.result-row, .cl-static-search-result",
          );
          for (const c of cards) {
            const a = c.querySelector(
              "a.cl-app-anchor, a.result-title, a[href*='/reo/'], a[href*='.html']",
            );
            const p = c.querySelector(".priceinfo, .result-price, .price");
            const loc = c.querySelector(".meta, .result-hood, .location");
            if (!a) continue;
            out.push({
              title: (a.textContent || "").trim().slice(0, 120),
              url: a.href,
              price: p ? p.textContent.trim() : "",
              hood: loc ? loc.textContent.replace(/[()]/g, "").trim() : "",
            });
          }
          return out;
        });
        for (const r of rows.slice(0, MAX_PER_REGION)) {
          const asking = price(r.price);
          leads.push({
            county,
            address: null, // CL rarely lists street on the card; body sometimes has it
            city: r.hood || null,
            owner: null,
            signal: "fsbo",
            stage: "fsbo",
            askingPrice: asking,
            openingBid: asking, // feeds the "cost" side of the value gap
            title: r.title,
            sourceUrl: r.url,
          });
        }
      } catch {
        continue;
      }
      await page.waitForTimeout(2500 + Math.floor(MAX_PER_REGION % 900));
    }
  } finally {
    await ctx.close().catch(() => {});
  }
  if (!leads.length && walled)
    return {
      status: "blocked",
      note: `Craigslist WAF-walled ${walled} region(s) — needs a warmed residential browser`,
      leads: [],
    };
  return {
    status: "ok",
    note: `${leads.length} FSBO listings across ${REGIONS.length} regions`,
    leads,
  };
}
