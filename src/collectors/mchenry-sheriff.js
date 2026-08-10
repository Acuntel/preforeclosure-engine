// McHenry County Sheriff — Current Foreclosure List PDF.
// The sheriff publishes ALL pending judicial-foreclosure SALES as a single
// public PDF (no login). It is a strong 2nd/3rd cross-confirm source: it carries
// the chancery Case # (e.g. "24FC469" → our canonical "24 FC 469"), the case name
// (PLAINTIFF VS DEFENDANT), the common (property) address, the sale date, and the
// judgment amount — i.e. owner + lender + caseNumber + address + sale in one row,
// which TJSC/Public Notice IL each give only partially.
//
// The PDF body is FlateDecode text (not a scanned image), so `pdftotext -layout`
// extracts the columns cleanly. We download the bytes with global fetch (the shared
// http.js client is text-only), write to .cache/, run pdftotext, and parse the
// columnar text. Rows: Type | Sale Date | Case # | Case Name | Common Address | Judgment.
// Case Name + Common Address can wrap onto continuation lines (zip, "ET AL", judgment),
// so we accumulate each FORECLOSURE row's lines until the next row / footer.
import { execFileSync } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { USER_AGENT } from "../http.js";

export const meta = {
  id: "mchenry-sheriff",
  label: "McHenry County Sheriff — current foreclosure list (PDF)",
  source: "mchenrysheriff.org",
  kind: "trigger",
  counties: ["McHenry"],
  method: "http",
};

const PDF_URL =
  "https://www.mchenrysheriff.org/wp-content/uploads/pdf-uploads/ForeclosureList.pdf";
const LANDING = "https://www.mchenrysheriff.org/community/foreclosure/";
const CACHE_DIR = path.join(process.cwd(), ".cache");
const PDF_BIN = "/opt/homebrew/bin/pdftotext";

// "06/18/2026" -> "2026-06-18"
function toIso(s) {
  const m = (s || "").match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!m) return null;
  const [, mo, d, y] = m;
  return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
}

// "$305,014.32" / "JUDGEMENT $..." -> 305014 ; "" -> null
function toMoney(s) {
  const m = (s || "").match(/\$\s*([\d,]+(?:\.\d+)?)/);
  if (!m) return null;
  const n = Math.round(Number(m[1].replace(/,/g, "")));
  return Number.isFinite(n) && n > 0 ? n : null;
}

