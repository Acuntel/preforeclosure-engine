// Debug harness for the FREE phone/email scraper. Run it on your MAC (needs a real
// window — Cloudflare walls headless). It runs the exact enrichPhones() path the
// tracker uses, on one address, and tells you what it got or where it failed. On a
// failure it drops a full-page screenshot (people-search-debug-*.png) so we can see
// the wall/challenge and fix the parser.
//
//   node test-phone.js "3411 Madison St" "Bellwood" 60104
//   node test-phone.js "1103 S Oakland" "Villa Park"
//
// Force a windowed browser (recommended) or headless to reproduce the wall:
//   node test-phone.js ...            # headed (default) — should clear Cloudflare
//   PEOPLE_SEARCH_HEADLESS=1 node ... # headless — will usually wall (that's the point)
process.env.PROFILE = "vince";
process.env.PEOPLE_SEARCH_DEBUG = "1";

const [address, city, zip] = process.argv.slice(2);
if (!address || !city) {
  console.log('usage: node test-phone.js "<street address>" "<city>" [zip]');
  process.exit(1);
}

const { enrichPhones } = await import("./src/collectors/people-search.js");

const lead = { county: "?", address, city, zip: zip || null };
console.log(`looking up: ${address}, ${city} ${zip || ""}`);
console.log(
  process.env.PEOPLE_SEARCH_HEADLESS === "1"
    ? "(headless — expect a Cloudflare wall)"
    : "(headed — a Chrome window will open; solve any 1-click challenge if it appears)",
);

const res = await enrichPhones([lead], (m) => console.log("  ", m));

console.log("\n── result ──");
console.log("phone:   ", lead.phone || "(none)");
console.log("phones:  ", lead.phones ? lead.phones.join(", ") : "(none)");
console.log("email:   ", lead.email || "(none)");
console.log("resident:", lead.occupant || lead.owner || "(none)");
console.log("source:  ", lead.contactSource || "(none)");
console.log("\nstats:", JSON.stringify(res));
if (!lead.phone)
  console.log(
    "\nNo phone. Check the people-search-debug-*.png screenshot in this folder — if it shows\n" +
      "a Cloudflare 'press & hold' or a blank/redesigned page, tell me what you see and I'll adjust the parser.",
  );
process.exit(0);
