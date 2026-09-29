// node --test test/  (Node 20+, no deps). Offline: snippets are verbatim shapes
// from a live Public Notice Illinois "claims notice" pull on 2026-09-28.
import test from "node:test";
import assert from "node:assert/strict";
import {
  parseProbateSnippet as parse,
  parseCounty,
  normProbateCase,
  toLeads,
} from "../src/collectors/probate-pni.js";
import { parseGrid } from "../src/collectors/probate-pni-search.js";

const DH_CERAMI =
  "IN THE CIRCUIT COURT OF THE EIGHTEENTH JUDICIAL CIRCUIT DU PAGE COUNTY, ILLI- NOIS IN RE THE Estate of Patricia M. Cerami Deceased Case No. 2026PR000566 PUBLICA- TION NOTICE AND/OR CLAIMS NOTICE Notice is given of the death of Patricia M. Cerami, 347 Galway Court, Blooming- dale, IL 601 ... click 'view' to open the full text.";
const DH_FALLIN =
  "IN THE CIRCUIT COURT OF THE EIGHTEENTH JUDICIAL CIRCUIT DU PAGE COUNTY, ILLI- NOIS IN RE THE Estate of HEATHER J. FALLIN Deceased Case No. 2026PR000545 PUBLICA- TION NOTICE AND/OR CLAIMS NOTICE Notice is given of the death of HEATHER J. FALLIN, 213 Bradley Court, Unit C, Bloomingalde, I ... click 'view' to open the full text.";
const DH_OHMER =
  "IN THE CIRCUIT COURT OF THE EIGHTEENTH JUDICIAL CIRCUIT DU PAGE COUNTY, ILLI- NOIS IN RE THE Estate of PATRICIA L. OHMER Deceased Case No. 2026PR000524 PUBLICA- TION NOTICE AND/OR CLAIMS NOTICE Notice is given of the death of PATRICIA L. OHMER, 610 Catalpa Ave., Wood Dale, IL 60191, Let ... click 'view' to open the full text.";
const SL_TULLY =
  "STATE OF ILLINOIS COUNTY OF DUPAGE UNITED STATES OF AMERICA IN THE CIRCUIT COURT OF THE EIGHTEENTH JUDICIAL CIRCUIT IN RE THE ESTATE OF KATHLEEN TULLY DECEASED CASE NUMBER 2026PR000488 PUBLICATION NOTICE AND/OR CLAIMS NOTICE Notice is given of the death of KATHLEEN TULLY whose address was 1635 Ar ... click 'view' to open the full text.";
const CHRON_GLUED =
  "LEGAL NOTICE-Published 09/16, 09/23, 09/30-UNITED STATES OF AMERICASTATE OF ILLINOISCOUNTY OF DU PAGEIN THE CIRCUIT COURTOF THE EIGHTEENTHJUDICIAL CIRCUITIN RE THE ESTATE OF CINDY NORGALIA, DECEASED CASE NUMBER 2026PR000441PUBLICATION NOTICE AND/OR CLAIMS NOTICE Notice is given of the death of Cin ... click 'view' to open the full text.";
const WILL_WHOSE =
  "WILL COUNTY Estate of Janet Downing, deceased 26 PR 405 Notice is given of the death of Janet Downing, whose address was 822 New Lenox Road, Joliet, IL. Letters of Office ... click 'view' to open the full text.";
const COOK_REP =
  "IN THE CIRCUIT COURT OF COOK COUNTY, ILLINOIS COUNTY DEPARTMENT - PROBATE DIVISION. Estate of PERCY LEE ESCO, Deceased. Case No. 2024P008117. PUBLISHED NOTICE (A) - CLAIMS NOTICE 755 ILCS 5/18-3 Notice is given of the death of Percy Lee Esco. The representative of the estate is Precious Miller-Tate, ... click 'view' to open the full text.";
const LAKE_DASH =
  "IN THE CIRCUIT COURT OF THE NINETEENTH JUDICIAL CIRCUIT- LAKE COUNTY PROBATE DIVISION Estate of EDWARD JAMES TAWODA, Deceased. No. 26 PR 410 NOTICE Notice is given of the death of Edward James Tawoda, of Vernon Hills, Illinois. Letters of office were issued on August 17, 2026, to Thomas L. ... click 'view' to open the full text.";
const DATE_NOT_ADDR =
  "BOND COUNTY IN THE MATTER OF THE ESTATE OF Michelle L. Zeeb, Deceased 2026-PR-17 Notice is given of the death of Michelle L. Zeeb on April 18, 2026. Letters of Office were issued on August 27, 2026 to Justin Zeeb, ... click 'view' to open the full text.";

