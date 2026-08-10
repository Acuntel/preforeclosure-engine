// Lazy Playwright launcher, isolated so the core engine stays zero-dep. Only the
// gated DuPage recorder collector needs a real browser (NoBot JS challenge). We
// resolve Playwright from wherever it exists on this machine — the project's own
// install, a sibling project's node_modules, or the global cache — and return a
// launched Chromium, or null if none is available (collector then reports blocked).
import { createRequire } from "node:module";
import { homedir } from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);

const CANDIDATES = [
  "playwright",
  "playwright-core",
  // sibling project that already ships Playwright + a cached Chromium
  path.join(
    homedir(),
    "Desktop",
    "il-association-leads",
    "node_modules",
    "playwright",
  ),
];

function resolveChromium() {
  for (const c of CANDIDATES) {
    try {
      const mod = require(c);
      if (mod?.chromium) return mod.chromium;
    } catch {}
  }
  return null;
}

// Anti-automation init: strip the obvious headless/Playwright fingerprints so
// Cloudflare's passive check is less likely to wall us. Not a silver bullet —
// residential IP + a warmed real profile matter more — but it clears the easy checks.
const STEALTH = () => {
  Object.defineProperty(navigator, "webdriver", { get: () => undefined });
  Object.defineProperty(navigator, "languages", { get: () => ["en-US", "en"] });
  Object.defineProperty(navigator, "plugins", { get: () => [1, 2, 3, 4, 5] });
  window.chrome = { runtime: {} };
};

export const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0 Safari/537.36";

// Launch a headless Chromium + a fresh page. Returns { browser, page } or null.
export async function launchPage() {
  const chromium = resolveChromium();
  if (!chromium) return null;
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    userAgent: UA,
    viewport: { width: 1400, height: 1100 },
  });
  const page = await ctx.newPage();
  return { browser, page };
}

// Persistent-profile context for Cloudflare-gated sites (free people-search).
// Reuses a real on-disk profile (cookies/clearance persist between runs) and
// defaults to HEADED — the free people-search sites wall headless browsers, but a
// real windowed Chrome on a residential IP usually passes. Set PEOPLE_SEARCH_HEADLESS=1
// to force headless (works on a residential IP but will hit walls more often).
// Returns { ctx, page } or null. Caller closes ctx.
export async function launchPersistentPage(profileDir) {
  const chromium = resolveChromium();
  if (!chromium) return null;
  const headless = process.env.PEOPLE_SEARCH_HEADLESS === "1";
  const ctx = await chromium.launchPersistentContext(profileDir, {
    headless,
    userAgent: UA,
    viewport: { width: 1360, height: 900 },
    locale: "en-US",
    args: ["--disable-blink-features=AutomationControlled"],
    extraHTTPHeaders: {
      "Accept-Language": "en-US,en;q=0.9",
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    },
  });
  await ctx.addInitScript(STEALTH);
  const page = ctx.pages()[0] || (await ctx.newPage());
  return { ctx, page };
}
