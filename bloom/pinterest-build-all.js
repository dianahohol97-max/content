/**
 * bloom focus — pinterest-build-all.js
 * Master Pinterest image builder. Routes each pin to the right engine:
 *   - infographic pins → Gemini (full image with list + text)
 *   - hook + product pins → Gemini Nano Banana photo + text overlay — cheaper
 *
 * Usage:
 *   node bloom/pinterest-build-all.js --week=29
 *   node bloom/pinterest-build-all.js --week=29 --day=1   (one day only)
 *   node bloom/pinterest-build-all.js --week=29 --limit=5
 */

import 'dotenv/config';
import { GoogleGenAI } from "@google/genai";
import sharp from "sharp";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, "..");
const gemini = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const args = Object.fromEntries(
  process.argv.slice(2).filter((a) => a.startsWith("--"))
    .map((a) => { const [k, v] = a.slice(2).split("="); return [k, v ?? true]; })
);
const WEEK = args.week ? parseInt(args.week) : null;
const DAY = args.day ? parseInt(args.day) : null;
const LIMIT = args.limit ? parseInt(args.limit) : null;
const SKIP_EXISTING = args["skip-existing"] === true || args["skip-existing"] === "true";
if (!WEEK) { console.error("❌ --week required"); process.exit(1); }

const W = 1000, H = 1500;

function loadPins(week) {
  const p = path.join(REPO_ROOT, `pinterest_week_${week}.json`);
  if (!fs.existsSync(p)) throw new Error(`pinterest_week_${week}.json not found.`);
  return JSON.parse(fs.readFileSync(p, "utf-8"));
}

