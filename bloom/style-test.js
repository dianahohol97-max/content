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
  S1_soft3d: `Soft 3D render in the style of premium wellness app illustrations (like Headspace or Calm): smooth rounded clay-like forms, matte materials, gentle studio lighting, soft shadows. Palette: lavender, blush pink, sage green, cream, with deep violet accents. Calm, premium, modern, adult. No people, no faces, no text, no letters. Vertical 9:16 composition.`,
  S2_flatgrain: `Modern flat illustration with grain shading, contemporary editorial style popular in mental-health media: bold simple shapes, subtle noise texture on shadows, warm sophisticated palette of lavender, blush, sage, cream and deep violet. Stylish, warm, adult. No people, no faces, no text, no letters. Vertical 9:16 composition.`,
  S3_collage: `Paper collage mixed-media illustration: torn and cut paper layers in lavender, blush pink, sage green and cream, visible paper texture and soft drop shadows, Matisse-inspired organic shapes, a few hand-drawn ink details. Artistic, tactile, adult. No people, no faces, no text, no letters. Vertical 9:16 composition.`,
  S4_lineart: `Elegant minimal line art: confident continuous ink lines in deep violet on warm cream paper, with soft washes of lavender, blush and sage as sparse color accents. Generous negative space, sophisticated and calm, high-end wellness brand aesthetic. No people, no faces, no text, no letters. Vertical 9:16 composition.`,
  S5_gouache: `Matte gouache painting, mid-century modern illustration style for adults: visible brush texture, muted pastel palette of lavender, dusty blush, sage and cream with deep violet shadows, simplified elegant shapes, warm evening atmosphere. Sophisticated, cozy but grown-up. No people, no faces, no text, no letters. Vertical 9:16 composition.`,
  S6_dreamy: `Dreamy soft airbrush illustration: smooth gradients of lavender, blush and sky blue, gentle glow, slightly surreal floating objects, soft depth of field, calm ethereal atmosphere. Modern, soothing, adult. No people, no faces, no text, no letters. Vertical 9:16 composition.`,
};

const SCENES = {
  desk: `A desk with a steaming coffee cup and an open notebook beside a window with soft evening light.`,
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
