/**
 * bloom focus — image-generator.js
 * Reads DALL-E image prompts from the weekly JSON output,
 * generates soft pastel illustrations via OpenAI API,
 * and saves them to /output/images/week_XX/.
 *
 * Usage:
 *   node bloom/image-generator.js --week=26
 *   node bloom/image-generator.js --week=26 --id=video_p1   (single image)
 */

import OpenAI from "openai";
import fs from "fs";
import path from "path";
import https from "https";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

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

// ─── Download image from URL to disk ─────────────────────────────────────────
function downloadImage(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https
      .get(url, (response) => {
        response.pipe(file);
        file.on("finish", () => {
          file.close();
          resolve(dest);
        });
      })
      .on("error", (err) => {
        fs.unlink(dest, () => {});
        reject(err);
      });
  });
}

// ─── Generate one image ───────────────────────────────────────────────────────
async function generateImage(imagePromptObj, outputDir) {
  const { id, prompt, aspect_ratio, content_type, pillar } = imagePromptObj;

  // Map aspect ratio to DALL-E size
  // 9:16 → 1024x1792 (portrait video)
  // 4:5  → 1024x1280 (carousel, closest available)
  const size = aspect_ratio === "9:16" ? "1024x1792" : "1024x1024";

  const filename = `${id}_${aspect_ratio.replace(":", "x")}.png`;
  const outputPath = path.join(outputDir, filename);

  // Skip if already exists
  if (fs.existsSync(outputPath)) {
    console.log(`   ⏭  ${id} already exists, skipping`);
    return { id, status: "skipped", path: outputPath };
  }

  const response = await openai.images.generate({
    model: "dall-e-3",
    prompt: prompt,
    n: 1,
    size: size,
    quality: "standard",
    style: "natural", // "natural" produces softer, more painterly results vs "vivid"
  });

  const imageUrl = response.data[0].url;
  await downloadImage(imageUrl, outputPath);

  return {
    id,
    status: "generated",
    path: outputPath,
    url: imageUrl,
    pillar,
    content_type,
    aspect_ratio,
    size_used: size,
  };
}

// ─── Main runner ──────────────────────────────────────────────────────────────
async function generateImages(weekNumber) {
  console.log(`\n🎨 bloom focus — generating Week ${weekNumber} images\n`);
  console.log("━".repeat(50));

  // Load the content pack created by text-generator.js
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

  // Create output directory
  const outputDir = path.join(
    __dirname,
    `../output/images/week_${weekNumber}`
  );
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
        console.log(`✓ saved as ${path.basename(result.path)}`);
      }

      // Respect rate limits — wait 1s between calls
      await new Promise((r) => setTimeout(r, 1000));
    } catch (err) {
      failed++;
      console.log(`✗ FAILED: ${err.message}`);
      results.push({ id: promptObj.id, status: "failed", error: err.message });
    }
  }

  // Save results manifest
  const manifestPath = path.join(outputDir, "_manifest.json");
  const manifest = {
    week: weekNumber,
    generated_at: new Date().toISOString(),
    total: prompts.length,
    generated,
    skipped,
    failed,
    images: results,
  };
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

  // Update the weekly pack with image paths
  const updatedPack = { ...pack };
  for (const result of results) {
    const promptInPack = updatedPack.image_prompts.image_prompts.find(
      (p) => p.id === result.id
    );
    if (promptInPack) {
      promptInPack.local_path = result.path;
      promptInPack.status = result.status;
    }
  }
  const packPath = path.join(
    __dirname,
    `../output/bloom_focus_week_${weekNumber}.json`
  );
  fs.writeFileSync(packPath, JSON.stringify(updatedPack, null, 2));

  console.log("\n" + "━".repeat(50));
  console.log(`✅ Image generation complete!`);
  console.log(`   ✓ Generated: ${generated}`);
  if (skipped > 0) console.log(`   ⏭  Skipped (already exist): ${skipped}`);
  if (failed > 0) console.log(`   ✗ Failed: ${failed}`);
  console.log(`   📁 Saved to: output/images/week_${weekNumber}/`);
  console.log(`   📄 Manifest: output/images/week_${weekNumber}/_manifest.json`);
  console.log(`\n   ➜ Next: run video-generator.js --week=${weekNumber}`);
  console.log("━".repeat(50) + "\n");

  return manifest;
}

// ─── Run ──────────────────────────────────────────────────────────────────────
generateImages(WEEK).catch((err) => {
  console.error("\n❌ image-generator failed:", err.message);
  process.exit(1);
});