test("Daily Herald layout: decedent, case#, county, street and city", () => {
  const l = parse(DH_CERAMI);
  assert.equal(l.county, "DuPage");
  assert.equal(l.caseNumber, "2026PR000566");
  assert.equal(l.decedent, "Patricia M. Cerami");
  assert.equal(l.owner, "ESTATE OF PATRICIA M. CERAMI");
  assert.equal(l.address, "347 Galway Court");
  assert.equal(l.city, "Bloomingdale");
  assert.equal(l.zip, null); // "IL 601" is cut off, never guessed
});

test("unit is kept and a misspelled city snaps to the gazetteer", () => {
  const l = parse(DH_FALLIN);
  assert.equal(l.address, "213 Bradley Court Unit C");
  assert.equal(l.city, "Bloomingdale");
});

test("full address with zip", () => {
  const l = parse(DH_OHMER);
  assert.equal(l.address, "610 Catalpa Ave");
  assert.equal(l.city, "Wood Dale");
  assert.equal(l.zip, "60191");
});

test("a street cut off by the snippet end is not emitted", () => {
  const l = parse(SL_TULLY);
  assert.equal(l.county, "DuPage");
  assert.equal(l.decedent, "KATHLEEN TULLY");
  assert.equal(l.address, null);
});

test("glued Chronicle text still yields county and case#", () => {
  const l = parse(CHRON_GLUED);
  assert.equal(l.county, "DuPage");
  assert.equal(l.caseNumber, "2026PR000441");
  assert.equal(l.decedent, "CINDY NORGALIA");
});

test("'whose address was' layout", () => {
  const l = parse(WILL_WHOSE);
  assert.equal(l.county, "Will");
  assert.equal(l.caseNumber, "2026PR000405");
  assert.equal(l.address, "822 New Lenox Road");
  assert.equal(l.city, "Joliet");
});

test("Cook representative becomes the heir contact", () => {
  const l = parse(COOK_REP);
  assert.equal(l.county, "Cook");
  assert.equal(l.caseNumber, "2024P008117");
  assert.equal(l.heirName, "Precious Miller-Tate");
});

test("a dash after CIRCUIT does not hide the county", () => {
  const l = parse(LAKE_DASH);
  assert.equal(l.county, "Lake");
  assert.equal(l.caseNumber, "2026PR000410");
  assert.equal(l.address, null);
});

test("a death date is never read as a street", () => {
  const l = parse(DATE_NOT_ADDR);
  assert.equal(l.address, null);
  assert.equal(l.decedent, "Michelle L. Zeeb");
  assert.equal(l.heirName, "Justin Zeeb");
});

test("county and case normalization", () => {
  assert.equal(parseCounty("COUNTY OF MC HENRY"), "McHenry");
  assert.equal(parseCounty("DU PAGE COUNTY, ILLINOIS"), "DuPage");
  assert.equal(parseCounty("ST. CLAIR COUNTY"), "St. Clair");
  assert.equal(normProbateCase("2026 PR 548"), "2026PR000548");
  assert.equal(normProbateCase("26-PR-296"), "2026PR000296");
  assert.equal(normProbateCase("2026PR0000125"), "2026PR000125");
  assert.equal(normProbateCase("no case"), null);
});

test("republished notices merge into one estate with the richest fields", () => {
  const rows = [
    { snippet: SL_TULLY, published: "2026-09-18", publication: "A", url: "u1" },
    { snippet: DH_OHMER, published: "2026-09-10", publication: "B", url: "u2" },
    { snippet: DH_OHMER, published: "2026-09-03", publication: "C", url: "u3" },
    { snippet: SL_TULLY, published: "2026-09-11", publication: "D", url: "u4" },
  ];
  const leads = toLeads(rows);
  assert.equal(leads.length, 2);
  const o = leads.find((l) => l.caseNumber === "2026PR000524");
  assert.equal(o.notices, 2);
  assert.equal(o.published, "2026-09-03");
  assert.equal(o.signal, "probate");
  assert.equal(o.stage, "probate");
  assert.equal(o.distress, "probate");
  assert.equal(o.filing, null); // publication date is not a filing date
  assert.match(o.owner, /^ESTATE OF /);
});

test("results grid parser reads id, paper, date and snippet", () => {
  const html =
    '<a href="Details.aspx?SID=abc&amp;ID=123">view</a><div class="left"><strong>DuPage County Daily Herald</strong><br />Friday, September 25, 2026</div><table><tr><td colspan="3">' +
    DH_OHMER +
    "</td></tr></table>";
  const [r] = parseGrid(html, "abc");
  assert.equal(r.id, "123");
  assert.equal(r.publication, "DuPage County Daily Herald");
  assert.equal(r.published, "2026-09-25");
  assert.equal(parse(r.snippet).zip, "60191");
});
