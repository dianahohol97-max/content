/**
 * bloom focus — style-test.js
 * Renders the same scenes in candidate ART_STYLE variants for Diana to pick.
 * Output: output/style-tests/{style}_{scene}.png
 */
import "dotenv/config";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const OUT = path.join(REPO_ROOT, "output", "style-tests");
fs.mkdirSync(OUT, { recursive: true });

const STYLES = {
  A_editorial: `Modern editorial illustration for a serious magazine feature. Sophisticated muted palette: deep plum, dusty rose, ochre, slate blue, cream. Conceptual and metaphorical, bold organic shapes, visible grain and subtle print texture. Moody but warm, intelligent, adult. No people, no faces, no text, no letters. Vertical 9:16 composition.`,
  B_cinematic: `Atmospheric digital painting with cinematic lighting. Cozy moody interior, warm lamplight against deep dusk shadows, rich fabric and wood textures, soft film grain. Muted warm palette with lavender-dusk accents. Quiet, intimate, contemplative adult mood. No people, no faces, no text, no letters. Vertical 9:16 composition.`,
  C_risograph: `Risograph print illustration, limited palette of four inks: deep violet, coral, sage green, warm cream paper. Heavy grain, bold flat shapes with slight print misregistration, contemporary indie zine aesthetic. Stylish, adult, slightly surreal. No people, no faces, no text, no letters. Vertical 9:16 composition.`,
};

const SCENES = {
  desk: `A desk with a steaming coffee cup and an open notebook beside a window with evening light.`,
  brain: `An abstract brain made of tangled glowing threads slowly unraveling into calm lines.`,
};

async function gemini(prompt) {
  const key = process.env.GEMINI_API_KEY;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent?key=${key}`;
  const body = JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] });
  for (let attempt = 1; attempt <= 5; attempt++) {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body }).catch(() => null);
    if (res && res.ok) {
      const data = await res.json();
      const img = (data.candidates?.[0]?.content?.parts ?? []).find((p) => p.inlineData)?.inlineData?.data;
      if (img) return Buffer.from(img, "base64");
    } else if (res && ![429, 500, 502, 503, 504].includes(res.status)) {
      throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 160)}`);
    }
    await new Promise((r) => setTimeout(r, 3000 * attempt));
  }
  throw new Error("gemini failed after retries");
}

for (const [sName, sPrompt] of Object.entries(STYLES)) {
  for (const [scName, scene] of Object.entries(SCENES)) {
    const p = path.join(OUT, `${sName}_${scName}.png`);
    process.stdout.write(`  ${sName} / ${scName} ... `);
    try {
      fs.writeFileSync(p, await gemini(`${sPrompt} ${scene}`));
      console.log("✓");
    } catch (e) { console.log("✗", e.message); }
  }
}
console.log("done");
