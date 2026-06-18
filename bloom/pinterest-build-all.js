/**
 * bloom focus — pinterest-build-all.js
 * Master Pinterest image builder. Routes each pin to the right engine:
 *   - infographic pins → DALL-E (gpt-image-1) — needs crisp text
 *   - hook + product pins → Gemini Nano Banana photo + text overlay — cheaper
 *
 * Usage:
 *   node bloom/pinterest-build-all.js --week=29
 *   node bloom/pinterest-build-all.js --week=29 --day=1   (one day only)
 *   node bloom/pinterest-build-all.js --week=29 --limit=5
 */

import 'dotenv/config';
import OpenAI from "openai";
import { GoogleGenAI } from "@google/genai";
import sharp from "sharp";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, "..");
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const gemini = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const args = Object.fromEntries(
  process.argv.slice(2).filter((a) => a.startsWith("--"))
    .map((a) => { const [k, v] = a.slice(2).split("="); return [k, v ?? true]; })
);
const WEEK = args.week ? parseInt(args.week) : null;
const DAY = args.day ? parseInt(args.day) : null;
const LIMIT = args.limit ? parseInt(args.limit) : null;
if (!WEEK) { console.error("❌ --week required"); process.exit(1); }

const W = 1000, H = 1500;

function loadPins(week) {
  const p = path.join(REPO_ROOT, `pinterest_week_${week}.json`);
  if (!fs.existsSync(p)) throw new Error(`pinterest_week_${week}.json not found.`);
  return JSON.parse(fs.readFileSync(p, "utf-8"));
}

// ═══ DALL-E infographic ═══════════════════════════════════════════════════════
function buildInfographicPrompt(pin) {
  const items = pin.items ?? [];
  const itemsText = items.map((it, i) => `${i + 1}. ${it}`).join("\n");
  const count = items.length;
  return `A clean professional Pinterest infographic, soft pastel aesthetic, for an ADHD wellness brand.

TITLE at top (large bold friendly rounded font): "${pin.headline}"

A vertical numbered list with EXACTLY ${count} items. Each has a numbered circle badge on the left (numbered 1 through ${count} IN ORDER), text in the middle, and a small pastel icon on the right:
${itemsText}

CRITICAL: badges read 1, 2, 3${count>=4?", 4":""}${count>=5?", 5":""} in perfect sequence. Every item numbered, none skipped or repeated.

STYLE: soft pastel palette (lavender, cream, sage, blush, light blue), cute flat icons, rounded legible sans-serif, perfect spelling, soft decor (stars, leaves), warm supportive feeling, small "bloomfocus.org" at bottom center, vertical 2:3, all text crisp and correctly spelled. Polished Canva-style design an adult ADHD woman would save.`;
}

async function buildInfographic(pin, outDir) {
  const outPath = path.join(outDir, `${pin.id}.png`);
  const result = await openai.images.generate({
    model: "gpt-image-1",
    prompt: buildInfographicPrompt(pin),
    size: "1024x1536",
    quality: "high",
  });
  const b64 = result.data[0].b64_json;
  if (!b64) throw new Error("No DALL-E image");
  fs.writeFileSync(outPath, Buffer.from(b64, "base64"));
  return outPath;
}

// ═══ Gemini photo + overlay (hooks & products) ═══════════════════════════════
async function geminiBackground(prompt) {
  const response = await gemini.models.generateContent({
    model: "gemini-2.5-flash-image",
    contents: prompt + "\n\nVertical 2:3 portrait aspect ratio.",
  });
  const parts = response.candidates?.[0]?.content?.parts ?? [];
  for (const part of parts) {
    if (part.inlineData?.data) return Buffer.from(part.inlineData.data, "base64");
  }
  throw new Error("No Gemini image");
}

function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function wrapText(text, maxChars) {
  const words = String(text).split(" ");
  const lines = []; let line = "";
  for (const w of words) {
    if ((line + " " + w).trim().length > maxChars) { if (line) lines.push(line.trim()); line = w; }
    else line = (line + " " + w).trim();
  }
  if (line) lines.push(line.trim());
  return lines;
}

