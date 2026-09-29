// Public Notice Illinois search mechanics for the probate collector, copied from
// public-notice-il.js (which exports only collect) and parameterized by keyword
// and window. Cookieless ASP.NET session id from the 302 Location, scrape
// __VIEWSTATE, POST the search, bump the grid to 50/page, walk the Next postback.
// Throws on a transport or session failure so the caller can report "blocked".
import { fetchText, USER_AGENT } from "../http.js";

export const ORIGIN = "https://www.publicnoticeillinois.com";
const GRID = "ctl00$ContentPlaceHolder1$WSExtendedGridNP1$GridView1$ctl01$";
const F = "ctl00$ContentPlaceHolder1$as1$";

export const clean = (s) =>
  String(s || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
const hidden = (html, name) =>
  (html.match(new RegExp(`name="${name}"[^>]*\\bvalue="([^"]*)"`, "i")) ||
    [])[1] || "";
const fmtDate = (d) => `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
function form(html, q, override = {}) {
  const fields = {
    __EVENTTARGET: "",
    __EVENTARGUMENT: "",
    __VIEWSTATE: hidden(html, "__VIEWSTATE"),
    __VIEWSTATEGENERATOR: hidden(html, "__VIEWSTATEGENERATOR"),
    [F + "txtSearch"]: q.keyword,
    [F + "txtExclude"]: "",
    [F + "rdoType"]: "EXACT",
    [F + "dateRange"]: "rbLastNumDays",
    [F + "txtLastNumDays"]: String(q.days),
    [F + "txtLastNumWeeks"]: "52",
    [F + "txtLastNumMonths"]: "12",
    [F + "txtDateFrom"]: fmtDate(new Date(Date.now() - q.days * 864e5)),
    [F + "txtDateTo"]: fmtDate(new Date()),
    [F + "btnGo1"]: "",
    ...override,
  };
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(fields))
    if (v !== undefined) p.append(k, v);
  return p.toString();
}
// prettier-ignore
const MONTHS = "january february march april may june july august september october november december".split(" ");
function pubDate(s) {
  const m = clean(s).match(/([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})/);
  const mo = m ? MONTHS.indexOf(m[1].toLowerCase()) : -1;
  return mo < 0
    ? null
    : `${m[3]}-${String(mo + 1).padStart(2, "0")}-${m[2].padStart(2, "0")}`;
}
export function parseGrid(html, sid) {
  const out = [];
  const re =
    /Details\.aspx\?SID=[a-z0-9]+&amp;ID=(\d+)[\s\S]*?class="left"><strong>(.*?)<\/strong><br\s*\/?>\s*(.*?)<\/div>[\s\S]*?colspan="3"[^>]*>([\s\S]*?)<\/td>/g;
  let m;
  while ((m = re.exec(html)))
    out.push({
      id: m[1],
      publication: clean(m[2]),
      published: pubDate(m[3]),
      snippet: m[4],
      url: `${ORIGIN}/Details.aspx?SID=${sid}&ID=${m[1]}`,
    });
  return out;
}
const hasGrid = (h) => /wsResultsGrid|GridView1/.test(h);

export async function searchNotices(q) {
  const res = await fetch(`${ORIGIN}/Search.aspx`, {
    redirect: "manual",
    headers: { "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(25000),
  });
  await res.body?.cancel().catch(() => {}); // free the socket (302 body unused)
  const sid = ((res.headers.get("location") || "").match(
    /\(S\(([a-z0-9]+)\)\)/,
  ) || [])[1];
  if (!sid) throw new Error("no cookieless session id in the 302");
  const url = `${ORIGIN}/(S(${sid}))/Search.aspx`;
  const page = await fetchText(url, { cache: false });
  if (!hidden(page, "__VIEWSTATE"))
    throw new Error("no __VIEWSTATE on the session page");
  const headers = {
    "User-Agent": USER_AGENT,
    "Content-Type": "application/x-www-form-urlencoded",
  };
  const post = (body) =>
    fetchText(url, { method: "POST", body, headers, cache: false });
  const nav = (html, target) =>
    form(html, q, {
      __EVENTTARGET: GRID + target,
      [GRID + "ddlPerPage"]: "50",
      [GRID + "ddlSortBy"]: "DatePublishedDate DESC",
      [F + "btnGo1"]: undefined,
    });
  let cur = await post(form(page, q));
  if (!hasGrid(cur)) throw new Error("search returned no results grid");
  try {
    const wide = await post(nav(cur, "ddlPerPage"));
    if (hasGrid(wide)) cur = wide;
  } catch {}
  const pages = +(
    (cur.match(/lblTotalPages">\s*of\s*([\d,]+)\s*Pages/) || [])[1] || "1"
  ).replace(/,/g, "");
  const rows = parseGrid(cur, sid);
  const seen = new Set(rows.map((r) => r.id));
  for (let p = 2; p <= Math.min(pages, q.maxPages || 20); p++) {
    let nxt;
    try {
      nxt = await post(nav(cur, "btnNext"));
    } catch {
      break;
    }
    const more = hasGrid(nxt)
      ? parseGrid(nxt, sid).filter((r) => !seen.has(r.id))
      : [];
    if (!more.length) break;
    for (const r of more) seen.add(r.id);
    rows.push(...more);
    cur = nxt;
  }
  return { rows, pages };
}
