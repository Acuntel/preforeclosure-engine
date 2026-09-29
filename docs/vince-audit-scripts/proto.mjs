// PROTOTYPE of the proposed 1/day ranking — read-only, scratch only.
process.env.PROFILE="vince";
import fs from "node:fs";
const ROOT="/Users/bradyschwartz/Desktop/preforeclosure-engine";
const {daysTo}=await import(ROOT+"/src/score.js");
const {leadDistanceMi}=await import(ROOT+"/src/proximity.js");
const {normAddr}=await import(ROOT+"/src/match.js");
const r=JSON.parse(fs.readFileSync(process.argv[2]));
const st=JSON.parse(fs.readFileSync(process.argv[3]));
const sentAddr=new Set(Object.values(st.outcomes).map(o=>normAddr(String(o.address).split(",")[0])));
const num=v=>{const n=Number(String(v??"").replace(/[^0-9.]/g,""));return n>0?n:null};
const street=a=>normAddr(a).split(" ").filter(t=>!["N","S","E","W"].includes(t)).slice(0,2).join(" "); // "8641 BELDEN"
const ENTITY=/\b(LLC|INC|CORP|ASSN|ASSOCIATION|CONDO|PROPCO|HOLDINGS|BANK|MORTGAGE|MTG)\b|^UNITED STATES|^SECRETARY/i;
const out=[];const why={};
const drop=(k)=>(why[k]=(why[k]||0)+1,null);
for(const l of r.leads){
  const d=daysTo(l.sale);
  if(!l.address) {drop("no address");continue}
  if(l.status&&/cancel|plaintiff|third|sold/i.test(l.status)){drop("sale cancelled/sold");continue}
  if(d!=null&&d<0){drop("sale date passed");continue}
  if(d!=null&&d<10){drop("sale <10d (no runway)");continue}
  if(ENTITY.test(l.owner||"")&&!/[A-Z]+ [A-Z]+,/.test(l.owner||"")){drop("entity/HOA owner");continue}
  if(sentAddr.has(normAddr(l.address))){drop("already sent (address)");continue}
  // market: comps sanity vs assessor anchor
  const av=num(l.assessed); const avMkt=av?(l.county==="Cook"?av*10:av*3):null;
  let mkt=l.estMarketComps||null, mconf="comps";
  const uniq=new Set((l.comps||[]).map(c=>c.price+"|"+c.date)).size;
  if(mkt&&avMkt&&(mkt>avMkt*1.8||mkt<avMkt*0.55)){mkt=avMkt;mconf="assessor(comps rejected)"}
  if(mkt&&l.compsCount<5){ if(avMkt){mkt=avMkt;mconf="assessor(thin comps)"} }
  if(!mkt&&avMkt){mkt=avMkt;mconf="assessor"}
  if(!mkt){drop("no market value");continue}
  // debt: judgment > opening bid > recent-sale guess
  let debt=null,dconf=null;
  if(num(l.judgment)){debt=num(l.judgment)*1.1;dconf="judgment+10%"}
  else if(l.openingBid){debt=l.openingBid;dconf="opening bid"}
  else if(l.lastSalePrice&&l.lastSaleDate>="2008"&&l.lastSalePrice>=mkt*0.35){debt=l.lastSalePrice*0.9;dconf="last sale x0.9 (guess)"}
  if(debt==null){drop("no trustworthy debt");continue}
  const eq=mkt-debt, pct=eq/mkt;
  if(eq<50000||pct<0.2){drop("equity <$50k or <20%");continue}
  const mi=leadDistanceMi(l);
  const px=mi==null?0.6:mi<=10?1:mi<=20?0.9:mi<=30?0.7:0.45;
  const stage=d==null?(l.judgment?"judgment":"lis_pendens"):d<=21?"sale 10-21d":d<=90?"sale 22-90d":"sale >90d";
  const pStage={"lis_pendens":0.8,"judgment":0.9,"sale 10-21d":0.85,"sale 22-90d":1.0,"sale >90d":0.9}[stage];
  const pContact=l.owner?1:0.6;
  const pConf=(dconf.includes("guess")?0.6:1)*(mconf==="comps"?1:0.8);
  const ev=eq*px*pStage*pContact*pConf;
  out.push({ev:Math.round(ev),eq:Math.round(eq),pct:Math.round(pct*100),mkt:Math.round(mkt),mconf,debt:Math.round(debt),dconf,mi,stage,d,addr:l.address+", "+l.city,owner:(l.owner||"").slice(0,40),src:l.sources.join("+"),oldQ:l.quality});
}
out.sort((a,b)=>b.ev-a.ev);
console.log("dropped:",why);console.log("eligible:",out.length);
out.slice(0,10).forEach((o,i)=>console.log(`#${i+1} EV $${o.ev.toLocaleString()} | equity $${o.eq.toLocaleString()} (${o.pct}%) mkt $${o.mkt.toLocaleString()} [${o.mconf}] − debt $${o.debt.toLocaleString()} [${o.dconf}] | ${o.stage}${o.d!=null?" d="+o.d:""} | ${o.mi}mi | ${o.addr} | ${o.owner} | ${o.src} | oldQ ${o.oldQ}`));
