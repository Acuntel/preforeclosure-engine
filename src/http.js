// Shared HTTP client for all collectors: browser-like UA, retry/backoff on
// 403/429/503, on-disk cache keyed by full URL+body, AbortController timeout.
// Zero dependencies (Node >=20 global fetch). Ported from property-intel/src/http.ts.
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync, statSync } from "node:fs";
import path from "node:path";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const CACHE_DIR = path.join(process.cwd(), ".cache");
const DEFAULT_TIMEOUT = 25_000;
// cached responses older than this are re-fetched (keeps a frequent refresh
// FRESH while still de-duping repeat hits within a window). Per-call `ttl` wins.
const DEFAULT_TTL = Number(process.env.CACHE_TTL_MS || 8 * 60 * 1000);

function cacheKey(url, init) {
  const h = createHash("sha1")
    .update(url + "::" + (init?.body || ""))
    .digest("hex")
    .slice(0, 16);
  const slug = url.replace(/[^a-z0-9]+/gi, "_").slice(0, 80);
  return path.join(CACHE_DIR, `${slug}_${h}.txt`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Fetch text with retry + cache.
 * @param {string} url
 * @param {{method?,headers?,body?,cache?:boolean,retries?:number,timeout?:number}} opts
 */
export async function fetchText(url, opts = {}) {
  const {
    cache = true,
    retries = 3,
    timeout = DEFAULT_TIMEOUT,
    ttl = DEFAULT_TTL,
  } = opts;
  const init = {
    method: opts.method || "GET",
    headers: { "User-Agent": UA, Accept: "*/*", ...(opts.headers || {}) },
    body: opts.body,
  };
  const key = cacheKey(url, init);
  if (cache && existsSync(key)) {
    try {
      if (Date.now() - statSync(key).mtimeMs < ttl)
        return await readFile(key, "utf8");
    } catch {}
  }
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), timeout);
    try {
      const res = await fetch(url, { ...init, signal: ac.signal });
      clearTimeout(t);
      if ([403, 429, 503].includes(res.status) && attempt < retries) {
        await sleep(600 * 2 ** attempt);
        continue;
      }
      const text = await res.text();
      if (!res.ok)
        throw new Error(
          `HTTP ${res.status} for ${url} (${text.slice(0, 120)})`,
        );
      if (cache) {
        await mkdir(CACHE_DIR, { recursive: true });
        await writeFile(key, text);
      }
      return text;
    } catch (e) {
      clearTimeout(t);
      lastErr = e;
      if (attempt < retries) await sleep(600 * 2 ** attempt);
    }
  }
  throw lastErr;
}

export async function fetchJson(url, opts = {}) {
  const txt = await fetchText(url, {
    ...opts,
    headers: {
      Accept: "application/json, text/plain, */*",
      ...(opts.headers || {}),
    },
  });
  // strip JSON-hijacking guards like )]}', or {}&&
  return JSON.parse(txt.replace(/^[)\]}'&\s]*\n/, "").replace(/^\{\}&&/, ""));
}

export const USER_AGENT = UA;