// ═══ Gemini infographic (full image with text + list, cropped to 2:3) ════════
async function buildInfographic(pin, outDir) {
  const outPath = path.join(outDir, `${pin.id}.png`);
  const items = pin.items ?? [];
  const itemsText = items.map((it, i) => `${i + 1}. ${it}`).join("\n");
  const count = items.length;
  // Infographics use a 4:5 portrait frame (1080x1350) — a gentler vertical
  // ratio that Gemini fills more naturally than a tall 2:3, so less normalizing
  // is needed and the layout looks less stretched.
  const IW = 1080, IH = 1350;
  const prompt = `Create a clean, professional Pinterest infographic in a soft pastel aesthetic for an ADHD wellness brand.

TITLE at top (large, bold, friendly rounded font): "${pin.headline}"

A vertical numbered list with EXACTLY ${count} items, each with a numbered circle badge (1 through ${count} IN CORRECT ORDER) and a small matching pastel icon:
${itemsText}

STYLE: soft pastel palette (lavender #E8DEFF, cream #FFF8F0, sage green #D4E8D4, blush pink #FFD4E4, sky blue #D4EEFF), cute minimal flat icons, rounded friendly legible sans-serif, PERFECT SPELLING, soft decorative elements (stars, leaves, hearts), warm supportive feeling, small "bloomfocus.org" at bottom center. Flat vector illustration style, NO photos, NO dark colors.

LAYOUT: Keep ALL content (title, full numbered list, footer) safely centered with comfortable margin at top and bottom so nothing is near the edges. Portrait 4:5 aspect ratio (taller than wide, but not extremely tall). Every number 1-${count} present in order, every word correctly spelled.`;

  const response = await gemini.models.generateContent({
    model: "gemini-2.5-flash-image",
    contents: prompt,
  });
  const parts = response.candidates?.[0]?.content?.parts ?? [];
  for (const part of parts) {
    if (part.inlineData?.data) {
      const raw = Buffer.from(part.inlineData.data, "base64");

      // Normalize to exact 4:5 (1080x1350) without cropping the title:
      // scale to full width, then pad the bottom (or lightly crop if too tall).
      const scaled = await sharp(raw).resize({ width: IW }).toBuffer();
      const meta = await sharp(scaled).metadata();

      if (meta.height >= IH) {
        await sharp(scaled).extract({ left: 0, top: 0, width: IW, height: IH }).png().toFile(outPath);
      } else {
        const strip = await sharp(scaled)
          .extract({ left: 0, top: meta.height - 6, width: IW, height: 6 })
          .resize(1, 1).raw().toBuffer();
        const [r, g, b] = [strip[0], strip[1], strip[2]];
        await sharp(scaled)
          .extend({ top: 0, bottom: IH - meta.height, left: 0, right: 0,
                    background: { r, g, b, alpha: 1 } })
          .png().toFile(outPath);
      }
      return outPath;
    }
  }
  throw new Error("No Gemini infographic image");
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

function buildHookOverlay(overlayTitle, signs, cta) {
  const titleLines = wrapText(overlayTitle, 18);
  const lineHeight = 92;
  const titleBlockH = titleLines.length * lineHeight + 60;
  const titleTspans = titleLines.map((ln, i) =>
    `<tspan x="${W/2}" dy="${i === 0 ? 0 : lineHeight}">${esc(ln)}</tspan>`).join("");

  // Recognition signs — checkmark list under the title, each in its own pill
  const signList = Array.isArray(signs) ? signs.slice(0, 3) : [];
  const signStartY = 80 + titleBlockH + 40;
  const signGap = 96;
  const signBlocks = signList.map((s, i) => {
    const y = signStartY + i * signGap;
    return `<rect x="120" y="${y}" width="${W-240}" height="76" rx="38" fill="rgba(255,248,240,0.92)"/>
      <text x="172" y="${y + 52}" font-family="Helvetica, Arial, sans-serif" font-size="42" font-weight="700" fill="#7c6bb0" text-anchor="start">✓</text>
      <text x="226" y="${y + 51}" font-family="Helvetica, Arial, sans-serif" font-size="40" font-weight="600" fill="#3d2c6e" text-anchor="start">${esc(s)}</text>`;
  }).join("");

  return Buffer.from(`
<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="botfade" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="rgba(40,30,50,0)"/>
      <stop offset="100%" stop-color="rgba(40,30,50,0.6)"/>
    </linearGradient>
  </defs>
  <rect x="0" y="${H-360}" width="${W}" height="360" fill="url(#botfade)"/>
  <rect x="70" y="80" width="${W-140}" height="${titleBlockH}" rx="24" fill="rgba(255,248,240,0.94)"/>
  <text x="${W/2}" y="${150 + lineHeight*0.3}" font-family="Georgia, serif" font-size="72" font-weight="700"
        fill="#3d2c6e" text-anchor="middle" style="letter-spacing:-1px;">${titleTspans}</text>
  ${signBlocks}
  <text x="${W/2}" y="${H-150}" font-family="Helvetica, Arial, sans-serif" font-size="46" font-weight="700"
        fill="#ffffff" text-anchor="middle">${esc(cta)}</text>
  <text x="${W/2}" y="${H-90}" font-family="Helvetica, Arial, sans-serif" font-size="34" font-weight="500"
        fill="rgba(255,255,255,0.9)" text-anchor="middle">bloomfocus.org</text>
</svg>`);
}

function buildMemeOverlay(memeText) {
  // memeText may contain \n for setup/punchline. Wrap each line to width.
  const rawLines = String(memeText).split("\n");
  const lines = [];
  for (const rl of rawLines) {
    for (const w of wrapText(rl, 22)) lines.push(w);
  }
  const fontSize = lines.length > 4 ? 64 : 76;
  const lineHeight = fontSize * 1.25;
  const blockH = lines.length * lineHeight;
  const startY = (H - blockH) / 2 + fontSize * 0.7;
  const tspans = lines.map((ln, i) =>
    `<tspan x="${W/2}" dy="${i === 0 ? 0 : lineHeight}">${esc(ln)}</tspan>`).join("");
  // soft panel behind text for readability
  const panelY = startY - fontSize - 30;
  const panelH = blockH + 90;
  return Buffer.from(`
<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <rect x="60" y="${panelY}" width="${W-120}" height="${panelH}" rx="32" fill="rgba(255,248,240,0.9)"/>
  <text x="${W/2}" y="${startY}" font-family="Georgia, serif" font-size="${fontSize}" font-weight="700"
        fill="#3d2c6e" text-anchor="middle" style="letter-spacing:-0.5px;">${tspans}</text>
  <text x="${W/2}" y="${H-80}" font-family="Helvetica, Arial, sans-serif" font-size="34" font-weight="600"
        fill="#7c6bb0" text-anchor="middle">bloomfocus.org</text>
</svg>`);
}

async function buildMeme(pin, outDir) {
  const outPath = path.join(outDir, `${pin.id}.png`);
  const bgBuffer = await geminiBackground(pin.imagePrompt);
  const bg = await sharp(bgBuffer).resize(W, H, { fit: "cover", position: "centre" }).toBuffer();
  const overlay = buildMemeOverlay(pin.memeText ?? pin.overlayTitle ?? pin.title);
  await sharp(bg).composite([{ input: overlay, top: 0, left: 0 }]).png().toFile(outPath);
  return outPath;
}

async function buildHookOrProduct(pin, outDir) {
  const outPath = path.join(outDir, `${pin.id}.png`);
  const bgBuffer = await geminiBackground(pin.imagePrompt);
  const bg = await sharp(bgBuffer).resize(W, H, { fit: "cover", position: "centre" }).toBuffer();
  const shortCta = { quiz: "Take the ADHD test →", app: "Try the free app →", etsy: "Shop on Etsy →", blog: "Read more →" }[pin.funnel] ?? "Learn more →";
  const overlay = buildHookOverlay(pin.overlayTitle ?? pin.title, pin.overlaySigns, shortCta);
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
  console.log(`📋 ${pins.length} pins (${infoCount} infographic + ${pins.length - infoCount} hook/product, all via Gemini)\n`);

  const REPO_RAW = "https://raw.githubusercontent.com/dianahohol97-max/content/main";

  let done = 0, failed = 0, skipped = 0;
  for (let i = 0; i < pins.length; i++) {
    const pin = pins[i];
    const engine = pin.pinType === "infographic" ? "Gemini-info" : "Gemini-photo";
    const label = pin.pinType === "infographic" ? pin.headline
      : pin.pinType === "meme" ? pin.memeText?.replace(/\n/g, " ")
      : pin.overlayTitle;
    const imgPath = path.join(outDir, `${pin.id}.png`);

    // Skip if image already exists and is non-empty
    if (SKIP_EXISTING && fs.existsSync(imgPath) && fs.statSync(imgPath).size > 1000) {
      pin.imageUrl = `${REPO_RAW}/output/pinterest/week_${WEEK}/${pin.id}.png`;
      skipped++;
      console.log(`   [${i+1}/${pins.length}] ${pin.id} — already exists, skipped`);
      continue;
    }

    process.stdout.write(`   [${i+1}/${pins.length}] ${pin.id} (${engine}) "${label}"... `);
    try {
      if (pin.pinType === "infographic") await buildInfographic(pin, outDir);
      else if (pin.pinType === "meme") await buildMeme(pin, outDir);
      else await buildHookOrProduct(pin, outDir);
      // Record the public GitHub raw URL of the finished image into the pin
      pin.imageUrl = `${REPO_RAW}/output/pinterest/week_${WEEK}/${pin.id}.png`;
      done++;
      console.log("✓");
      await new Promise((r) => setTimeout(r, 800));
    } catch (err) {
      failed++;
      console.log(`✗ ${err.message}`);
    }
  }

  // Rewrite the full week JSON with imageUrl fields filled in
  const allPins = loadPins(WEEK);
  const builtById = Object.fromEntries(pins.filter(p => p.imageUrl).map(p => [p.id, p.imageUrl]));
  for (const p of allPins) {
    if (builtById[p.id]) p.imageUrl = builtById[p.id];
  }
  const jsonPath = path.join(REPO_ROOT, `pinterest_week_${WEEK}.json`);
  fs.writeFileSync(jsonPath, JSON.stringify(allPins, null, 2), "utf8");
  console.log(`   📝 Updated ${jsonPath} with image URLs`);

  console.log(`\n${"━".repeat(50)}`);
  console.log(`✅ Built: ${done}, Skipped: ${skipped}, Failed: ${failed}`);
  console.log(`   📁 output/pinterest/week_${WEEK}/`);
  console.log(`${"━".repeat(50)}\n`);
}

main().catch((err) => { console.error("\n❌ build-all failed:", err.message); process.exit(1); });
