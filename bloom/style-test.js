import "dotenv/config";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const OUT = path.join(REPO_ROOT, "output", "style-tests");
fs.mkdirSync(OUT, { recursive: true });
const STYLES = {"A_newyorker": "Editorial illustration in the style of a sophisticated New Yorker or NYT Op-Ed piece. Restrained, conceptual, slightly melancholic, intelligent adult tone. Muted desaturated palette, textured shading, fine linework. NOT cute, NOT rounded, NOT childish, NOT kawaii. No mascots. Vertical 9:16.", "B_matisse": "Sophisticated matisse-inspired modern art print, bold cut organic shapes, confident abstract composition, gallery-quality, adult and artful. Muted lavender, terracotta, sage, cream. NOT cartoon, NOT cute, NOT simplistic clip-art. Vertical 9:16.", "C_muted_noir": "Moody atmospheric editorial illustration, cinematic low light, deep shadows and restrained muted colour, sophisticated grown-up melancholy, film-grain texture. Deep violet, charcoal, dusty rose. NOT cheerful, NOT cute, NOT pastel-bright. Vertical 9:16.", "D_risograph_grit": "Gritty risograph art print, heavy grain, bold limited-ink palette with intentional misregistration, indie art-zine aesthetic for adults, sophisticated and textured. Deep violet, coral, sage on cream. NOT clean vector, NOT cute, NOT childish. Vertical 9:16.", "E_woodcut": "Modern linocut / woodcut print illustration, strong carved lines, high-contrast graphic texture, artisanal and adult, contemporary gallery print. Deep violet ink on cream, sparse muted colour. NOT cartoon, NOT rounded-cute, NOT soft pastel. Vertical 9:16.", "F_abstract_conceptual": "Abstract conceptual editorial illustration, metaphorical and minimal, sophisticated use of negative space and single bold gesture, intelligent adult art-direction. Muted brand palette lavender/blush/sage/cream/deep violet. NOT literal, NOT cute, NOT busy, NOT childish. Vertical 9:16."};
const SCENE = "Concept: the feeling of time slipping away, lost hours, a day that vanished. Interpret conceptually, not literally.";
async function gemini(prompt) {
  const key = process.env.GEMINI_API_KEY;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent?key=${key}`;
  const body = JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] });
  for (let a=1;a<=5;a++){
    const res=await fetch(url,{method:"POST",headers:{"Content-Type":"application/json"},body}).catch(()=>null);
    if(res&&res.ok){const d=await res.json();const img=(d.candidates?.[0]?.content?.parts??[]).find(p=>p.inlineData)?.inlineData?.data;if(img)return Buffer.from(img,"base64");}
    else if(res&&![429,500,502,503,504].includes(res.status))throw new Error(`Gemini ${res.status}`);
    await new Promise(r=>setTimeout(r,3000*a));
  }
  throw new Error("fail");
}
for(const [name,style] of Object.entries(STYLES)){
  process.stdout.write(`  ${name} ... `);
  try{fs.writeFileSync(path.join(OUT,`concept_${name}.png`),await gemini(`${style} ${SCENE}`));console.log("ok");}
  catch(e){console.log("FAIL",e.message);}
}
console.log("done");
