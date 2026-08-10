// Boone County Sheriff — "Schedule of Sheriffs' Sales".
// FILLS BOONE: Judici-Boone is login-gated, so this is our primary free Boone trigger
// AND a second/third independent cross-confirm (by CASE# + ADDRESS) for sales we also
// see on TJSC + Public Notice IL.
//
// The county CMS (eRezLife/RZ) renders every sale as PLAIN TEXT inside the page body
// (<div id="post">) — no table, no PDF, no JSON feed. Each sale block is shaped:
//
//   <strong>January 3, 2023 @ 10:00 a.m.:</strong>   (date header, may say CANCELLED)
//   22FC32  First Nat'l Bank -vs- Rebecah M Allen; 13569 Harvest Way, Poplar Grove IL 61065
//
// i.e.  CASE#  PLAINTIFF -vs- DEFENDANT; STREET, CITY IL ZIP.  A date header applies to
// every case line beneath it until the next header. We parse the body with regex/string
// ops only (zero deps). caseNumber is the #1 cross-confirm key, so we capture it raw.
import { fetchText } from "../http.js";

export const meta = {
  id: "boone-sheriff",
  label: "Boone County Sheriff — Schedule of Sheriffs' Sales",
  source: "boonecountyil.gov",
  kind: "trigger",
  counties: ["Boone"],
  method: "http",
};

const URL =
  "https://www.boonecountyil.gov/government/departments/sheriff_s_office/schedule_of_sheriffs__sales.php";

const COURT = "17th Judicial Circuit, Boone County";

const MONTHS = {
  january: 1,
  february: 2,
  march: 3,
  april: 4,
  may: 5,
  june: 6,
  july: 7,
  august: 8,
  september: 9,
  october: 10,
  november: 11,
  december: 12,
};