function buildHookOverlay(overlayTitle, cta) {
  const titleLines = wrapText(overlayTitle, 18);
  const lineHeight = 92;
  const titleBlockH = titleLines.length * lineHeight + 60;
  const titleTspans = titleLines.map((ln, i) =>
    `<tspan x="${W/2}" dy="${i === 0 ? 0 : lineHeight}">${esc(ln)}</tspan>`).join("");
  return Buffer.from(`
<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="botfade" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="rgba(40,30,50,0)"/>
      <stop offset="100%" stop-color="rgba(40,30,50,0.55)"/>
    </linearGradient>
  </defs>
  <rect x="0" y="${H-360}" width="${W}" height="360" fill="url(#botfade)"/>
  <rect x="70" y="80" width="${W-140}" height="${titleBlockH}" rx="24" fill="rgba(255,248,240,0.94)"/>
  <text x="${W/2}" y="${150 + lineHeight*0.3}" font-family="Georgia, serif" font-size="72" font-weight="700"
        fill="#3d2c6e" text-anchor="middle" style="letter-spacing:-1px;">${titleTspans}</text>
  <text x="${W/2}" y="${H-150}" font-family="Helvetica, Arial, sans-serif" font-size="44" font-weight="600"
        fill="#ffffff" text-anchor="middle">${esc(cta)}</text>
  <text x="${W/2}" y="${H-90}" font-family="Helvetica, Arial, sans-serif" font-size="34" font-weight="500"
        fill="rgba(255,255,255,0.9)" text-anchor="middle">bloomfocus.org</text>
</svg>`);
}

async function buildHookOrProduct(pin, outDir) {
  const outPath = path.join(outDir, `${pin.id}.png`);
  const bgBuffer = await geminiBackground(pin.imagePrompt);
  const bg = await sharp(bgBuffer).resize(W, H, { fit: "cover", position: "centre" }).toBuffer();
  const shortCta = { quiz: "Take the free quiz", app: "Try the free app", etsy: "Shop on Etsy", blog: "Read more" }[pin.funnel] ?? "Learn more";
  const overlay = buildHookOverlay(pin.overlayTitle ?? pin.title, shortCta);
  await sharp(bg).composite([{ input: overlay, top: 0, left: 0 }]).png().toFile(outPath);
  return outPath;
}

// ═══ Main ═════════════════════════════════════════════════════════════════════
async function main() {
  console.log(`\n📌 bloom focus — Pinterest build all — Week ${WEEK}\n${"━".repeat(50)}`);

  let pins = loadPins(WEEK);
  if (DAY) pins = pins.filter((p) => p.day === DAY);
  if (LIMIT) pins = pins.slice(0, LIMIT);

  const outDir = path.join(REPO_ROOT, `output/pinterest/week_${WEEK}`);
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const infoCount = pins.filter((p) => p.pinType === "infographic").length;
  console.log(`📋 ${pins.length} pins (${infoCount} infographic→DALL-E, ${pins.length - infoCount} photo→Gemini)\n`);

  let done = 0, failed = 0;
  for (let i = 0; i < pins.length; i++) {
    const pin = pins[i];
    const engine = pin.pinType === "infographic" ? "DALL-E" : "Gemini";
    const label = pin.pinType === "infographic" ? pin.headline : pin.overlayTitle;
    process.stdout.write(`   [${i+1}/${pins.length}] ${pin.id} (${engine}) "${label}"... `);
    try {
      if (pin.pinType === "infographic") await buildInfographic(pin, outDir);
      else await buildHookOrProduct(pin, outDir);
      done++;
      console.log("✓");
      await new Promise((r) => setTimeout(r, 800));
    } catch (err) {
      failed++;
      console.log(`✗ ${err.message}`);
    }
  }

  console.log(`\n${"━".repeat(50)}`);
  console.log(`✅ Built: ${done}, Failed: ${failed}`);
  console.log(`   📁 output/pinterest/week_${WEEK}/`);
  console.log(`${"━".repeat(50)}\n`);
}

main().catch((err) => { console.error("\n❌ build-all failed:", err.message); process.exit(1); });
