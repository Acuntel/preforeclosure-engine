// Normalization, stage derivation, equity estimate, and lead scoring.
// Collectors return partial leads; enrichers fill property fields; this turns
// the merged record into the exact shape the CRM consumes.

const MS_DAY = 864e5;

export function daysTo(dateStr, today = new Date()) {
  if (!dateStr) return null;
  return Math.round((new Date(dateStr + "T00:00:00") - today) / MS_DAY);
}

// Stage from the IL judicial-foreclosure paper trail (see MASTER_PROMPT §3).
export function deriveStage(lead, today = new Date()) {
  const d = daysTo(lead.sale, today);
  if (d != null && d >= 0) {
    if (d <= 7) return "auction_imminent";
    if (d <= 30) return "notice_of_sale";
    return "judgment"; // sale scheduled but >30d out
  }
  if (lead.judgment) return "judgment";
  return "lis_pendens"; // filed, no sale date yet = earliest signal
}

// Illinois assessed value ≈ 1/3 of fair market (33.33% level of assessment).
function estMarketFrom(lead) {
  if (lead.estMarket) return lead.estMarket;
  if (lead.assessed) return Math.round((lead.assessed * 3) / 1000) * 1000;
  if (lead.lastSalePrice) return Math.round(lead.lastSalePrice * 1.25);
  return null;
}
// Debt estimate: opening bid ≈ payoff; else ~80% of last sale price.
function estDebtFrom(lead) {
  if (lead.estDebt) return lead.estDebt;
  if (lead.openingBid) return lead.openingBid;
  if (lead.lastSalePrice) return Math.round(lead.lastSalePrice * 0.8);
  return null;
}

export function leadScore(lead) {
  let s = 0;
  const eqPct =
    lead.estMarket && lead.estEquity != null
      ? lead.estEquity / lead.estMarket
      : 0;
  s += Math.max(0, Math.min(40, Math.round(eqPct * 80))); // equity up to 40
  if (lead.absentee) s += 20; // reachable / motivated
  const d = daysTo(lead.sale);
  if (d != null && d >= 0) s += d <= 7 ? 20 : d <= 30 ? 16 : 10; // urgency
  if (lead.caseNumber) s += 10; // confirmed case
  if (lead.phone || lead.email) s += 10; // already reachable
  return Math.max(1, Math.min(99, s));
}

// Finalize a merged raw+enriched lead into the CRM record shape.
export function finalize(lead, idx, today = new Date()) {
  const out = { ...lead };
  out.id = lead.id ?? idx + 1;
  out.estMarket = estMarketFrom(lead);
  out.estDebt = estDebtFrom(lead);
  out.estEquity =
    out.estMarket != null && out.estDebt != null
      ? out.estMarket - out.estDebt
      : 0;
  out.stage = lead.stage || deriveStage(lead, today);
  out.absentee =
    lead.absentee ??
    (lead.mailing && lead.address
      ? !lead.mailing
          .toUpperCase()
          .includes(String(lead.address).toUpperCase().slice(0, 10))
      : false);
  // base desirability score + a confirmation bonus (multi-source = more trustworthy)
  let s = lead.score ?? leadScore(out);
  if (lead.confirmations > 1)
    s = Math.min(99, s + (lead.confirmations - 1) * 7);
  out.score = s;
  return out;
}

// Dedupe by case number, else by address+county.
export function dedupe(leads) {
  const seen = new Map();
  for (const l of leads) {
    const key = (l.caseNumber || `${l.address}|${l.county}`)
      .toUpperCase()
      .trim();
    const prev = seen.get(key);
    // keep the richer record (more filled fields)
    if (
      !prev ||
      Object.values(l).filter(Boolean).length >
        Object.values(prev).filter(Boolean).length
    )
      seen.set(key, l);
  }
  return [...seen.values()];
}
