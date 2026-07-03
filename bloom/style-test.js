import "dotenv/config";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const OUT = path.join(REPO_ROOT, "output", "style-tests");
fs.mkdirSync(OUT, { recursive: true });

const STYLES = {"01_flat_vector": "Clean flat vector illustration, modern corporate-memphis style, bold simple shapes, minimal detail, flat colors with no gradients. Palette: lavender, blush pink, sage green, cream, deep violet. No people, no text. Vertical 9:16.", "02_soft_3d": "Soft 3D clay render, rounded matte forms, gentle soft studio lighting and shadows, premium wellness-app aesthetic like Headspace. Palette lavender, blush, sage, cream, violet. No people, no text. Vertical 9:16.", "03_textured_flat": "Flat illustration with subtle grain and paper texture, warm editorial style used in modern mental-health media, soft shadows. Lavender, blush, sage, cream, deep violet. No people, no text. Vertical 9:16.", "04_cutout_collage": "Paper cut-out collage, layered torn paper shapes with soft drop shadows, Matisse-inspired organic forms. Lavender, blush, sage, cream, violet. No people, no text. Vertical 9:16.", "05_gouache": "Soft gouache painting, visible brush texture, muted pastel palette, mid-century modern shapes, cozy warm mood. Lavender, dusty blush, sage, cream, violet shadows. No people, no text. Vertical 9:16.", "06_dreamy_gradient": "Dreamy soft airbrush illustration, smooth glowing gradients, slightly surreal floating objects, ethereal calm. Lavender, blush, sky blue, cream. No people, no text. Vertical 9:16.", "07_bold_graphic": "Bold graphic illustration, thick confident outlines, flat vivid fills, playful modern poster style. Lavender, blush, sage, cream, deep violet. No people, no text. Vertical 9:16.", "08_minimal_abstract": "Minimal abstract illustration, few simple geometric shapes, lots of negative space, calm and sophisticated, gallery-poster feel. Lavender, blush, sage, cream, deep violet. No people, no text. Vertical 9:16."};
const SCENE = "A cozy desk by a window at soft evening light, with a steaming coffee cup and an open notebook.";

async function gemini(prompt) {
  const key = process.env.GEMINI_API_KEY;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent?key=${key}`;
  const body = JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] });
  for (let a = 1; a <= 5; a++) {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body }).catch(() => null);
    if (res && res.ok) {
      const data = await res.json();
      const img = (data.candidates?.[0]?.content?.parts ?? []).find(p => p.inlineData)?.inlineData?.data;
      if (img) return Buffer.from(img, "base64");
    } else if (res && ![429,500,502,503,504].includes(res.status)) {
      throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0,160)}`);
    }
    await new Promise(r => setTimeout(r, 3000 * a));
  }
  throw new Error("gemini failed");
}

for (const [name, style] of Object.entries(STYLES)) {
  const p = path.join(OUT, `${name}.png`);
  process.stdout.write(`  ${name} ... `);
  try { fs.writeFileSync(p, await gemini(`${style} ${SCENE}`)); console.log("ok"); }
  catch (e) { console.log("FAIL", e.message); }
}
console.log("done");
