/**
 * bloom focus — image-generator.js
 * Reads image prompts from the weekly JSON output,
 * generates soft pastel illustrations via Google Gemini Imagen API,
 * and saves them to /output/images/week_XX/.
 *
 * Usage:
 *   node bloom/image-generator.js --week=26
 *   node bloom/image-generator.js --week=26 --id=video_p1   (single image)
 *
 * Requires:
 *   GEMINI_API_KEY in .env
 *   npm install @google/genai
 */

import 'dotenv/config';
import { GoogleGenAI } from "@google/genai";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// ─── CLI args ────────────────────────────────────────────────────────────────
const args = Object.fromEntries(
  process.argv
    .slice(2)
    .filter((a) => a.startsWith("--"))
    .map((a) => {
      const [k, v] = a.slice(2).split("=");
      return [k, v ?? true];
    })
);

const WEEK = args.week ? parseInt(args.week) : null;
const SINGLE_ID = args.id ?? null;

if (!WEEK) {
  console.error("❌ --week is required. Example: node bloom/image-generator.js --week=26");
  process.exit(1);
}

// ─── Aspect ratio → Imagen aspectRatio string ────────────────────────────────
// Gemini Imagen supports: "1:1" | "3:4" | "4:3" | "9:16" | "16:9"
function mapAspectRatio(ratio) {
  const map = {
    "9:16": "9:16",   // vertical video — TikTok / Reels
    "4:5":  "3:4",    // carousel — closest available is 3:4
    "1:1":  "1:1",
  };
  return map[ratio] ?? "9:16";
}

// ─── Load weekly content pack ─────────────────────────────────────────────────
function loadWeeklyPack(weekNumber) {
  const filePath = path.join(
    __dirname,
    `../output/bloom_focus_week_${weekNumber}.json`
  );
  if (!fs.existsSync(filePath)) {
    throw new Error(
      `Week ${weekNumber} content pack not found. Run text-generator.js --week=${weekNumber} first.`
    );
  }
  return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}

// ─── Generate one image via Gemini Imagen ────────────────────────────────────
async function generateImage(imagePromptObj, outputDir) {
  const { id, prompt, aspect_ratio, content_type, pillar } = imagePromptObj;

  const filename = `${id}_${aspect_ratio.replace(":", "x")}.png`;
  const outputPath = path.join(outputDir, filename);

  // Skip if already exists
  if (fs.existsSync(outputPath)) {
    console.log(`   ⏭  ${id} already exists, skipping`);
    return { id, status: "skipped", path: outputPath };
  }

  const response = await ai.models.generateImages({
    model: "imagen-3.0-generate-002",
    prompt: prompt,
    config: {
      numberOfImages: 1,
      aspectRatio: mapAspectRatio(aspect_ratio),
      // Imagen safety — "block_only_high" gives more creative freedom
      // for illustration-style content
      safetySetting: "BLOCK_ONLY_HIGH",
      personGeneration: "DONT_ALLOW", // no real people — brand rule
    },
  });

  const imageData = response.generatedImages[0]?.image?.imageBytes;
  if (!imageData) {
    throw new Error("No image returned from Gemini Imagen");
  }

  // imageBytes is base64 — decode and save as PNG
  const buffer = Buffer.from(imageData, "base64");
  fs.writeFileSync(outputPath, buffer);

  return {
    id,
    status: "generated",
    path: outputPath,
    pillar,
    content_type,
    aspect_ratio,
    model: "imagen-3.0-generate-002",
  };
}

// ─── Main runner ──────────────────────────────────────────────────────────────
async function generateImages(weekNumber) {
  console.log(`\n🎨 bloom focus — generating Week ${weekNumber} images (Gemini Imagen)\n`);
  console.log("━".repeat(50));

  const pack = loadWeeklyPack(weekNumber);
  let prompts = pack.image_prompts.image_prompts;

  // Filter to single image if --id was passed
  if (SINGLE_ID) {
    prompts = prompts.filter((p) => p.id === SINGLE_ID);
    if (prompts.length === 0) {
      console.error(`❌ No image prompt found with id="${SINGLE_ID}"`);
      process.exit(1);
    }
  }

  const outputDir = path.join(__dirname, `../output/images/week_${weekNumber}`);
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  console.log(`📋 ${prompts.length} image(s) to generate`);
  console.log(`📁 Output: output/images/week_${weekNumber}/\n`);

  const results = [];
  let generated = 0;
  let skipped = 0;
  let failed = 0;

  for (const promptObj of prompts) {
    process.stdout.write(`   [${promptObj.id}] ${promptObj.pillar}... `);
    try {
      const result = await generateImage(promptObj, outputDir);
      results.push(result);

      if (result.status === "skipped") {
        skipped++;
      } else {
        generated++;
        console.log(`✓ ${path.basename(result.path)}`);
      }

      // Imagen rate limit: ~2 req/sec — wait 600ms between calls
      await new Promise((r) => setTimeout(r, 600));

    } catch (err) {
      failed++;
      console.log(`✗ FAILED: ${err.message}`);
      results.push({ id: promptObj.id, status: "failed", error: err.message });
    }
  }

  // Save manifest
  const manifest = {
    week: weekNumber,
    generated_at: new Date().toISOString(),
    model: "imagen-3.0-generate-002",
    total: prompts.length,
    generated,
    skipped,
    failed,
    images: results,
  };
  fs.writeFileSync(
    path.join(outputDir, "_manifest.json"),
    JSON.stringify(manifest, null, 2)
  );

  // Update weekly pack with local image paths
  const updatedPack = { ...pack };
  for (const result of results) {
    const p = updatedPack.image_prompts.image_prompts.find((p) => p.id === result.id);
    if (p) {
      p.local_path = result.path;
      p.status = result.status;
    }
  }
  fs.writeFileSync(
    path.join(__dirname, `../output/bloom_focus_week_${weekNumber}.json`),
    JSON.stringify(updatedPack, null, 2)
  );

  console.log("\n" + "━".repeat(50));
  console.log(`✅ Image generation complete!`);
  console.log(`   ✓ Generated: ${generated}`);
  if (skipped > 0) console.log(`   ⏭  Skipped: ${skipped}`);
  if (failed > 0) console.log(`   ✗ Failed: ${failed}`);
  console.log(`   📁 Saved to: output/images/week_${weekNumber}/`);
  console.log(`\n   ➜ Next: node bloom/video-generator.js --week=${weekNumber}`);
  console.log("━".repeat(50) + "\n");

  return manifest;
}

// ─── Run ──────────────────────────────────────────────────────────────────────
generateImages(WEEK).catch((err) => {
  console.error("\n❌ image-generator failed:", err.message);
  process.exit(1);
});
