/**
 * bloom focus — pinterest-infographic-dalle.js
 * Generates full ADHD infographic pins via OpenAI gpt-image-1 (DALL-E).
 * Tests whether AI can render readable infographic text + lists.
 *
 * Only processes pins where pinType === "infographic".
 *
 * Usage:
 *   node bloom/pinterest-infographic-dalle.js --week=29 --limit=3
 */

import 'dotenv/config';
import OpenAI from "openai";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, "..");
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

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

// ─── Build the DALL-E prompt for an infographic ──────────────────────────────
function buildPrompt(pin) {
  const items = pin.items ?? [];
  const itemsText = items.map((it, i) => `${i + 1}. ${it}`).join("\n");
  const count = items.length;

  return `A clean, professional Pinterest infographic in a soft pastel aesthetic for an ADHD wellness brand.

TITLE at top (large, bold, friendly rounded font): "${pin.headline}"

A vertical numbered list with EXACTLY ${count} items. Each item has a numbered circle badge on the left (numbered 1 through ${count} IN ORDER, no skipped or repeated numbers), the text in the middle, and a small simple matching pastel icon on the right:
${itemsText}

CRITICAL: The numbered badges must read 1, 2, 3${count >= 4 ? ", 4" : ""}${count >= 5 ? ", 5" : ""} in perfect sequence from top to bottom. Every item must have its number. Do not skip or duplicate any number.

STYLE:
- Soft pastel palette: lavender, cream, sage green, blush pink, light blue
- Cute minimal flat illustrations and small icons next to each list item
- Rounded friendly sans-serif typography, clearly legible, perfect spelling
- Soft decorative elements (little stars, leaves, hearts) but not cluttered
- Warm, calm, supportive feeling
- Small "bloomfocus.org" text at the very bottom center
- Vertical 2:3 Pinterest format
- All text must be crisp, readable, and correctly spelled

The infographic should look like a polished Canva design that an adult woman with ADHD would save and share.`;
}

async function generateInfographic(pin, outDir) {
  const filename = `${pin.id}.png`;
  const outPath = path.join(outDir, filename);

  const result = await openai.images.generate({
    model: "gpt-image-1",
    prompt: buildPrompt(pin),
    size: "1024x1536",  // closest to 2:3
    quality: "high",
  });

  const b64 = result.data[0].b64_json;
  if (!b64) throw new Error("No image returned");
  fs.writeFileSync(outPath, Buffer.from(b64, "base64"));
  return outPath;
}

async function main() {
  console.log(`\n🎨 bloom focus — DALL-E infographic test — Week ${WEEK}\n${"━".repeat(50)}`);

  let pins = loadPins(WEEK).filter((p) => p.pinType === "infographic");
  if (LIMIT) pins = pins.slice(0, LIMIT);

  if (pins.length === 0) {
    console.log("⚠ No infographic pins found in this week.");
    return;
  }

  const outDir = path.join(REPO_ROOT, `output/pinterest-dalle/week_${WEEK}`);
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  console.log(`📋 ${pins.length} infographic pins to generate\n`);

  let done = 0, failed = 0;
  for (let i = 0; i < pins.length; i++) {
    const pin = pins[i];
    process.stdout.write(`   [${i+1}/${pins.length}] ${pin.id} "${pin.headline}"... `);
    try {
      await generateInfographic(pin, outDir);
      done++;
      console.log("✓");
      await new Promise((r) => setTimeout(r, 1000));
    } catch (err) {
      failed++;
      console.log(`✗ ${err.message}`);
    }
  }

  console.log(`\n${"━".repeat(50)}`);
  console.log(`✅ Generated: ${done}, Failed: ${failed}`);
  console.log(`   📁 output/pinterest-dalle/week_${WEEK}/`);
  console.log(`${"━".repeat(50)}\n`);
}

main().catch((err) => { console.error("\n❌ dalle infographic failed:", err.message); process.exit(1); });
