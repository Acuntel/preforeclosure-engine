// Chicago dates, absentee (P1-6), owner classes (P1-1) and sent-dedupe
// aliases (P0-5). Run: node --test test/*.test.js
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.PROFILE = "vince";
const { daysTo, chicagoToday, isAbsentee, finalize } =
  await import("../src/score.js");
const { ownerClass, isEstate } = await import("../src/owner.js");
const { aliasKeys, buildSentSet, isSentIn, expandLegacyKey } =
  await import("../src/alias.js");

test("daysTo and chicagoToday use the America/Chicago calendar", () => {
  const eveningUtc = new Date("2026-09-29T02:00:00Z"); // 21:00 on 09-28 in Chicago
  assert.equal(chicagoToday(eveningUtc), "2026-09-28");
  assert.equal(daysTo("2026-09-29", eveningUtc), 1);
  assert.equal(daysTo("2026-09-28", eveningUtc), 0);
  assert.equal(daysTo("2026-09-27T00:00:00", eveningUtc), -1);
  assert.equal(daysTo(null), null);
});

test("finalize sets judgmentAmount and uses Cook x10", () => {
  const out = finalize(
    { county: "Cook", assessed: 20000, judgment: 150000 },
    0,
  );
  assert.equal(out.judgmentAmount, 150000);
  assert.equal(out.estMarket, 200000);
});

test("absentee (P1-6): same house with directional or suffix noise is not absentee", () => {
  const t = (address, city, mailing, zip = "") =>
    isAbsentee({ address, city, zip, mailing });
  assert.equal(
    t(
      "1805 23RD AVENUE",
      "MELROSE PARK",
      "1805 N 23RD AVE, MELROSE PARK, IL 60160",
    ),
    false,
  );
  assert.equal(
    t(
      "8641 W BELDEN AVE",
      "ELMWOOD PARK",
      "8641 BELDEN AVE, ELMWOOD PARK, IL 60707",
    ),
    false,
  );
  assert.equal(
    t(
      "3939 EUCLID AVENUE",
      "STICKNEY",
      "3939 S EUCLID AVE, STICKNEY, IL 60402",
    ),
    false,
  );
  assert.equal(
    t(
      "1826 S 13TH AVE",
      "BROADVIEW",
      "1826 1/2 S 13TH AVE, BROADVIEW, IL 60155",
    ),
    false,
  );
  assert.equal(
    t(
      "791 Derby Court",
      "Antioch",
      "791 DERBY CT, ANTIOCH IL 60002 1117",
      "60002",
    ),
    false,
  );
  assert.equal(
    t(
      "1204 S 14TH AVE",
      "MAYWOOD",
      "22879 GREENFIELD BLVD, RICHTON PARK, IL 60471",
      "60153",
    ),
    true,
  );
  assert.equal(
    t("9 N 5TH AVE", "MAYWOOD", "902 N 5TH AVE, MAYWOOD, IL 60153"),
    true,
  );
  assert.equal(t("12 ELM ST", "BERWYN", "PO BOX 44, BERWYN, IL 60402"), true);
});

test("owner classes and estate markers", () => {
  assert.equal(
    ownerClass({
      owner: "LISA D GAREISS; UNKNOWN HEIRS AND LEGATEES OF JOHN GAREISS",
    }).kind,
    "estate",
  );
  assert.equal(
    ownerClass({
      owner: "ACME HOLDINGS LLC; UNKNOWN OWNERS AND NON-RECORD CLAIMANTS",
    }).kind,
    "entity",
  );
  assert.equal(
    ownerClass({ owner: "Bradley Morris; Legacy Restoration, LLC" }).kind,
    "person",
  );
  assert.equal(
    ownerClass({ owner: "S. Joseph Smailis; et. al." }).kind,
    "person",
  );
  assert.equal(ownerClass({ owner: "UNITED STATES OF AMER" }).kind, "gov");
  assert.equal(
    isEstate({ owner: "UNKNOWN", lender: "SHEMECHKO JOHN L EST" }),
    true,
  );
  assert.equal(isEstate({ owner: "JOHN WEST" }), false);
});

test("aliasKeys: county-scoped, unit kept, legacy forms included", () => {
  const k = aliasKeys({
    county: "Cook",
    caseNumber: "2025 CH 01328",
    docNumber: "2616123085",
    pin: "15-11-136-007-0000",
    address: "45 Prairie Park Dr Unit 409",
    city: "Wheeling",
  });
  assert.ok(k.includes("C:COOK:2025CH1328"));
  assert.ok(k.includes("D:COOK:2616123085"));
  assert.ok(k.includes("P:COOK:15111360070000"));
  assert.ok(k.includes("A:COOK:45 PRAIRIE PARK DR UNIT 409"));
  assert.ok(k.includes("Cook::2025 CH 01328"));
  const other = aliasKeys({
    county: "Cook",
    address: "45 Prairie Park Dr Unit 210",
    city: "Wheeling",
  });
  assert.ok(!other.some((x) => k.includes(x)));
  assert.ok(
    !aliasKeys({ county: "Lake", caseNumber: "25 CH 1328" }).includes(
      "C:COOK:2025CH1328",
    ),
  );
});

test("sent set: legacy keys normalize, outcome addresses match", () => {
  assert.ok(expandLegacyKey("Cook::25 CH 1328").includes("C:COOK:2025CH1328"));
  const set = buildSentSet({
    sentKeys: ["Cook::25 CH 1328"],
    outcomes: { a: { address: "630 W GLENCOE RD, PALATINE" } },
  });
  const isSent = isSentIn(set);
  assert.equal(isSent({ county: "Cook", caseNumber: "2025CH01328" }), true);
  assert.equal(
    isSent({
      county: "Cook",
      address: "630 W Glencoe Road",
      city: "Palatine",
      caseNumber: "26CH9",
    }),
    true,
  );
  assert.equal(
    isSent({ county: "Cook", address: "632 W Glencoe Road", city: "Palatine" }),
    false,
  );
});
