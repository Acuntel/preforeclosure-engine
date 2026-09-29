process.env.PROFILE="vince"; process.env.VINCE_PING_OFF="1";
import fs from "node:fs";
const ROOT="/Users/bradyschwartz/Desktop/preforeclosure-engine";
const { shouldPing, dealQuality, pingDecision } = await import(ROOT+"/src/quality.js");
const { leadKey } = await import(ROOT+"/src/notify.js");
const { daysTo } = await import(ROOT+"/src/score.js");
const [,, file, stateFile] = process.argv;
const r = JSON.parse(fs.readFileSync(file));
const st = stateFile ? JSON.parse(fs.readFileSync(stateFile)) : {sentKeys:[]};
const sent = new Set(st.sentKeys||[]);
const L = r.leads;
// recompute quality NOW (with today's date)
let drift=0;
for (const l of L){ const q=dealQuality(l); if(q.quality!==l.quality) drift++; l.quality=q.quality; l.tier=q.tier; l.qualityReasons=q.reasons; l.distanceMi=q.distanceMi; }
console.log("quality drift vs archive:",drift);
const tierRank={A:0,B:1,C:2,D:3};
const qualified=L.filter(l=>shouldPing(l)).sort((a,b)=>(tierRank[a.tier]??9)-(tierRank[b.tier]??9)||(a.distanceMi??Infinity)-(b.distanceMi??Infinity)||(b.quality??0)-(a.quality??0)||(b.valueGap??-Infinity)-(a.valueGap??-Infinity));
const unsent=qualified.filter(l=>!sent.has(leadKey(l)));
console.log("qualified",qualified.length,"unsent",unsent.length,"sentKeys",sent.size);
const show=(l,i)=>console.log(`#${i+1} [${l.tier}${l.quality}] ${l.address}, ${l.city} (${l.county}) ${l.distanceMi}mi | sig=${l.signal} stage=${l.stage} src=${(l.sources||[]).join("+")} conf=${l.confirmations}
    sale=${l.sale} (d=${daysTo(l.sale)}) filing=${l.filing} pub=${l.published} rec=${l.recorded} case=${l.caseNumber}
    mkt=${l.estMarketComps||l.estMarket} comps=${l.compsCount} debt=${l.estDebt} ob=${l.openingBid} ask=${l.askingPrice} mort=${l.mortgageBalance} lastSale=${l.lastSalePrice}@${l.lastSaleDate} gap=${l.valueGap} ${l.valueGapPct}% ${l.valueConfidence} basis=${l.valueBasis}
    owner=${l.owner} occ=${l.occupant} absentee=${l.absentee} mail=${l.mailing} phone=${l.phone} ${l.phoneType||""} type=${l.propertyClass||l.class||l.propType||""} bldg=${l.sqft||l.bldgSqft||""}
    why: ${l.qualityReasons.join(" · ")}`);
unsent.slice(0,12).forEach(show);
fs.writeFileSync(process.argv[4]||"/dev/null", JSON.stringify({qualified:qualified.map(l=>leadKey(l))}));
