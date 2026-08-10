// FREE owner phone + email via reverse-ADDRESS lookup on a public people-search
// site (FastPeopleSearch). We already have the property address from the trigger;
// searching it returns the current resident(s) + their phone numbers + sometimes
// an email — no API, no cost. This is the "multi-level scraper" Vince described.
//
// Reality check (why it runs on Brady's Mac, not a headless server): these sites
// Cloudflare-wall headless browsers. A real, windowed Chrome on a residential IP
// (a warmed persistent profile) usually passes; occasionally it shows a one-click
// challenge. So this runs HEADED by default (PEOPLE_SEARCH_HEADLESS=1 to force
// headless). It's best-effort: when it can't clear the wall we still hand Vince a
// clean address + owner name, which is all his Forewarn app needs to get the phone.
import { homedir } from "node:os";
import path from "node:path";
import { launchPersistentPage } from "../browser.js";

const PROFILE_DIR = path.join(homedir(), ".vince-people-search-profile");
const CF_WAIT_MS = Number(process.env.PEOPLE_SEARCH_CF_WAIT_MS || 20000);

const slug = (s) =>
  String(s || "")
    .toLowerCase()
    .replace(/[.,#]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

function addressUrl(lead) {
  const street = slug(lead.address);
  const city = slug(lead.city || "");
  const st = "il";
  if (!street || !city) return null;
  const zip = String(lead.zip || "").trim();
  return `https://www.fastpeoplesearch.com/address/${street}_${city}-${st}${zip ? "-" + zip : ""}`;
}

// wait out Cloudflare's "Just a moment…" interstitial (auto-clears, or a human
// clicks once when headed). Resolves true if we got past it.
async function passInterstitial(page) {
  const deadline = Date.now() + CF_WAIT_MS;
  while (Date.now() < deadline) {
    const walled = await page
      .evaluate(() =>
        /just a moment|checking your browser|attention required|enable javascript and cookies/i.test(
          (document.title || "") +
            (document.body?.innerText?.slice(0, 200) || ""),
        ),
      )
      .catch(() => false);
    if (!walled) return true;
    await page.waitForTimeout(1500);
  }
  return false;
}

function parseContacts(text) {
  const phones = [
    ...new Set(
      (text.match(/\(?\d{3}\)?[ .-]?\d{3}[ .-]?\d{4}/g) || []).map((p) =>
        p.replace(/[^\d]/g, ""),
      ),
    ),
  ]
    .filter((d) => d.length === 10)
    .slice(0, 5);
  const emails = [
    ...new Set(
      text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) || [],
    ),
  ]
    .filter((e) => !/example|sentry|\.png|\.jpg/i.test(e))
    .slice(0, 3);
  return { phones, emails };
}

async function lookupOne(page, lead) {
  const url = addressUrl(lead);
  if (!url) return { status: "skip", reason: "no address" };
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 40000 });
  } catch {
    return { status: "error", reason: "nav failed" };
  }
  const cleared = await passInterstitial(page);
  if (process.env.PEOPLE_SEARCH_DEBUG === "1")
    await page
      .screenshot({
        path: `people-search-debug-${Date.now()}.png`,
        fullPage: true,
      })
      .catch(() => {});
  if (!cleared) return { status: "walled", url };

  // address page: current resident name(s); phones sometimes inline, sometimes on
  // the person detail page — follow the first "view details" link if needed.
  let text = await page.evaluate(() => document.body?.innerText || "");
  let { phones, emails } = parseContacts(text);
  const resident = await page
    .evaluate(() => {
      const el = document.querySelector(
        'a[href*="/name/"], .card .name, h2, h3',
      );
      return el ? el.innerText.trim() : "";
    })
    .catch(() => "");

  if (!phones.length) {
    const link = await page
      .evaluate(() => {
        const a = document.querySelector('a[href*="/name/"]');
        return a ? a.getAttribute("href") : null;
      })
      .catch(() => null);
    if (link) {
      try {
        await page.goto(
          new URL(link, "https://www.fastpeoplesearch.com").href,
          {
            waitUntil: "domcontentloaded",
            timeout: 40000,
          },
        );
        await passInterstitial(page);
        text = await page.evaluate(() => document.body?.innerText || "");
        ({ phones, emails } = parseContacts(text));
      } catch {}
    }
  }

  const out = {};
  if (resident && /[a-z]/i.test(resident) && resident.length < 60)
    out.residentName = resident;
  if (phones.length) {
    out.phones = phones.map(
      (d) => `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`,
    );
    out.phone = out.phones[0];
  }
  if (emails.length) out.email = emails[0];
  return { status: phones.length ? "ok" : "no-contact", fields: out };
}

// Enrich a batch of leads (the value-gap shortlist) with phone/email in ONE
// browser session. Mutates each lead. Returns { hit, walled, total }.
export async function enrichPhones(leads, onLog = () => {}) {
  if (!leads.length) return { hit: 0, walled: 0, total: 0 };
  const launched = await launchPersistentPage(PROFILE_DIR);
  if (!launched) {
    onLog("people-search: Playwright unavailable — skipped");
    return { hit: 0, walled: 0, total: 0, unavailable: true };
  }
  const { ctx, page } = launched;
  let hit = 0,
    walled = 0;
  try {
    for (const lead of leads) {
      const r = await lookupOne(page, lead);
      if (r.status === "ok" && r.fields) {
        Object.assign(lead, r.fields);
        // a resident name from the current occupant is useful when the record
        // owner is stale (e.g. a deceased owner / heirs), but don't clobber a
        // known owner — keep it as `occupant`.
        if (r.fields.residentName) {
          if (!lead.owner) lead.owner = r.fields.residentName;
          else lead.occupant = r.fields.residentName;
        }
        lead.contactSource = "fastpeoplesearch";
        hit++;
      } else if (r.status === "walled") walled++;
      await page.waitForTimeout(1200 + Math.floor((lead.id || 0) % 800)); // vary pacing
    }
  } finally {
    await ctx.close().catch(() => {});
  }
  onLog(`people-search: ${hit}/${leads.length} got a phone (${walled} walled)`);
  return { hit, walled, total: leads.length };
}
