// Plain-sentence copy for the pick card and the no-deal line. User-facing:
// full sentences, no em or en dashes.

export const money = (n) =>
  n == null ? "unknown" : `$${(Math.round(n / 1000) * 1000).toLocaleString("en-US")}`;

const PAYOFF_LABEL = {
  judgment: "the court judgment plus 10 percent",
  "opening bid": "the opening bid",
  mortgage: "the recorded mortgage",
  "asking price": "the asking price",
  "last sale": "a guess from the last sale price",
  "probate estimate": "an assumed payoff, since no loan figure is on record",
};

const allStatuses = (lead) =>
  [lead.status, ...(lead.statuses || [])].filter(Boolean).map(String);

function stageSentence(t) {
  const d = t.runwayDays;
  if (d != null) return `The sale is in ${d} ${d === 1 ? "day" : "days"}.`;
  if (t.stage === "judgment") return "A judgment is entered and no sale date is set yet.";
  if (t.stage === "probate") return "This is a probate estate with no foreclosure case.";
  return "The foreclosure case is filed and no sale date is set yet.";
}

function marketSentence(t) {
  if (t.marketBasis === "comps")
    return t.anchor
      ? `The value comes from ${t.compsEvents} recent sales in the area and agrees with the county assessor.`
      : "The value comes from recent sales in the area. There is no assessor figure to check it against.";
  if (t.compsRejected)
    return "The value is the county assessor's figure, because the nearby sales did not line up with it.";
  return "The value is the county assessor's figure.";
}

// Card reasons for a lead that passed every gate.
export function buildReasons(lead, t) {
  const out = [
    `Worth about ${money(t.market)}, owes about ${money(t.payoff)} (${PAYOFF_LABEL[t.payoffBasis] || "our best payoff figure"}), so about ${money(t.equity)} of equity (${t.equityPct} percent).`,
    marketSentence(t),
    stageSentence(t),
    `It is ${t.distanceMi} miles from the office.`,
  ];
  if (t.estate)
    out.push(
      "The owner appears to have died, since the records name an estate or heirs. Heirs usually want a fast, simple sale.",
    );
  if (t.probatePath)
    out.push(
      "No loan figure is on record for this estate, so we assume about 40 percent equity to rank it. Confirm the payoff before making an offer.",
    );
  if (t.govCoParty)
    out.push(
      "HUD or the United States is also named, which often means a reverse mortgage or an FHA partial claim.",
    );
  out.push(`Our confidence in the numbers is ${t.confidence}.`);
  return out;
}

// One plain sentence explaining why a lead was dropped.
export function gateReason(gate, lead, t, cfg) {
  const d = t.runwayDays;
  const city = String(lead.city || "").trim();
  switch (gate) {
    case "dead_status": {
      const s = allStatuses(lead).find((x) => /cancel|plaintiff|third party|sold|vacat|dismiss/i.test(x));
      return `The sale is marked "${s}", so the deal is dead.`;
    }
    case "sale_passed":
      return `The sale date passed ${-d} ${d === -1 ? "day" : "days"} ago.`;
    case "short_runway":
      return `The sale is only ${d} ${d === 1 ? "day" : "days"} away, which is less than the ${cfg.minRunway} days Vince needs to act.`;
    case "no_address":
      return "There is no street address.";
    case "no_owner":
      return "There is no owner name to contact.";
    case "entity_owner":
      return `The owner is ${t.owner}, which is a company, association, trust or government body, not a person.`;
    case "out_of_radius":
      if (t.distanceMi == null) return "We could not place the house on the map to check the distance.";
      if (lead.county === "Cook" && /CHICAGO/i.test(city) && !/HEIGHTS|RIDGE/i.test(city))
        return "It is in Chicago proper, which is excluded.";
      if (t.distanceMi <= cfg.radiusMi) return `It is in ${city || "a town"} that is excluded, or we could only place it by county.`;
      return `It is ${t.distanceMi} miles from the office, outside the ${cfg.radiusMi} mile radius.`;
    case "already_sent":
      return "Vince already got this property.";
    case "suspect_value":
      return `The ${t.equityPct} percent gap is not backed by a judgment or opening bid, so it is most likely bad data.`;
    case "no_gap":
      if (t.market == null) return "We have no market value we trust for this house.";
      if (t.payoff == null) return "We have no payoff figure we trust, so the equity is unknown.";
      return `It owes about as much as it is worth or more (about ${money(t.payoff)} owed on ${money(t.market)}).`;
    case "estate_not_owner":
      return `The county tax bill names ${String(lead.taxOwner || "someone else").trim()}, not the estate, so the estate may not own this house.`;
    case "weak_value":
      if (t.anchor == null)
        return "There is no county assessor value to check the market price against, so the equity is not reliable.";
      return "The equity rests on the assessor's value and a guessed payoff, with no judgment, bid or matching nearby sales to back it.";
    case "small_gap":
      return `The equity is only about ${money(t.equity)} (${t.equityPct} percent), below the ${money(cfg.minGap)} and ${cfg.minGapPct} percent bar.`;
    case "low_ev":
      return `After weighing confidence, timing and distance it is worth only about ${money(t.evScore)} to Vince, below the ${money(cfg.minEv)} bar.`;
    default:
      return "It did not pass the checks.";
  }
}
