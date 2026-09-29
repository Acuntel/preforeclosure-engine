process.env.PROFILE="vince";
import fs from "node:fs";
const ROOT="/Users/bradyschwartz/Desktop/preforeclosure-engine";
const {shouldPing,dealQuality}=await import(ROOT+"/src/quality.js");const {daysTo}=await import(ROOT+"/src/score.js");
const r=JSON.parse(fs.readFileSync(process.argv[2]));
for(const l of r.leads){const q=dealQuality(l);Object.assign(l,{quality:q.quality,tier:q.tier});
 const d=daysTo(l.sale);
 if((l.status&&shouldPing(l))||(d!=null&&d<0&&shouldPing(l)))console.log("QUALIFIES:",l.status,l.address,l.city,"sale",l.sale,d,"q",l.quality,"ob",l.openingBid,"stage",l.stage,l.sources.join("+"))}
