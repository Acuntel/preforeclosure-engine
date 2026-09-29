process.env.PROFILE="vince"; process.env.VINCE_PING_OFF="1";
import fs from "node:fs";
const ROOT="/Users/bradyschwartz/Desktop/preforeclosure-engine";
const { shouldPing, dealQuality } = await import(ROOT+"/src/quality.js");
const { leadKey } = await import(ROOT+"/src/notify.js");
const { daysTo } = await import(ROOT+"/src/score.js");
const r = JSON.parse(fs.readFileSync(process.argv[2]));
const st = JSON.parse(fs.readFileSync(process.argv[3]));
const sent=new Set(st.sentKeys);
const L=r.leads; for(const l of L){const q=dealQuality(l);Object.assign(l,{quality:q.quality,tier:q.tier,qualityReasons:q.reasons,distanceMi:q.distanceMi});}
const Q=L.filter(shouldPing);
const cnt=(f)=>Q.filter(f).length;
console.log("qualified",Q.length);
console.log("gap unknown",cnt(l=>l.valueGap==null),"gap<=0",cnt(l=>l.valueGap!=null&&l.valueGap<=0),"gap>0 high",cnt(l=>l.valueGap>0&&l.valueConfidence==="high"),"gap>0 med",cnt(l=>l.valueGap>0&&l.valueConfidence==="medium"));
console.log("sale past",cnt(l=>daysTo(l.sale)!=null&&daysTo(l.sale)<0),"sale<=3d",cnt(l=>{const d=daysTo(l.sale);return d!=null&&d>=0&&d<=3}));
console.log("no owner",cnt(l=>!l.owner),"phone",cnt(l=>l.phone));
const abs=Q.filter(l=>l.absentee);
const fp=abs.filter(l=>{if(!l.mailing||!l.address)return false;const n=s=>String(s).toUpperCase().match(/^\s*(\d+)/)?.[1];return n(l.mailing)===n(l.address)&&/(\d+)/.test(l.address)&&String(l.mailing).toUpperCase().includes(String(l.city||"").toUpperCase().slice(0,6))});
console.log("absentee true",abs.length,"of which same house# + same city in mailing (likely owner-occupied false +)",fp.length);
fp.slice(0,6).forEach(l=>console.log("   ",l.address,"|",l.mailing));
console.log("absentee via occupant field only",cnt(l=>!l.absentee&&l.occupant&&!l.heirMailing));
const comp80=cnt(l=>l.compsCount===80);console.log("compsCount==80 (capped zip median)",comp80,"of",cnt(l=>l.compsCount));
// hardCost sources
console.log("debt basis:",JSON.stringify(Q.reduce((m,l)=>(m[l.valueBasis]=(m[l.valueBasis]||0)+1,m),{})));
// ties
const top=Q.filter(l=>l.quality>=95); console.log("q>=95",top.length,"q==100",cnt(l=>l.quality===100));
// A-tier breakdown
const A=Q.filter(l=>l.tier==="A").sort((a,b)=>b.quality-a.quality);
console.log("A tier",A.length,"A unsent",A.filter(l=>!sent.has(leadKey(l))).length);
for(const l of A.slice(0,14)) console.log(`${sent.has(leadKey(l))?"SENT":"----"} [${l.quality}] ${l.address}, ${l.city} ${l.distanceMi}mi sale=${l.sale}(${daysTo(l.sale)}) src=${l.sources.join("+")} gap=${l.valueGap} ${l.valueGapPct}% ${l.valueConfidence} mkt=${l.estMarketComps||l.estMarket}/${l.compsCount} debt=${l.estDebt} ob=${l.openingBid} mail=${l.mailing}\n      ${l.qualityReasons.join(" · ")}`);
