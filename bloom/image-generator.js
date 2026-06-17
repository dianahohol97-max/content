/**
 * bloom focus — image-generator.js
 * Generates all illustrations via Google Gemini Imagen.
 *
 * Handles the new multi-frame structure:
 *   - video frames (8-10 per video × 21 videos)
 *   - pinterest pins (70)
 *   - stories (7)
 *   - carousels (3)
 *
 * Usage:
 *   node bloom/image-generator.js --week=27
 *   node bloom/image-generator.js --week=27 --only=video   (video frames only)
 *   node bloom/image-generator.js --week=27 --limit=10      (first 10 only, for testing)
 */

import 'dotenv/config';
import { GoogleGenAI } from "@google/genai";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const args = Object.fromEntries(
  process.argv.slice(2).filter(a => a.startsWith("--"))
    .map(a => { const [k,v] = a.slice(2).split("="); return [k, v ?? true]; })
);
const WEEK = args.week ? parseInt(args.week) : null;
const ONLY = args.only ?? null;       // video | pinterest | stories | carousels
const LIMIT = args.limit ? parseInt(args.limit) : null;
if (!WEEK) { console.error("❌ --week required"); process.exit(1); }

function loadPack(weekNumber) {
  const p = path.join(__dirname, `../output/bloom_focus_week_${weekNumber}.json`);
  if (!fs.existsSync(p)) throw new Error(`Week ${weekNumber} pack not found. Run text-generator first.`);
  return JSON.parse(fs.readFileSync(p, "utf-8"));
}

function mapAspect(ratio) {
  return { "9:16": "9:16", "2:3": "3:4", "4:5": "3:4", "1:1": "1:1" }[ratio] ?? "9:16";
}

// ─── Flatten all prompts into one job list ────────────────────────────────────
function buildJobList(pack) {
  const jobs = [];

  // Video frames
  if (!ONLY || ONLY === "video") {
    for (const video of pack.image_prompts.videos) {
      for (const frame of video.frames) {
        jobs.push({
          id: `${video.id}_f${frame.frame}`,
          category: "video",
          aspect: "9:16",
          prompt: frame.prompt,
          subfolder: `videos/${video.id}`,
        });
      }
    }
  }

  // Pinterest
  if (!ONLY || ONLY === "pinterest") {
    for (const pin of pack.image_prompts.pinterest) {
      jobs.push({
        id: pin.id, category: "pinterest", aspect: "2:3",
        prompt: pin.prompt, subfolder: "pinterest",
      });
    }
  }

  // Stories
  if (!ONLY || ONLY === "stories") {
    for (const story of pack.image_prompts.stories) {
      jobs.push({
        id: story.id, category: "story", aspect: "1:1",
        prompt: story.prompt, subfolder: "stories",
      });
    }
  }

  // Carousels
  if (!ONLY || ONLY === "carousels") {
    for (const carousel of pack.image_prompts.carousels) {
      jobs.push({
        id: carousel.id, category: "carousel", aspect: "4:5",
        prompt: carousel.prompt, subfolder: "carousels",
      });
    }
  }

  return LIMIT ? jobs.slice(0, LIMIT) : jobs;
}

// ─── Generate one image ───────────────────────────────────────────────────────
async function generateImage(job, baseDir) {
  const dir = path.join(baseDir, job.subfolder);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const filename = `${job.id}.png`;
  const outPath = path.join(dir, filename);
  if (fs.existsSync(outPath)) return { id: job.id, status: "skipped", path: outPath };

  const response = await ai.models.generateImages({
    model: "imagen-3.0-generate-002",
    prompt: job.prompt,
    config: {
      numberOfImages: 1,
      aspectRatio: mapAspect(job.aspect),
      personGeneration: "DONT_ALLOW",
    },
  });

  const imageData = response.generatedImages?.[0]?.image?.imageBytes;
  if (!imageData) throw new Error("No image returned");
  fs.writeFileSync(outPath, Buffer.from(imageData, "base64"));

  return { id: job.id, status: "generated", path: outPath, category: job.category };
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function run(weekNumber) {
  console.log(`\n🎨 bloom focus — Week ${weekNumber} images (Gemini Imagen)\n${"━".repeat(50)}`);

  const pack = loadPack(weekNumber);
  const jobs = buildJobList(pack);
  const baseDir = path.join(__dirname, `../output/images/week_${weekNumber}`);
  if (!fs.existsSync(baseDir)) fs.mkdirSync(baseDir, { recursive: true });

  console.log(`📋 ${jobs.length} images to generate`);
  if (ONLY) console.log(`   Filter: ${ONLY} only`);
  if (LIMIT) console.log(`   Limit: first ${LIMIT}`);
  console.log("");

  let generated = 0, skipped = 0, failed = 0;
  const results = [];

  for (let i = 0; i < jobs.length; i++) {
    const job = jobs[i];
    process.stdout.write(`   [${i+1}/${jobs.length}] ${job.id} (${job.category})... `);
    try {
      const res = await generateImage(job, baseDir);
      results.push(res);
      if (res.status === "skipped") { skipped++; console.log("⏭"); }
      else { generated++; console.log("✓"); }
      await new Promise(r => setTimeout(r, 600));
    } catch (err) {
      failed++; console.log(`✗ ${err.message}`);
      results.push({ id: job.id, status: "failed", error: err.message });
    }
  }

  fs.writeFileSync(
    path.join(baseDir, "_manifest.json"),
    JSON.stringify({ week: weekNumber, total: jobs.length, generated, skipped, failed, results }, null, 2)
  );

  console.log(`\n${"━".repeat(50)}`);
  console.log(`✅ Done! Generated: ${generated}, Skipped: ${skipped}, Failed: ${failed}`);
  console.log(`   📁 output/images/week_${weekNumber}/`);
  console.log(`   ➜ Next: node bloom/video-generator.js --week=${weekNumber}`);
  console.log(`${"━".repeat(50)}\n`);
}

run(WEEK).catch(err => { console.error("\n❌ image-generator failed:", err.message); process.exit(1); });
