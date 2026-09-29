// Who owns the house? Classifies the owner caption for the Vince pick:
// a real person (or a dead person's estate) can sell; an LLC, condo
// association, land trust, bank or the government cannot be door-knocked.

// Dead-owner markers in owner, defendant or lender captions (spec P1-1).
export const ESTATE_RE =
  /UNKNOWN HEIRS|LEGATEES|SPECIAL REPRESENTATIVE|ESTATE OF|DECEASED|\bEST\b/i;

// D5 covers HUD and the United States only. City, village, county and state
// parties (water liens, IDOR) are plain lienholders: never a bonus.
const FED_RE =
  /\b(UNITED STATES|USA|U S A|HUD|SECRETARY OF HOUSING|HOUSING AND URBAN)\b/i;
const GOV_RE =
  /\b(UNITED STATES|USA|U S A|HUD|SECRETARY OF|HOUSING AND URBAN|STATE OF ILLINOIS|STATE OF|DEPARTMENT OF|DEPT OF|COUNTY OF|CITY OF|VILLAGE OF|TOWN OF|ILLINOIS DEPARTMENT)\b/i;
const ENTITY_RE =
  /\b(LLC|L L C|INC|INCORPORATED|CORP|CORPORATION|COMPANY|LTD|LLP|LP|ASSN|ASSOCIATION|CONDO|CONDOMINIUM|HOA|TRUST|TRUSTEE|TRUSTEES|TR|LTC|PROPCO|HOLDINGS|PROPERTIES|INVESTMENTS|BANK|MORTGAGE|MTG|FUND|CHURCH|MINISTRIES|PARTNERSHIP|BENEFICIARIES|BENEFICIARY)\b/i;
const PLACEHOLDER_RE =
  /^\s*(\(?owner name pending\)?|unknown|unknown owner|n\/?a|none|owner|occupant|current owner)\s*$/i;
// "X as Special Representative for Y": X is a court appointee, Y the decedent.
const REP_RE =
  /^(.*?)\s*,?\s*\bAS\s+(?:THE\s+)?(?:INDEPENDENT\s+)?(?:SPECIAL\s+REPRESENTATIVE|ADMINISTRAT(?:OR|RIX)|EXECUT(?:OR|RIX)|GUARDIAN)\s+(?:FOR|OF)\s+(?:THE\s+ESTATE\s+OF\s+)?(.*)$/i;

const clean = (s) =>
  String(s || "")
    .replace(/\s+/g, " ")
    .trim();

export const hasName = (s) => !!clean(s) && !PLACEHOLDER_RE.test(clean(s));

// Caption boilerplate that names nobody we can knock on.
const BOILERPLATE =
  /UNKNOWN OWNERS?,? AND NON[- ]?RECORD CLAIMANTS|NON[- ]?RECORD CLAIMANTS|UNKNOWN OWNERS?|UNKNOWN TENANTS?|UNKNOWN OCCUPANTS?|\bOCCUPANTS?\b|\bET\.?\s*AL\b\.?/gi;
const MONTHS = "JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|SEPT|OCT|NOV|DEC";

// Folds that keep one party in one piece before splitting on commas.
function fold(caption) {
  return clean(caption)
    .replace(/HOUSING AND URBAN DEVELOPMENT/gi, "HUD")
    .replace(/HEIRS AND LEGATEES/gi, "HEIRS LEGATEES")
    .replace(/\s+[AFND]\/?K\/?A\/?\s+[^,;()]*/gi, " ") // a/k/a, f/k/a, n/k/a aliases
    .replace(/\s+D\/B\/A\s+[^,;()]*/gi, " ")
    .replace(/,\s*(JR|SR|II|III|IV)\b\.?/gi, " $1")
    .replace(/,\s*N\.?\s?A\b\.?|\bN\.\s?A\./gi, " NATIONAL ASSOCIATION")
    .replace(/,\s*(INC|LLC|L\.L\.C|LTD|P\.?C|L\.?P)\b\.?/gi, " $1")
    .replace(/,\s*\(?DECEASED\)?/gi, " (DECEASED)")
    .replace(
      new RegExp(`\\b(${MONTHS})[A-Z]*\\.?\\s+(\\d{1,2}),\\s*(\\d{4})`, "gi"),
      "$1 $2 $3",
    )
    .replace(BOILERPLATE, " ");
}

const words = (p) =>
  clean(p)
    .split(" ")
    .filter((w) => /[A-Z]/i.test(w)).length;

