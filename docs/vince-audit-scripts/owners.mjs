process.env.PROFILE="vince";
import fs from "node:fs";
const ROOT="/Users/bradyschwartz/Desktop/preforeclosure-engine";
const {shouldPing,dealQuality}=await import(ROOT+"/src/quality.js");const {daysTo}=await import(ROOT+"/src/score.js");
const r=JSON.parse(fs.readFileSync(process.argv[2]));
const Q=r.leads.filter(l=>{Object.assign(l,dealQuality(l));return shouldPing(l)});
const inst=Q.filter(l=>/\b(BANK|MORTGAGE|MTG|FEDERAL|SECRETARY|HUD|UNITED STATES|FANNIE|FREDDIE|LLC|INC|CORP|HOLDINGS|PROPERTIES|INVEST|TRUST(EE)?\b)/i.test(l.owner||""));
console.log("institutional/entity owners among qualified:",inst.length);inst.slice(0,12).forEach(l=>console.log("  ",l.quality,l.owner,"|",l.address,l.city));
// distance ties
const d={};for(const l of Q)d[l.distanceMi]=(d[l.distanceMi]||0)+1;console.log("distinct distances",Object.keys(d).length,"for",Q.length,"leads; biggest ties",Object.entries(d).sort((a,b)=>b[1]-a[1]).slice(0,5));
// stacking composition
const st={};for(const l of Q)if(l.confirmations>1){const k=l.sources.slice().sort().join("+");st[k]=(st[k]||0)+1};console.log("multi-source combos",st);
// fresh label on sale notices
console.log("'brand-new filing' credited via PNI published date:",Q.filter(l=>!l.filing&&l.published&&(l.qualityReasons||[]).some(x=>/brand-new/.test(x))).length);
// how many unsent qualifying with gap>0 medium/high
