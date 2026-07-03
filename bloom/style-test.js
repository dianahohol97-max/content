import "dotenv/config";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const OUT = path.join(REPO_ROOT, "output", "style-tests");
fs.mkdirSync(OUT, { recursive: true });
const STYLE = "Bold graphic illustration, thick confident outlines, flat vivid fills, playful modern poster style. Palette: lavender, blush pink, sage green, cream, deep violet. No people, no text. Vertical 9:16.";
const SCENES = {"bold_desk": "A cozy desk by a window with a steaming coffee cup and an open notebook.", "bold_brain": "An abstract brain shown as a tangle of glowing threads slowly untangling into calm lines.", "bold_clock": "A melting surreal clock dripping over the edge of a table, symbolising lost track of time."};
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
    } else if (res && ![429,500,502,503,504].includes(res.status)) throw new Error(`Gemini ${res.status}`);
    await new Promise(r => setTimeout(r, 3000 * a));
  }
  throw new Error("gemini failed");
}
for (const [name, scene] of Object.entries(SCENES)) {
  process.stdout.write(`  ${name} ... `);
  try { fs.writeFileSync(path.join(OUT, `${name}.png`), await gemini(`${STYLE} ${scene}`)); console.log("ok"); }
  catch (e) { console.log("FAIL", e.message); }
}
console.log("done");