// Split a caption into parties on AND, &, ; and /. A comma splits too, unless a
// piece is a single word ("SMITH, JOHN" stays one person).
export function parties(caption) {
  const out = [];
  for (const chunk of fold(caption).split(/\s+(?:AND|&)\s+|;|\//i)) {
    const bits = chunk
      .split(",")
      .map(clean)
      .filter((b) => /[A-Z]{2}/i.test(b));
    const split = bits.length > 1 && bits.every((b) => words(b) >= 2);
    // "JOHN DOE, AS SPECIAL REPRESENTATIVE OF ..." stays one party.
    const pieces = (split ? bits : [chunk]).reduce((acc, b) => {
      if (acc.length && /^AS\s/i.test(b)) acc[acc.length - 1] += ` ${b}`;
      else acc.push(b);
      return acc;
    }, []);
    for (const p of pieces) {
      const c = clean(p).replace(/^[,.\s]+|[,.\s]+$/g, "");
      if (/[A-Z]{2}/i.test(c)) out.push(c);
    }
  }
  return out;
}

// One classified party: { text, kind, fed }. A court appointee (special
// representative, administrator) becomes the estate of the person named.
function classify(p) {
  const rep = REP_RE.exec(p);
  if (rep && /[A-Z]{2}/i.test(rep[2])) {
    const who = clean(rep[2])
      .replace(/\(?DECEASED\)?/gi, "")
      .trim();
    return [
      ...(rep[1]
        ? [{ text: clean(rep[1]), kind: "fiduciary", fed: false }]
        : []),
      { text: `ESTATE OF ${who}`, kind: "estate", fed: false },
    ];
  }
  let kind;
  if (
    /UNKNOWN (HEIRS|LEGATEES)/i.test(p) ||
    (!/^UNKNOWN\b/i.test(p) && ESTATE_RE.test(p))
  )
    kind = "estate";
  else if (GOV_RE.test(p)) kind = "gov";
  else if (ENTITY_RE.test(p)) kind = "entity";
  else if (/^UNKNOWN\b/i.test(p)) kind = "unknown";
  else kind = /[A-Z]/i.test(p) ? "person" : "other";
  return [{ text: p, kind, fed: kind === "gov" && FED_RE.test(p) }];
}

export const classifyParties = (caption) => parties(caption).flatMap(classify);

const unknownish = (s) => !hasName(s) || /^UNKNOWN\b/i.test(clean(s));

// Estate / heirs marker on any party field of the lead (or a probate source).
// The lender field names the owner's estate only when the owner is missing
// (Cook recorder swaps); otherwise an estate there is the plaintiff or grantor.
export function isEstate(lead) {
  const fields = [lead.owner, lead.defendant, lead.heirName, lead.decedent];
  if (unknownish(lead.owner)) fields.push(lead.lender);
  if (fields.some((f) => f && ESTATE_RE.test(String(f)))) return true;
  const sig = [lead.signal, lead.stage, ...(lead.sources || [])].join(" ");
  return /probate|death|estate/i.test(sig);
}

// The name to knock on. Recorder LPs sometimes put the estate in the lender
// field with the owner "UNKNOWN" (e.g. SHEMECHKO JOHN L EST); swap it in.
export function effectiveOwner(lead) {
  if (hasName(lead.owner)) return clean(lead.owner);
  if (lead.lender && ESTATE_RE.test(lead.lender)) return clean(lead.lender);
  if (hasName(lead.heirName)) return clean(lead.heirName);
  if (hasName(lead.decedent)) return `ESTATE OF ${clean(lead.decedent)}`;
  return null;
}

// The person Vince should call: the heir on a probate lead, else the first
// living person in the caption, else the estate. Never a court appointee.
export function contactParty(lead) {
  if (hasName(lead.heirName)) return clean(lead.heirName);
  const name = effectiveOwner(lead);
  if (!name) return null;
  const ps = classifyParties(name);
  const pick =
    ps.find((p) => p.kind === "person") ||
    ps.find((p) => p.kind === "estate" && !/^UNKNOWN\b/i.test(p.text)) ||
    ps.find((p) => p.kind === "estate");
  return pick ? pick.text : null;
}

// { name, contact, kind: "person"|"estate"|"entity"|"gov"|"missing", govCoParty }
// A person or estate next to HUD or the US counts as a person (D5), and the
// federal co-party is reported so the ranker can treat it as a mild plus.
export function ownerClass(lead) {
  const name = effectiveOwner(lead);
  if (!name)
    return { name: null, contact: null, kind: "missing", govCoParty: false };
  const ps = classifyParties(name);
  const kinds = ps.map((p) => p.kind);
  const human = kinds.includes("estate")
    ? "estate"
    : kinds.includes("person")
      ? "person"
      : null;
  const contact = contactParty(lead);
  if (human)
    return { name, contact, kind: human, govCoParty: ps.some((p) => p.fed) };
  if (kinds.includes("gov"))
    return { name, contact, kind: "gov", govCoParty: false };
  return { name, contact, kind: "entity", govCoParty: false };
}
