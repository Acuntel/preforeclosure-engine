// Standalone full scrape — runs every collector with NO cap, writes the result
// to demo/leads.json (+ a dated archive), and prints a summary. Used by the
// daily auto-run (launchd / cron) and `npm run scrape`.
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { runAll } from "./collectors/index.js";
import { PROFILE } from "./profile.js";

const ROOT = process.cwd();
const t0 = Date.now();
console.log(`data set: ${PROFILE.label}`);

console.log(`[${new Date().toISOString()}] full scrape starting…`);
const result = await runAll(
  (e) => {
    if (e.phase === "trigger" && e.state === "done" && e.source)
      console.log(
        `  ✓ ${e.source.label} — ${e.source.count} (${e.source.status})`,
      );
    if (e.phase === "enrich" && e.done % 25 === 0)
      console.log(`  … enriched ${e.done}/${e.total}`);
  },
  { max: Infinity },
);

await writeFile(
  path.join(ROOT, "demo", "leads.json"),
  JSON.stringify(result, null, 2),
);
// dated archive so you keep a daily history
const stamp = new Date().toISOString().slice(0, 10);
await mkdir(path.join(ROOT, "data"), { recursive: true }).catch(() => {});
await writeFile(
  path.join(ROOT, "data", `leads-${stamp}.json`),
  JSON.stringify(result, null, 2),
).catch(() => {});

const byC = {};
for (const l of result.leads) byC[l.county] = (byC[l.county] || 0) + 1;
console.log(
  `[${new Date().toISOString()}] done in ${((Date.now() - t0) / 1000).toFixed(0)}s — ` +
    `${result.leads.length} leads (${result.rawTotal} scanned) ${JSON.stringify(byC)}`,
);
process.exit(0);
