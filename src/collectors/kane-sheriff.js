// Kane County Sheriff — UPCOMING foreclosure sales PDF.
// Free public list the Sheriff posts at applications.kanecountyil.gov/foreclosures/
// foreclosures.pdf. It is the SECOND/THIRD independent confirm for Kane sales we
// already get from TJSC + Public Notice IL, matched by CASE NUMBER (Chancery#) and
// ADDRESS. No login, no scraping a gated site — a plain PDF download.
//
// Layout (pdftotext -layout), columns:
//   Sale Yr | Sales Date | Chancery# | Sheriff's# | Property Address + City | Judgment Amt
// e.g.  2026   6/18/2026   25FC414   26SCH087   21 S MAY ST Aurora           90,275.62
// - "Sale Yr" only prints on the first row of a year-group; otherwise blank.
// - Chancery# is the CASE NUMBER (e.g. "25FC414", sometimes "19CH676") — our #1 key.
// - Property Address + City are merged in one column; city is the trailing token(s),
//   matched against the known Kane municipality list.
// - This list carries NO plaintiff(lender)/defendant(owner) — only address+case+judgment;
//   those get filled by enrich-kane + cross-confirmed against TJSC/Public Notice IL.
import { mkdir, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";

export const meta = {
  id: "kane-sheriff",
  label: "Kane County Sheriff — upcoming foreclosure sales (PDF)",
  source: "applications.kanecountyil.gov",
  kind: "trigger",
  counties: ["Kane"],
  method: "http",
};

const URL =
  "https://applications.kanecountyil.gov/foreclosures/foreclosures.pdf";
const CACHE_DIR = path.join(process.cwd(), ".cache");
const PDFTOTEXT = "/opt/homebrew/bin/pdftotext";

// Known Kane County municipalities (longest first so multi-word names win).
const KANE_CITIES = [
  "Carpentersville",
  "Pingree Grove",
  "South Elgin",
  "North Aurora",
  "West Dundee",
  "East Dundee",
  "Sleepy Hollow",
  "Sugar Grove",
  "St Charles",
  "St. Charles",
  "Saint Charles",
  "Lake in the Hills",
  "Wayne",
  "Big Rock",
  "Maple Park",
  "Montgomery",
  "Hampshire",
  "Algonquin",
  "Hoffman Estates",
  "Gilberts",
  "Geneva",
  "Batavia",
  "Elburn",
  "Aurora",
  "Elgin",
  "Kaneville",
  "Plato Center",
  "Burlington",
  "Virgil",
  "Sycamore",
];

// "$90,275.62" / "8,293,319.67" -> 90276 / 8293320 (rounded) ; "" -> null
function money(s) {
  if (!s) return null;
  const v = String(s).replace(/[^0-9.]/g, "");
  if (!v) return null;
  const n = Math.round(parseFloat(v));
  return Number.isFinite(n) && n > 0 ? n : null;
}

// "6/18/2026" -> "2026-06-18"
function isoDate(d) {
  const m = (d || "").match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!m) return null;
  const [, mo, da, yr] = m;
  return `${yr}-${mo.padStart(2, "0")}-${da.padStart(2, "0")}`;
}

// Split a merged "1929 DIAMOND HEAD TRAIL Pingree Grove" -> {address, city}.
function splitAddrCity(blob) {
  const s = (blob || "").replace(/\s+/g, " ").trim();
  if (!s) return { address: null, city: null };
  for (const city of KANE_CITIES) {
    const re = new RegExp(
      "\\s+" + city.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$",
      "i",
    );
    if (re.test(s)) {
      const address = s.replace(re, "").trim();
      // Normalize "St." -> "St" in city for consistency; keep canonical form.
      let outCity = city.replace(/^St\.?\s+Charles$/i, "St Charles");
      outCity = outCity.replace(/^Saint Charles$/i, "St Charles");
      return { address: address || null, city: outCity };
    }
  }
  // No known city matched — fall back: last word is the city.
  const parts = s.split(" ");
  if (parts.length >= 2) {
    return {
      address: parts.slice(0, -1).join(" "),
      city: parts[parts.length - 1],
    };
  }
  return { address: s, city: null };
}