// Split the full case-name+address blob into the named pieces.
// Layout: "<PLAINTIFF> VS <DEFENDANT...>   <STREET, CITY, IL ZIP>   <$JUDGMENT>"
// The address starts at a street number that follows the case name. We anchor on
// ", IL" + optional 5-digit zip to locate the address, everything before = case name.
function parseRow(blob) {
  let text = blob.replace(/\s+/g, " ").trim();

  // Pull a trailing judgment amount (and the "JUDGEMENT" header word) off the end.
  const judgment = toMoney(text);
  text = text
    .replace(/\bJUDGEMENT\b/gi, " ")
    .replace(/\$\s*[\d,]+(?:\.\d+)?/g, " ")
    // "ET AL" can wrap to a continuation line and land AFTER the address, so drop
    // every occurrence before we try to locate the address.
    .replace(/\bET\s+AL\.?/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  // Locate the common address: "<NUM> <STREET>, <CITY>, IL <ZIP>".
  // Take the LAST such match (the case name never contains ", IL <zip>"); the
  // address may not sit at end-of-string once "ET AL"/judgment are stripped.
  const addrRe =
    /(\d+[A-Z]?\s+[^,]+?),\s*([A-Za-z .'\-]+?),\s*IL\.?(?:\s*(\d{5})(?:-\d{4})?)?/gi;
  let am = null;
  for (const m of text.matchAll(addrRe)) am = m;

  let caseName = text;
  let address = null;
  let city = null;
  let zip = null;
  if (am) {
    address = am[1].replace(/\s+/g, " ").trim();
    city = am[2].replace(/\s+/g, " ").trim();
    zip = am[3] || null;
    caseName = text.slice(0, am.index).trim();
  }

  // Split case name into plaintiff (lender) VS defendant (owner).
  let lender = null;
  let owner = null;
  if (caseName) {
    const vs = caseName.split(/\s+VS\.?\s+/i);
    if (vs.length >= 2) {
      lender = vs[0].trim() || null;
      owner = vs
        .slice(1)
        .join(" VS ")
        .replace(/\s+ET\s+AL\.?\s*$/i, "")
        .trim();
      owner = owner || null;
    } else {
      lender = caseName.trim() || null;
    }
  }

  return { lender, owner, address, city, zip, judgment };
}

// Walk the -layout text. A data row begins with "FORECLOSURE" (the Type column).
// Everything up to the NEXT "FORECLOSURE" (or the disclaimer/footer) is one record;
// we strip the leading "FORECLOSURE  <date>  <case#>" and feed the remainder to parseRow.
function parseText(txt) {
  const lines = txt.split(/\r?\n/);
  const rows = [];
  let cur = null;
  const flush = () => {
    if (cur) rows.push(cur);
    cur = null;
  };
  const isFooter = (l) =>
    /Although every effort|Page \d+ of|Last Updated on/i.test(l);

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (isFooter(line)) {
      flush();
      continue;
    }
    if (/^\s*FORECLOSURE\b/i.test(line)) {
      flush();
      cur = { sale: null, caseNumber: null, blob: "" };
      // Type | Sale Date | Case # | <rest = case name + address + judgment...>
      const m = line.match(
        /^\s*FORECLOSURE\s+(\d{1,2}\/\d{1,2}\/\d{4})\s+([0-9]{2}\s?FC\s?[0-9]+[A-Z]?)\s*(.*)$/i,
      );
      if (m) {
        cur.sale = toIso(m[1]);
        cur.caseNumber = m[2].replace(/\s+/g, " ").trim();
        cur.blob = m[3] || "";
      } else {
        // Fallback: at least grab the date + case # if alignment is odd.
        cur.sale = toIso(line);
        const cm = line.match(/\b([0-9]{2}\s?FC\s?[0-9]+[A-Z]?)\b/i);
        cur.caseNumber = cm ? cm[1].replace(/\s+/g, " ").trim() : null;
        cur.blob = line
          .replace(/^\s*FORECLOSURE\s+\d{1,2}\/\d{1,2}\/\d{4}\s+/i, "")
          .replace(/^\s*[0-9]{2}\s?FC\s?[0-9]+[A-Z]?\s+/i, "");
      }
    } else if (cur && line.trim()) {
      cur.blob += " " + line.trim();
    }
  }
  flush();
  return rows;
}

async function downloadPdf() {
  const res = await fetch(PDF_URL, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/pdf,*/*" },
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${PDF_URL}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 200 || buf.subarray(0, 4).toString() !== "%PDF")
    throw new Error(`not a PDF (${buf.length}b)`);
  mkdirSync(CACHE_DIR, { recursive: true });
  const tmp = path.join(CACHE_DIR, "mchenry_foreclosure_list.pdf");
  writeFileSync(tmp, buf);
  return { tmp, bytes: buf.length };
}

export async function collect() {
  let tmp, bytes;
  try {
    ({ tmp, bytes } = await downloadPdf());
  } catch (e) {
    return {
      status: "blocked",
      note: `Could not download McHenry sheriff foreclosure PDF (${PDF_URL}): ${String(
        e.message || e,
      )}. Landing: ${LANDING}`,
      leads: [],
    };
  }

  let text;
  try {
    text = execFileSync(PDF_BIN, ["-layout", tmp, "-"], {
      encoding: "utf8",
      maxBuffer: 8 * 1024 * 1024,
    });
  } catch (e) {
    return {
      status: "blocked",
      note: `pdftotext failed on McHenry PDF (${bytes}b): ${String(
        e.message || e,
      )}. Need ${PDF_BIN} (-layout). Source: ${PDF_URL}`,
      leads: [],
    };
  }

  const rows = parseText(text);
  const leads = [];
  for (const r of rows) {
    const p = parseRow(r.blob);
    // A real foreclosure record needs at least a case # and an address.
    if (!r.caseNumber && !p.address) continue;
    leads.push({
      county: "McHenry",
      address: p.address,
      city: p.city,
      zip: p.zip,
      owner: p.owner || null,
      caseNumber: r.caseNumber || null,
      court:
        "Circuit Court of McHenry County, Illinois (22nd Judicial Circuit)",
      lender: p.lender || null,
      attorney: null,
      filing: null,
      judgment: p.judgment ?? null,
      sale: r.sale || null,
      openingBid: null, // sheriff list prints the judgment, not the opening bid
      sourceUrl: PDF_URL,
    });
  }

  if (!leads.length) {
    return {
      status: rows.length ? "partial" : "blocked",
      note: `Downloaded + pdftotext'd McHenry foreclosure PDF (${bytes}b) but extracted 0 sale rows from ${rows.length} candidate block(s). Columns expected: Type|Sale Date|Case #|Case Name (PLAINTIFF VS DEFENDANT)|Common Address|Judgment. Layout may have changed. Source: ${PDF_URL}`,
      leads: [],
    };
  }

  const withCase = leads.filter((l) => l.caseNumber).length;
  const withAddr = leads.filter((l) => l.address).length;
  return {
    status: "ok",
    note: `${leads.length} McHenry sheriff foreclosure sale(s) from the official Current Foreclosure List PDF (${bytes}b): ${withCase} w/ case #, ${withAddr} w/ address, owner+lender split on "VS". Judgment captured (no opening bid published). Source: ${PDF_URL}`,
    leads,
  };
}
