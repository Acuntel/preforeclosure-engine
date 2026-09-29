// Deal-quality judgment — decides which leads are GOOD ENOUGH to ping. Vince wants
// a few genuinely good leads a day, not a firehose. This is a separate gate from
// the display score: it answers "is this worth interrupting Vince for?"
//
// Weighted on his actual playbook (from his messages):
//   - biggest UNDER-MARKET value gap = the whole game
//   - motivated-seller distress: dead-owner/probate #1, then divorce/foreclosure/etc.
//   - reachable (we have a phone) = actionable now
//   - absentee owner / out-of-area heir ("kids who inherit don't care, just want money")
//   - urgency (a sale/auction date bearing down)
// A lead must clear VINCE_PING_MIN (default 60) to ping; the rest sit in the board.
// Since 2026-09-28 the one-a-day pick does NOT use this score: src/pick.js
// ranks by expected profit. Tiers remain for the board and the legacy paths.
import { daysTo } from "./score.js";
import { leadDistanceMi, proximityPoints } from "./proximity.js";
import { ESTATE_RE } from "./owner.js";

// Motivated-seller strength by distress signal, ranked by CLOCK STRENGTH — the #1
// predictor of a closed cash deal (per a 20k-closed-deal dataset) is an externally
// imposed, time-bound constraint the seller can't stop by just listing. So
// deadline-bearing financial distress and probate rank highest; condition-only
// (code violations) is weak alone. Urgency (days-to-sale) is added separately.
const DISTRESS = {
  auction_imminent: 42, // hardest clock — sale scheduled
  notice_of_sale: 40,
  tax_delinquent: 40, // tax-sale deadline
  judgment: 38,
  foreclosure: 38,
  probate: 38, // heirs want fast liquidation, low attachment
  death: 38,
  estate: 36,
  lis_pendens: 34, // clock started, sale not yet set
  divorce: 32, // court-ordered timeline
  eviction: 30,
  vacant: 28, // absentee carrying costs
  code_violation: 14, // condition-only = weak by itself, needs a life/financial event
  fsbo: 16,
};

// Record age in days (filing/recording/publish date → today); null when undated.
export function recordAgeDays(lead) {
  const d = lead.filing || lead.published || lead.recorded || null;
  if (!d) return null;
  const t = Date.parse(d);
  return Number.isNaN(t) ? null : Math.floor((Date.now() - t) / 86_400_000);
}

const FRESH_MAX = Number(process.env.VINCE_FRESH_MAX_PTS || 10);

function distressStrength(lead) {
  const keys = [
    lead.signal,
    lead.stage,
    ...(Array.isArray(lead.sources) ? lead.sources : []),
  ]
    .filter(Boolean)
    .map((s) => String(s).toLowerCase());
  // dead-owner markers in the caption (UNKNOWN HEIRS, ESTATE OF, "... EST")
  // count as probate distress (spec P1-1)
  if ([lead.owner, lead.lender, lead.defendant].some((f) => f && ESTATE_RE.test(String(f))))
    keys.push("probate");
  let best = 0;
  let label = null;
  for (const [k, w] of Object.entries(DISTRESS))
    if (keys.some((s) => s.includes(k)) && w > best) ((best = w), (label = k));
  return { pts: best, label };
}

