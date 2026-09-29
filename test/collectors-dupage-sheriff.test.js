// node --test test/  (Node 20+, no deps). Offline: parses a captured slice of
// the live DuPage Sheriff feed (test/fixtures/dupage-sheriff-feed.json).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  parseFeed,
  parseAddress,
  parseTitle,
  normCaseNo,
  money,
  vanishedCases,
} from "../src/collectors/dupage-sheriff.js";
import { normCase } from "../src/match.js";

const feed = JSON.parse(
  readFileSync(
    new URL("./fixtures/dupage-sheriff-feed.json", import.meta.url),
    "utf8",
  ),
);
const { rows, leads } = parseFeed(feed);
const byCase = (c) => leads.find((l) => l.caseNumber === c);

test("parses every fixture row and drops the verbatim duplicate", () => {
  assert.equal(rows, 11);
  assert.equal(leads.length, 10);
  for (const l of leads) {
    assert.equal(l.county, "DuPage");
    assert.match(l.sale, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(l.address && l.owner && l.lender);
  }
});

test("Elmhurst sales carry street, city, zip, owner and lender", () => {
  const a = byCase("24 FC 514");
  assert.equal(a.address, "132 South Linden Ave");
  assert.equal(a.city, "Elmhurst");
  assert.equal(a.zip, "60126");
  assert.equal(a.sale, "2026-10-01");
  assert.equal(a.owner, "ADRIANA COOKE");
  assert.equal(a.lender, "THE HUNTINGTON NATIONAL BANK");
  assert.equal(a.openingBid, null);
  const b = byCase("26 FC 65");
  assert.equal(b.address, "204 Clinton Avenue");
  assert.equal(b.city, "Elmhurst");
  assert.equal(b.sale, "2026-11-17");
});

test("case numbers cross-confirm with Intercounty through match.normCase", () => {
  assert.equal(normCaseNo("24FC514"), "24 FC 514");
  assert.equal(normCaseNo("09CH5911"), "09 CH 5911");
  assert.equal(normCase(normCaseNo("24FC514")), normCase("24 FC 514"));
  assert.equal(normCase(normCaseNo("26FC65")), "2026FC65");
});

test("opening bid is parsed only when provided", () => {
  assert.equal(byCase("24 FC 545").openingBid, 249344);
  assert.equal(money("Not Provided"), null);
});

test("estate defendants keep the DECEASED / HEIRS marker for the estate regex", () => {
  const l = byCase("22 FC 853");
  assert.equal(l.owner, "BURLACH EDWARD E DECEASED");
  assert.match(l.defendant, /UNKNOWN HEIRS/);
  assert.match(
    `${l.owner} ${l.defendant}`,
    /UNKNOWN HEIRS|LEGATEES|ESTATE OF|DECEASED/,
  );
});

test("lender trims capacity boilerplate", () => {
  assert.equal(
    byCase("24 FC 773").lender,
    "US BANK TRUST NATIONAL ASSOCIATION",
  );
  const t = parseTitle(
    "TODD DAVIS ET AL VS CHICAGO TITLE LAND TRUST CO AS SUCCESSOR TRUSTEE ET AL",
  );
  assert.equal(t.lender, "TODD DAVIS");
  assert.equal(t.owner, "CHICAGO TITLE LAND TRUST CO");
});

test("address edge cases: grid numbers, bare units, bad zips, glued cities", () => {
  assert.deepEqual(parseAddress("18 WEST 151 KIRKLAND LANE VILLA PARK 60181"), {
    address: "18W151 Kirkland Lane",
    city: "Villa Park",
    zip: "60181",
  });
  assert.equal(
    parseAddress("1811 FOUR LAKES AVENUE 4F LISLE 60532").address,
    "1811 Four Lakes Avenue Unit 4F",
  );
  assert.equal(parseAddress("1420 W JO ANN LANE ADDISON 30101").zip, null);
  assert.equal(
    parseAddress("20 NORTH TOWER ROAD UNIT 7L OAKBROOK 60523").city,
    "Oak Brook",
  );
  const e = parseAddress("9501 FALLING WATERS DRIVE EAST BURR RIDGE 60527");
  assert.equal(e.city, "Burr Ridge");
  assert.equal(e.address, "9501 Falling Waters Drive East");
  assert.equal(
    parseAddress("3S665 VIRGINIA AVE WARRENVILLE 60555").address,
    "3S665 Virginia Ave",
  );
});

test("vanishedCases flags a case that left the feed before its sale", () => {
  const prev = [
    { caseNumber: "24 FC 514", sale: "2026-10-01" },
    { caseNumber: "99 FC 1", sale: "2026-12-01" },
    { caseNumber: "98 FC 2", sale: "2026-09-01" },
  ];
  const gone = vanishedCases(prev, leads, "2026-09-28");
  assert.deepEqual(
    gone.map((g) => g.caseNumber),
    ["99 FC 1"],
  );
});

test("empty or malformed feed parses to zero leads without throwing", () => {
  assert.equal(parseFeed([]).leads.length, 0);
  assert.equal(parseFeed({}).leads.length, 0);
  assert.equal(parseFeed([{ title: "X", content: "" }]).leads.length, 0);
});
