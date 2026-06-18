/**
 * bloom focus — pinterest-image-generator.js
 * Takes the pins JSON and produces finished Pinterest pins:
 *   1. Generates a photo background via Nano Banana (2:3)
 *   2. Overlays the overlayTitle (top) + CTA + bloomfocus.org (bottom)
 *   3. Saves finished 1000x1500 pin
 *
 * Usage:
 *   node bloom/pinterest-image-generator.js --week=29
 *   node bloom/pinterest-image-generator.js --week=29 --limit=3   (test first 3)
 */

import 'dotenv/config';
import { GoogleGenAI } from "@google/genai";
import sharp from "sharp";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, "..");
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const args = Object.fromEntries(
  process.argv.slice(2).filter((a) => a.startsWith("--"))
    .map((a) => { const [k, v] = a.slice(2).split("="); return [k, v ?? true]; })
);
const WEEK = args.week ? parseInt(args.week) : null;
const LIMIT = args.limit ? parseInt(args.limit) : null;
if (!WEEK) { console.error("❌ --week required"); process.exit(1); }

const W = 1000, H = 1500;

// ─── Load pins ────────────────────────────────────────────────────────────────
function loadPins(week) {
  const p = path.join(REPO_ROOT, `pinterest_week_${week}.json`);
  if (!fs.existsSync(p)) throw new Error(`pinterest_week_${week}.json not found. Run pinterest-generator first.`);
  return JSON.parse(fs.readFileSync(p, "utf-8"));
}

// ─── Generate photo background via Nano Banana ───────────────────────────────
async function generateBackground(prompt) {
  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash-image",
    contents: prompt + "\n\nVertical 2:3 portrait aspect ratio.",
  });
  const parts = response.candidates?.[0]?.content?.parts ?? [];
  for (const part of parts) {
    if (part.inlineData?.data) return Buffer.from(part.inlineData.data, "base64");
  }
  throw new Error("No image from Nano Banana");
}

// ─── Escape text for SVG ──────────────────────────────────────────────────────
function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// ─── Wrap text into lines (rough word wrap) ──────────────────────────────────
function wrapText(text, maxChars) {
  const words = text.split(" ");
  const lines = [];
  let line = "";
  for (const w of words) {
    if ((line + " " + w).trim().length > maxChars) {
      if (line) lines.push(line.trim());
      line = w;
    } else {
      line = (line + " " + w).trim();
    }
  }
  if (line) lines.push(line.trim());
  return lines;
}

// ─── Build SVG overlay (top headline plate + bottom CTA) ─────────────────────
function buildOverlay(overlayTitle, cta) {
  const titleLines = wrapText(overlayTitle, 18);
  const lineHeight = 92;
  const titleBlockH = titleLines.length * lineHeight + 60;

  const titleTspans = titleLines.map((ln, i) =>
    `<tspan x="${W/2}" dy="${i === 0 ? 0 : lineHeight}">${esc(ln)}</tspan>`
  ).join("");

  return Buffer.from(`
<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="topfade" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="rgba(40,30,50,0.30)"/>
      <stop offset="100%" stop-color="rgba(40,30,50,0)"/>
    </linearGradient>
    <linearGradient id="botfade" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="rgba(40,30,50,0)"/>
      <stop offset="100%" stop-color="rgba(40,30,50,0.55)"/>
    </linearGradient>
  </defs>

  <!-- subtle gradients for readability -->
  <rect x="0" y="0" width="${W}" height="420" fill="url(#topfade)"/>
  <rect x="0" y="${H-360}" width="${W}" height="360" fill="url(#botfade)"/>

  <!-- headline plate -->
  <rect x="70" y="80" width="${W-140}" height="${titleBlockH}" rx="24" fill="rgba(255,248,240,0.94)"/>
  <text x="${W/2}" y="${150 + lineHeight*0.3}" font-family="Georgia, serif" font-size="72" font-weight="700"
        fill="#3d2c6e" text-anchor="middle" style="letter-spacing:-1px;">
    ${titleTspans}
  </text>

  <!-- CTA bottom -->
  <text x="${W/2}" y="${H-150}" font-family="Helvetica, Arial, sans-serif" font-size="44" font-weight="600"
        fill="#ffffff" text-anchor="middle">${esc(cta)}</text>
  <text x="${W/2}" y="${H-90}" font-family="Helvetica, Arial, sans-serif" font-size="34" font-weight="500"
        fill="rgba(255,255,255,0.9)" text-anchor="middle">bloomfocus.org</text>
</svg>`);
}

