import "dotenv/config";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const OUT = path.join(REPO_ROOT, "output", "style-tests");
fs.mkdirSync(OUT,{recursive:true});
const BASE="Moody atmospheric editorial illustration, cinematic low light, deep shadows and restrained muted colour, sophisticated grown-up melancholy, subtle film-grain texture. Deep violet, charcoal, dusty rose, hints of cream. NO people, no figures, no faces, no text, no letters. Clear open area for caption. NOT cheerful, NOT cute, NOT pastel-bright. Vertical 9:16."; const SCENES={"emotional": "Concept: mental exhaustion at the end of a long day. An empty unmade bed lit only by phone glow in a dark room.", "practical": "Concept: a small calm moment of control returning. A single desk lamp switched on over a tidy notebook in a dim room, warm pool of light. Slightly lighter and more hopeful mood while keeping the cinematic style.", "object": "Concept: morning routine. A coffee cup and keys on a table by a window at dawn, soft low light."};
async function gemini(p){
  const key=process.env.GEMINI_API_KEY;
  const url=`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent?key=${key}`;
  const body=JSON.stringify({contents:[{parts:[{text:p}]}]});
  for(let a=1;a<=5;a++){const res=await fetch(url,{method:"POST",headers:{"Content-Type":"application/json"},body}).catch(()=>null);
    if(res&&res.ok){const d=await res.json();const img=(d.candidates?.[0]?.content?.parts??[]).find(x=>x.inlineData)?.inlineData?.data;if(img)return Buffer.from(img,"base64");}
    else if(res&&![429,500,502,503,504].includes(res.status))throw new Error(`Gemini ${res.status}`);
    await new Promise(r=>setTimeout(r,3000*a));}
  throw new Error("fail");
}
for(const [n,sc] of Object.entries(SCENES)){process.stdout.write(`  ${n} ... `);
  try{fs.writeFileSync(path.join(OUT,`noir_${n}.png`),await gemini(`${BASE} ${sc}`));console.log("ok");}catch(e){console.log("FAIL",e.message);}}
console.log("done");
