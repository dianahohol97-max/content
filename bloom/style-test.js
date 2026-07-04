import "dotenv/config";
import fs from "fs"; import path from "path"; import { fileURLToPath } from "url";
const __dirname=path.dirname(fileURLToPath(import.meta.url)); const REPO_ROOT=path.resolve(__dirname,"..");
const OUT=path.join(REPO_ROOT,"output","style-tests"); fs.mkdirSync(OUT,{recursive:true});
const STYLES={"brandnoir": "Atmospheric editorial illustration with soft cinematic light and gentle depth, subtle film grain, sophisticated adult mood. STRICTLY brand palette only: lavender, blush pink, sage green, warm cream, deep violet \u2014 absolutely NO grey, NO charcoal, NO greige, NO black. Warm and calm but grown-up, like a refined wellness brand. NO people, no faces, no text. Keep lower third calm for captions. NOT cute, NOT cartoon, NOT childish. Vertical 9:16.", "brandglow": "Soft dreamy editorial illustration, warm glowing light, gentle gradients and subtle grain, elegant and adult. ONLY these colours: lavender, blush pink, sage green, cream, deep violet accents \u2014 no grey, no dark neutrals. Calm sophisticated wellness aesthetic, cohesive with a pastel brand. NO people, no text. NOT cute, NOT childish. Vertical 9:16."}; const SCENE="Concept: mental exhaustion at end of day \u2014 a dim cozy bedroom, unmade bed, soft light from a window. Interpret with mood and light, keep it on-brand.";
async function gemini(p){const key=process.env.GEMINI_API_KEY;
  const url=`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent?key=${key}`;
  const body=JSON.stringify({contents:[{parts:[{text:p}]}]});
  for(let a=1;a<=5;a++){const res=await fetch(url,{method:"POST",headers:{"Content-Type":"application/json"},body}).catch(()=>null);
    if(res&&res.ok){const d=await res.json();const img=(d.candidates?.[0]?.content?.parts??[]).find(x=>x.inlineData)?.inlineData?.data;if(img)return Buffer.from(img,"base64");}
    else if(res&&![429,500,502,503,504].includes(res.status))throw new Error(`Gemini ${res.status}`);
    await new Promise(r=>setTimeout(r,3000*a));}
  throw new Error("fail");}
for(const [n,st] of Object.entries(STYLES)){process.stdout.write(`  ${n} ... `);
  try{fs.writeFileSync(path.join(OUT,`bn_${n}.png`),await gemini(`${st} ${SCENE}`));console.log("ok");}catch(e){console.log("FAIL",e.message);}}
console.log("done");