function decode(s = "") {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;|&#x27;|&rsquo;/g, "'")
    .replace(/&quot;|&ldquo;|&rdquo;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

// "January 3, 2023 ..." -> "2023-01-03" | null
function headerIso(line) {
  const m = line.match(/([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})/);
  if (!m) return null;
  const mo = MONTHS[m[1].toLowerCase()];
  if (!mo) return null;
  return `${m[3]}-${String(mo).padStart(2, "0")}-${m[2].padStart(2, "0")}`;
}

// A header line is a date line with no case#, e.g. "January 3, 2023 @ 10:00 a.m.:"
function isHeader(line) {
  return headerIso(line) != null && !caseOf(line);
}

// First token shaped like an IL chancery/FC case number: "22FC32", "25 FC 360",
// "2025-FC-0000360", "22 CH 14". Returns the raw matched string or null.
function caseOf(line) {
  const m = line.match(
    /^\s*((?:20)?\d{2}[\s-]*(?:FC|CH|MR)[\s-]*\d+(?:-\d+)?)\b/i,
  );
  return m ? m[1].replace(/\s+/g, " ").trim() : null;
}

// "13569 Harvest Way, Poplar Grove IL 61065" -> {address, city, zip}
function parseAddress(blob) {
  let out = { address: null, city: null, zip: null };
  if (!blob) return out;
  let s = blob.trim().replace(/\.$/, "");
  const zm = s.match(/\b(\d{5})(?:-\d{4})?\s*$/);
  if (zm) {
    out.zip = zm[1];
    s = s.slice(0, zm.index).trim();
  }
  // strip trailing " IL" / ", IL" state token
  s = s.replace(/[,\s]+IL\.?\s*$/i, "").trim();
  // last comma separates street from city
  const ci = s.lastIndexOf(",");
  if (ci > -1) {
    out.address = s.slice(0, ci).trim() || null;
    out.city =
      s
        .slice(ci + 1)
        .trim()
        .replace(/[,\s]+IL\.?$/i, "") || null;
  } else {
    out.address = s || null;
  }
  if (out.city) out.city = out.city.replace(/\s+/g, " ").trim() || null;
  return out;
}

// "First Nat'l Bank -vs- Rebecah M Allen; 13569 Harvest Way, Poplar Grove IL 61065"
function parseRest(rest) {
  const out = {
    lender: null,
    owner: null,
    address: null,
    city: null,
    zip: null,
  };
  // split addr blob off the "; " that precedes the property address
  let people = rest;
  let addrBlob = null;
  const semi = rest.indexOf(";");
  if (semi > -1) {
    people = rest.slice(0, semi).trim();
    addrBlob = rest.slice(semi + 1).trim();
  } else {
    // no semicolon — try to find the address as the first street-number run
    const am = rest.match(/\b\d+\s+[A-Za-z0-9].*$/);
    if (am) {
      people = rest.slice(0, am.index).trim().replace(/;$/, "");
      addrBlob = am[0].trim();
    }
  }
  // plaintiff -vs- defendant  (accept -vs-, vs, v., versus)
  const vm = people.match(/^(.*?)\s+-?\s*v(?:s|\.|ersus)?\.?\s*-?\s+(.*)$/i);
  if (vm) {
    out.lender = vm[1].trim() || null;
    out.owner = vm[2].trim().replace(/[;,]\s*$/, "") || null;
  } else if (people) {
    // couldn't split — keep the whole thing as defendant rather than drop it
    out.owner = people.replace(/[;,]\s*$/, "") || null;
  }
  Object.assign(out, parseAddress(addrBlob));
  return out;
}

// Pull the visible body text from <div id="post"> as clean lines.
function bodyLines(html) {
  const s = html.indexOf('<div id="post"');
  let body = s > -1 ? html.slice(s) : html;
  const stop = body.search(/<!--\s*\/#freeform-main\s*-->/i);
  if (stop > -1) body = body.slice(0, stop);
  let txt = body
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  txt = decode(txt).replace(/[ \t ]+/g, " ");
  return txt
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean);
}

export async function collect() {
  let html;
  try {
    html = await fetchText(URL, { timeout: 35000 });
  } catch (e) {
    return {
      status: "blocked",
      note: `boonecountyil.gov sheriff-sales page unreachable: ${String(
        e.message || e,
      )} (endpoint ${URL})`,
      leads: [],
    };
  }

  const lines = bodyLines(html);
  if (!lines.length) {
    return {
      status: "blocked",
      note: `Fetched ${URL} (${html.length}b) but <div id="post"> body had 0 text lines — CMS layout changed.`,
      leads: [],
    };
  }

  const leads = [];
  let curSale = null;
  let curCancelled = false;
  let sawHeader = false;

  for (const line of lines) {
    if (isHeader(line)) {
      curSale = headerIso(line);
      curCancelled = /cancel/i.test(line);
      sawHeader = true;
      // a header line can carry an inline case after the date — handled below too
    }
    const caseNumber = caseOf(line);
    if (!caseNumber) continue;

    const rest = line
      .slice(line.indexOf(caseNumber) + caseNumber.length)
      .trim();
    const { lender, owner, address, city, zip } = parseRest(
      rest.replace(/^[\s.;:-]+/, ""),
    );
    // also let a date sit on the same line as the case (fallback)
    const inlineSale = curSale || headerIso(line);
    const cancelled = curCancelled || /cancel/i.test(line);

    leads.push({
      county: "Boone",
      address: address || null,
      city: city || null,
      zip: zip || null,
      owner: owner || null,
      caseNumber, // raw — engine canonicalizes 22FC32 / 25 FC 360 / 2025-FC-... itself
      court: COURT,
      lender: lender || null,
      attorney: null,
      filing: null,
      judgment: null,
      sale: inlineSale || null,
      openingBid: null, // not published on this page
      status: cancelled ? "CANCELLED" : "SCHEDULED",
      sourceUrl: URL,
    });
  }

  if (!leads.length) {
    return {
      status: "ok",
      note: `Reached ${URL} and parsed the body (${lines.length} line(s)${
        sawHeader ? "" : ", no date header"
      }) but found 0 case-numbered sale entries — Boone currently lists no scheduled sheriff sales.`,
      leads: [],
    };
  }

  const live = leads.filter((l) => l.status !== "CANCELLED").length;
  const withCase = leads.filter((l) => l.caseNumber).length;
  return {
    status: "ok",
    note: `${leads.length} Boone sheriff sale entr${
      leads.length === 1 ? "y" : "ies"
    } (${live} scheduled, ${leads.length - live} cancelled) from county CMS plain-text body; ${withCase} carry a case# (cross-confirm key). FILLS BOONE (Judici-Boone is login-gated).`,
    leads,
  };
}