// 0–100 quality + tier + human-readable reasons. Pure; no I/O.
export function dealQuality(lead) {
  let score = 0;
  const reasons = [];
  const misses = [];

  // 1) under-market value gap — the core signal, up to 40 pts. ONLY counts when
  //    the gap is trustworthy: a "suspect"/low/unknown gap (no real cost figure or
  //    an implausible spread) earns ZERO, so fake $16M gaps can't inflate a lead.
  const pct = lead.valueGapPct;
  const trustable =
    lead.valueConfidence === "high" || lead.valueConfidence === "medium";
  if (pct != null && pct > 0 && trustable) {
    const trust = lead.valueConfidence === "high" ? 1 : 0.7;
    const pts = Math.max(0, Math.min(40, Math.round(pct * 0.8 * trust)));
    score += pts;
    reasons.push(
      `${pct}% under market, ${lead.valueConfidence}-conf (+${pts})`,
    );
  } else {
    misses.push(
      lead.valueConfidence === "suspect"
        ? "value gap looks like bad data (ignored)"
        : "no trustworthy value gap yet",
    );
  }

  // 2) distress strength — up to ~34 pts.
  const d = distressStrength(lead);
  if (d.pts) {
    score += d.pts;
    reasons.push(`${d.label} (+${d.pts})`);
  }

  // 3) contactability — speed-to-first-contact is a top conversion predictor. A
  //    verified MOBILE beats a landline beats email beats a probate heir+mailing. up to 14.
  if (lead.phone) {
    const mobile = /wireless|mobile|cell/i.test(lead.phoneType || "");
    const pts = mobile ? 14 : 10;
    score += pts;
    reasons.push(`${mobile ? "mobile" : "phone"} on file (+${pts})`);
  } else if (lead.heirName) {
    score += 10;
    reasons.push("heir named + mailing (+10)");
  } else {
    misses.push("no phone yet — run skip-trace");
  }

  // 4) absentee / out-of-area heir — Vince's sweet spot. up to 12.
  if (lead.absentee || lead.occupant || lead.heirMailing) {
    score += 12;
    reasons.push("absentee/heir (+12)");
  }

  // 5) urgency — a sale date bearing down. up to 10.
  const dts = daysTo(lead.sale);
  if (dts != null && dts >= 0) {
    const u = dts <= 14 ? 10 : dts <= 45 ? 7 : 4;
    score += u;
    reasons.push(`sale in ${dts}d (+${u})`);
  }

  // 6) signal stacking — leads confirmed on 2+ distress lists convert best
  //    (probate + tax-delinquent, pre-foreclosure + absentee, etc.). +7 each extra, cap 15.
  const stack = Math.max(0, (lead.confirmations || 1) - 1);
  if (stack) {
    const s = Math.min(15, stack * 7);
    score += s;
    reasons.push(`on ${lead.confirmations} lists (+${s})`);
  }

  // 7) proximity to Vince's home base (Elmhurst) — BONUS ONLY, up to 12. Close +
  //    good beats far + good; far leads lose nothing and surface once the close
  //    ones are sent.
  const mi = leadDistanceMi(lead);
  const prox = proximityPoints(mi);
  if (prox) {
    score += prox;
    reasons.push(`${mi} mi from home base (+${prox})`);
  }

  // 8) freshness — Vince's two priority windows: BRAND-NEW filings ("you can
  //    start to nurture" before anyone else calls) and ~6 months in ("shit's
  //    about to get serious" — on the IL judicial timeline the redemption clock
  //    is running out and the sale is getting real). Between the two the file
  //    mostly sits with the attorneys, so mid-age earns less.
  const age = recordAgeDays(lead);
  if (age != null && age >= 0) {
    let f = 0;
    let why = null;
    if (age <= 30) ((f = FRESH_MAX), (why = `brand-new filing (${age}d)`));
    else if (age >= 150 && age <= 240)
      ((f = Math.round(FRESH_MAX * 0.8)),
        (why = `~6mo in (${age}d) — end-game window`));
    else if (age < 150)
      ((f = Math.round(FRESH_MAX * 0.4)), (why = `filed ${age}d ago`));
    if (f) {
      score += f;
      reasons.push(`${why} (+${f})`);
    }
  }

  // Display only. The daily pick ranks by EV in pick.js and never reads the
  // quality score, the tier, or this 100 cap.
  const raw = Math.max(0, score);
  score = Math.min(100, raw);
  const tier = score >= 70 ? "A" : score >= 55 ? "B" : score >= 40 ? "C" : "D";
  return {
    quality: score,
    qualityRaw: raw,
    tier,
    reasons,
    misses,
    distress: d.label,
    distanceMi: mi,
  };
}

// ── Vince's ping CRITERIA (explicit + env-tunable) ────────────────────────────
// A lead must clear ALL of these to interrupt him. Shown in the ping so he sees
// exactly why it qualified, and capped low so it's a few good ones a day.
export const CRITERIA = {
  minQuality: Number(process.env.VINCE_PING_MIN || 60), // out of 100
  requireAddress: true, // no address = can't act
  requireDistress: true, // must have a real distress signal
  // block leads whose ONLY strength was a bogus value gap
  blockSuspectValue: process.env.VINCE_ALLOW_SUSPECT !== "1",
};

export function pingThreshold() {
  return CRITERIA.minQuality;
}

// Should this lead interrupt Vince? Must meet every criterion — and we return WHY
// (or why not) so the ping and the board can show it.
export function pingDecision(lead) {
  const q = lead.quality ?? dealQuality(lead).quality;
  const fails = [];
  if (CRITERIA.requireAddress && !lead.address) fails.push("no address");
  if (CRITERIA.requireDistress && !(lead.signal || lead.stage))
    fails.push("no distress signal");
  if (
    CRITERIA.blockSuspectValue &&
    lead.valueConfidence === "suspect" &&
    q < 70
  )
    fails.push("value gap looks fake");
  if (q < CRITERIA.minQuality)
    fails.push(`quality ${q} < ${CRITERIA.minQuality}`);
  return { ok: fails.length === 0, quality: q, fails };
}

export function shouldPing(lead) {
  return pingDecision(lead).ok;
}

// Annotate every lead with its quality fields (for the board + the ping gate).
export function scoreQuality(leads) {
  for (const l of leads) {
    const q = dealQuality(l);
    l.quality = q.quality;
    l.qualityRaw = q.qualityRaw;
    l.tier = q.tier;
    l.qualityReasons = q.reasons;
    l.qualityMisses = q.misses;
    l.distress = l.distress || q.distress;
    l.distanceMi = q.distanceMi;
  }
  return leads;
}