// ─── Build INFOGRAPHIC overlay (headline + numbered list) ────────────────────
function buildInfographicOverlay(headline, items, cta) {
  const headLines = wrapText(headline, 16);
  const headLH = 88;
  const headBlockH = headLines.length * headLH + 50;

  const headTspans = headLines.map((ln, i) =>
    `<tspan x="${W/2}" dy="${i === 0 ? 0 : headLH}">${esc(ln)}</tspan>`
  ).join("");

  // List items as rows with numbered chips
  const listStartY = 120 + headBlockH + 60;
  const rowH = 130;
  const safeItems = (items ?? []).slice(0, 5);

  const itemRows = safeItems.map((item, i) => {
    const y = listStartY + i * rowH;
    const itemLines = wrapText(item, 24);
    const itemTspans = itemLines.map((ln, j) =>
      `<tspan x="210" dy="${j === 0 ? 0 : 46}">${esc(ln)}</tspan>`
    ).join("");
    return `
      <circle cx="135" cy="${y - 14}" r="38" fill="#9B7FD4"/>
      <text x="135" y="${y}" font-family="Georgia, serif" font-size="44" font-weight="700"
            fill="#ffffff" text-anchor="middle">${i + 1}</text>
      <text x="210" y="${y - 8}" font-family="Helvetica, Arial, sans-serif" font-size="40" font-weight="600"
            fill="#2a2438">${itemTspans}</text>`;
  }).join("");

  const panelH = listStartY + safeItems.length * rowH - 40;

  return Buffer.from(`
<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="botfade" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="rgba(40,30,50,0)"/>
      <stop offset="100%" stop-color="rgba(40,30,50,0.5)"/>
    </linearGradient>
  </defs>

  <!-- semi-transparent panel for the list -->
  <rect x="50" y="70" width="${W-100}" height="${panelH}" rx="32" fill="rgba(255,248,240,0.93)"/>

  <!-- headline -->
  <text x="${W/2}" y="${150 + headLH*0.3}" font-family="Georgia, serif" font-size="68" font-weight="700"
        fill="#3d2c6e" text-anchor="middle" style="letter-spacing:-1px;">
    ${headTspans}
  </text>

  <!-- divider -->
  <rect x="${W/2 - 60}" y="${130 + headBlockH}" width="120" height="5" rx="3" fill="#9B7FD4"/>

  <!-- list items -->
  ${itemRows}

  <!-- CTA bottom -->
  <rect x="0" y="${H-200}" width="${W}" height="200" fill="url(#botfade)"/>
  <text x="${W/2}" y="${H-120}" font-family="Helvetica, Arial, sans-serif" font-size="40" font-weight="600"
        fill="#ffffff" text-anchor="middle">${esc(cta)}</text>
  <text x="${W/2}" y="${H-70}" font-family="Helvetica, Arial, sans-serif" font-size="32" font-weight="500"
        fill="rgba(255,255,255,0.9)" text-anchor="middle">bloomfocus.org</text>
</svg>`);
}

// ─── Compose one finished pin ────────────────────────────────────────────────
async function buildPin(pin, outDir) {
  const filename = `${pin.id}.png`;
  const outPath = path.join(outDir, filename);

  // 1. Generate background
  const bgBuffer = await generateBackground(pin.imagePrompt);

  // 2. Resize/crop to exactly 1000x1500
  const bg = await sharp(bgBuffer).resize(W, H, { fit: "cover", position: "centre" }).toBuffer();

  // 3. Overlay — infographic (list) or hook (headline) depending on type
  const shortCta = { quiz: "Take the free quiz", app: "Try the free app", etsy: "Shop on Etsy", blog: "Read more" }[pin.funnel] ?? "Learn more";

  let overlay;
  if (pin.pinType === "infographic" && Array.isArray(pin.items)) {
    overlay = buildInfographicOverlay(pin.headline ?? pin.title, pin.items, shortCta);
  } else {
    overlay = buildOverlay(pin.overlayTitle ?? pin.title, shortCta);
  }

  await sharp(bg)
    .composite([{ input: overlay, top: 0, left: 0 }])
    .png()
    .toFile(outPath);

  return outPath;
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n📌 bloom focus — Pinterest pins with text overlay — Week ${WEEK}\n${"━".repeat(50)}`);

  let pins = loadPins(WEEK);
  if (LIMIT) pins = pins.slice(0, LIMIT);

  const outDir = path.join(REPO_ROOT, `output/pinterest/week_${WEEK}`);
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  console.log(`📋 ${pins.length} pins to build\n`);

  let done = 0, failed = 0;
  for (let i = 0; i < pins.length; i++) {
    const pin = pins[i];
    const label = pin.pinType === "infographic" ? (pin.headline ?? pin.title) : (pin.overlayTitle ?? pin.title);
    process.stdout.write(`   [${i+1}/${pins.length}] ${pin.id} (${pin.funnel}/${pin.pinType ?? "hook"}) "${label}"... `);
    try {
      await buildPin(pin, outDir);
      done++;
      console.log("✓");
      await new Promise((r) => setTimeout(r, 600));
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

main().catch((err) => { console.error("\n❌ pinterest-image-generator failed:", err.message); process.exit(1); });