// A data row: [SaleYr?] SalesDate Chancery# Sheriff# AddressCity Judgment
// Sale Yr is optional (blank on continuation rows). We anchor on Chancery# + Sheriff#.
const ROW_RE =
  /(?:\d{4}\s+)?(\d{1,2}\/\d{1,2}\/\d{4})\s+([0-9]{2}[A-Z]{2}\d{2,4})\s+(\d{2}SCH\d{2,4})\s+(.+?)\s+([\d,]+\.\d{2})\s*$/;

export async function collect() {
  // 1) Download the PDF bytes (global fetch -> Buffer; PDFs aren't text).
  let buf;
  try {
    const res = await fetch(URL, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        Accept: "application/pdf,*/*",
      },
    });
    if (!res.ok) {
      return {
        status: "blocked",
        note: `GET ${URL} -> HTTP ${res.status}. Kane Sheriff foreclosure PDF unreachable.`,
        leads: [],
      };
    }
    buf = Buffer.from(await res.arrayBuffer());
  } catch (e) {
    return {
      status: "blocked",
      note: `GET ${URL} failed: ${String(e.message || e)} (Kane Sheriff foreclosure PDF).`,
      leads: [],
    };
  }

  if (!buf || buf.length < 1000 || buf.slice(0, 4).toString() !== "%PDF") {
    return {
      status: "blocked",
      note: `Downloaded ${buf?.length || 0}b from ${URL} but it isn't a PDF (no %PDF header). Source may be down or changed.`,
      leads: [],
    };
  }

  // 2) Run pdftotext -layout on a temp file.
  let text;
  try {
    await mkdir(CACHE_DIR, { recursive: true });
    const tmp = path.join(CACHE_DIR, `kane-foreclosures-${Date.now()}.pdf`);
    await writeFile(tmp, buf);
    text = execFileSync(PDFTOTEXT, ["-layout", tmp, "-"], {
      maxBuffer: 32 * 1024 * 1024,
    }).toString("utf8");
  } catch (e) {
    return {
      status: "blocked",
      note: `pdftotext failed on the Kane PDF: ${String(e.message || e)}. Ensure ${PDFTOTEXT} is installed.`,
      leads: [],
    };
  }

  // "AS POSTED 06/08/2026" header → freshness note.
  const posted = (text.match(/AS POSTED\s+(\d{1,2}\/\d{1,2}\/\d{4})/i) ||
    [])[1];

  // 3) Parse each data row.
  const leads = [];
  const seen = new Set();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/’/g, "'").trimEnd();
    const m = line.match(ROW_RE);
    if (!m) continue;
    const [, saleDate, chancery, sheriffNum, addrCity, judg] = m;
    const { address, city } = splitAddrCity(addrCity);
    if (!address) continue;

    const caseNumber = chancery.toUpperCase();
    const dedupe = `${caseNumber}|${address.toUpperCase()}`;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);

    leads.push({
      county: "Kane",
      address,
      city: city || null,
      zip: null,
      owner: null, // PDF lists no defendant; enrich-kane + TJSC/PNIL fill/confirm
      caseNumber, // CHANCERY# — our #1 cross-confirm key
      court: "16th Judicial Circuit, Kane County, Illinois",
      lender: null, // PDF lists no plaintiff
      attorney: null,
      filing: null,
      judgment: money(judg),
      sale: isoDate(saleDate),
      openingBid: null, // Kane PDF publishes judgment, not opening bid
      sheriffNumber: sheriffNum.toUpperCase(),
      status: "UPCOMING",
      sourceUrl: URL,
    });
  }

  if (!leads.length) {
    return {
      status: "blocked",
      note: `Fetched + converted the Kane Sheriff PDF (${buf.length}b, ${text.length} chars) but extracted 0 rows. Column layout likely changed (expected: Sale Yr | Sales Date | Chancery# | Sheriff's# | Address+City | Judgment).`,
      leads: [],
    };
  }

  const withJudg = leads.filter((l) => l.judgment != null).length;
  const note =
    `${leads.length} upcoming Kane County sheriff foreclosure sale(s) from the free public Sheriff PDF` +
    (posted ? ` (as posted ${posted})` : "") +
    `. Case# (Chancery#) + address captured on every row; ${withJudg} carry a judgment amount. ` +
    `No plaintiff/defendant on this list — enrich-kane + TJSC/Public Notice IL fill owner/lender and cross-confirm by case#.`;

  return { status: "ok", note, leads };
}
