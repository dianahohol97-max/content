/**
 * bloom focus — pinterest-infographic-gemini.js
 * TEST: generate full ADHD infographics via Gemini (Nano Banana)
 * instead of DALL-E, to compare text-rendering quality.
 *
 * Usage:
 *   node bloom/pinterest-infographic-gemini.js --week=29 --limit=3
 */

import 'dotenv/config';
import { GoogleGenAI } from "@google/genai";
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
const LIMIT = args.limit ? parseInt(args.limit) : null;
if (!WEEK) { console.error("❌ --week required"); process.exit(1); }

function loadPins(week) {
  const p = path.join(REPO_ROOT, `pinterest_week_${week}.json`);
  if (!fs.existsSync(p)) throw new Error(`pinterest_week_${week}.json not found.`);
  return JSON.parse(fs.readFileSync(p, "utf-8"));
}

function buildPrompt(pin) {
  const items = pin.items ?? [];
  const itemsText = items.map((it, i) => `${i + 1}. ${it}`).join("\n");
  const count = items.length;
  return `Create a clean, professional Pinterest infographic in a soft pastel aesthetic for an ADHD wellness brand.

TITLE at top (large, bold, friendly rounded font): "${pin.headline}"

A vertical numbered list with EXACTLY ${count} items, each with a numbered circle badge (1 through ${count} in order) and a small matching pastel icon:
${itemsText}

STYLE: soft pastel palette (lavender, cream, sage green, blush pink, light blue), cute minimal flat icons, rounded friendly legible sans-serif, perfect spelling, soft decorative elements (stars, leaves, hearts), warm supportive feeling, small "bloomfocus.org" at bottom center. Vertical 2:3 portrait. All text must be crisp, readable, correctly spelled.`;
}

async function generateInfographic(pin, outDir) {
  const outPath = path.join(outDir, `${pin.id}.png`);
  const response = await gemini.models.generateContent({
    model: "gemini-2.5-flash-image",
    contents: buildPrompt(pin) + "\n\nVertical 2:3 portrait aspect ratio (1000x1500).",
  });
  const parts = response.candidates?.[0]?.content?.parts ?? [];
  for (const part of parts) {
    if (part.inlineData?.data) {
      fs.writeFileSync(outPath, Buffer.from(part.inlineData.data, "base64"));
      return outPath;
    }
  }
  throw new Error("No image from Gemini");
}

async function main() {
  console.log(`\n🧪 bloom focus — Gemini infographic TEST — Week ${WEEK}\n${"━".repeat(50)}`);
  let pins = loadPins(WEEK).filter((p) => p.pinType === "infographic");
  if (LIMIT) pins = pins.slice(0, LIMIT);
  if (pins.length === 0) { console.log("⚠ No infographic pins."); return; }

  const outDir = path.join(REPO_ROOT, `output/pinterest-gemini/week_${WEEK}`);
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  console.log(`📋 ${pins.length} infographics via Gemini\n`);
  let done = 0, failed = 0;
  for (let i = 0; i < pins.length; i++) {
    const pin = pins[i];
    process.stdout.write(`   [${i+1}/${pins.length}] ${pin.id} "${pin.headline}"... `);
    try {
      await generateInfographic(pin, outDir);
      done++; console.log("✓");
      await new Promise((r) => setTimeout(r, 800));
    } catch (err) {
      failed++; console.log(`✗ ${err.message}`);
    }
  }
  console.log(`\n${"━".repeat(50)}`);
  console.log(`✅ Generated: ${done}, Failed: ${failed}`);
  console.log(`   📁 output/pinterest-gemini/week_${WEEK}/`);
  console.log(`${"━".repeat(50)}\n`);
}

main().catch((err) => { console.error("\n❌ gemini infographic failed:", err.message); process.exit(1); });
