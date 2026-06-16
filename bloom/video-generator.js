/**
 * bloom focus — video-generator.js
 * Assembles MP4 videos using FFmpeg.
 * Input:  illustration (from image-generator.js) + script text
 * Output: 1080×1920 MP4 ready for TikTok / IG Reels / YT Shorts
 *
 * Prerequisites:
 *   brew install ffmpeg  (Mac)
 *   apt install ffmpeg   (Linux)
 *
 * Usage:
 *   node bloom/video-generator.js --week=26
 *   node bloom/video-generator.js --week=26 --pillar=2   (single pillar)
 *   node bloom/video-generator.js --week=26 --no-voice   (skip voiceover)
 */

import { execSync, exec } from "child_process";
import fs from "fs";
import path from "path";
import { promisify } from "util";
import { fileURLToPath } from "url";

const execAsync = promisify(exec);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

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
const SINGLE_PILLAR = args.pillar ? parseInt(args.pillar) : null;
const USE_VOICE = !args["no-voice"];

if (!WEEK) {
  console.error("❌ --week is required. Example: node bloom/video-generator.js --week=26");
  process.exit(1);
}

// ─── Video settings ───────────────────────────────────────────────────────────
const VIDEO_CONFIG = {
  width: 1080,
  height: 1920,
  fps: 30,
  duration: 45, // seconds
  font_color: "white",
  font_size: 64,
  hook_font_size: 72,
  background_color: "0x1a1a2e@0.6", // dark overlay for text readability
};

// ─── Check FFmpeg is installed ────────────────────────────────────────────────
function checkFFmpeg() {
  try {
    execSync("ffmpeg -version", { stdio: "ignore" });
    return true;
  } catch {
    console.error("❌ FFmpeg not found. Install it:");
    console.error("   Mac:   brew install ffmpeg");
    console.error("   Linux: sudo apt install ffmpeg");
    process.exit(1);
  }
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

// ─── Find image for a given pillar ────────────────────────────────────────────
function findImageForPillar(pack, pillarId) {
  const promptObj = pack.image_prompts.image_prompts.find(
    (p) => p.id === `video_p${pillarId}`
  );

  if (!promptObj || !promptObj.local_path) {
    return null; // image not generated yet
  }

  return fs.existsSync(promptObj.local_path) ? promptObj.local_path : null;
}

// ─── Wrap text for FFmpeg drawtext ────────────────────────────────────────────
function wrapText(text, maxChars = 28) {
  const words = text.split(" ");
  const lines = [];
  let current = "";

  for (const word of words) {
    if ((current + " " + word).trim().length > maxChars) {
      if (current) lines.push(current.trim());
      current = word;
    } else {
      current = (current + " " + word).trim();
    }
  }
  if (current) lines.push(current.trim());
  return lines;
}

// ─── Build FFmpeg drawtext filter for multi-line text ────────────────────────
function buildDrawtextFilter(lines, startY, fontSize, color = "white", opacity = 1.0) {
  const lineHeight = fontSize * 1.3;
  return lines
    .map(
      (line, i) =>
        `drawtext=text='${line.replace(/'/g, "\\'")}':` +
        `fontsize=${fontSize}:` +
        `fontcolor=${color}@${opacity}:` +
        `x=(w-text_w)/2:` +
        `y=${startY + i * lineHeight}:` +
        `shadowcolor=black@0.8:shadowx=2:shadowy=2`
    )
    .join(",");
}

// ─── Build FFmpeg command for one video ──────────────────────────────────────
function buildFFmpegCommand(script, imagePath, audioPath, outputPath) {
  const { width, height, fps, duration, font_size, hook_font_size } = VIDEO_CONFIG;

  const hookLines = wrapText(script.hook, 26);
  const bodyLines = script.body.slice(0, 3).map((b) => wrapText(b, 32)).flat();
  const ctaLines = wrapText(script.cta, 30);

  // Text overlay: hook at top third, body in middle, CTA at bottom
  const hookFilter = buildDrawtextFilter(hookLines, 280, hook_font_size, "white", 1.0);
  const bodyFilter = buildDrawtextFilter(bodyLines, 780, font_size - 8, "white", 0.9);
  const ctaFilter = buildDrawtextFilter(ctaLines, 1650, font_size - 4, "#E8DEFF", 1.0);

  // Dark overlay rect for text readability
  const overlayFilter = `drawbox=x=0:y=240:w=${width}:h=200:color=black@0.5:t=fill,` +
    `drawbox=x=0:y=720:w=${width}:h=${bodyLines.length * 72 + 40}:color=black@0.4:t=fill,` +
    `drawbox=x=0:y=1610:w=${width}:h=240:color=black@0.5:t=fill`;

  const vf = [overlayFilter, hookFilter, bodyFilter, ctaFilter]
    .filter(Boolean)
    .join(",");

  // Input: image (looped for duration) + optional audio
  const inputImage = `-loop 1 -i "${imagePath}" -t ${duration}`;
  const inputAudio = audioPath ? `-i "${audioPath}"` : "";

  // Slow zoom effect on the image (Ken Burns style)
  const scaleFilter = `scale=${width * 1.05}:${height * 1.05},zoompan=z='min(zoom+0.0005,1.05)':d=${duration * fps}:s=${width}x${height}:fps=${fps}`;

  const audioMap = audioPath ? `-map 0:v -map 1:a -shortest` : "";
  const videoCodec = `-c:v libx264 -preset fast -crf 23 -pix_fmt yuv420p`;
  const audioCodec = audioPath ? `-c:a aac -b:a 192k` : "";

  return [
    "ffmpeg -y",
    inputImage,
    inputAudio,
    `-vf "${scaleFilter},${vf}"`,
    videoCodec,
    audioCodec,
    audioMap,
    `-r ${fps}`,
    `"${outputPath}"`,
  ]
    .filter(Boolean)
    .join(" ");
}

// ─── Generate placeholder video (no image available) ─────────────────────────
function buildPlaceholderFFmpegCommand(script, outputPath) {
  const { width, height, fps, duration, hook_font_size } = VIDEO_CONFIG;

  // Pastel lavender background as placeholder
  const bgFilter = `color=c=0xE8DEFF:size=${width}x${height}:duration=${duration}:rate=${fps}`;
  const hookLines = wrapText(script.hook, 26);
  const ctaLines = wrapText(script.cta, 30);
  const hookFilter = buildDrawtextFilter(hookLines, 700, hook_font_size, "#3d2c6e", 1.0);
  const ctaFilter = buildDrawtextFilter(ctaLines, 1650, 52, "#6b4c9e", 1.0);
  const watermarkFilter = `drawtext=text='[IMAGE PLACEHOLDER]':fontsize=40:fontcolor=gray@0.5:x=(w-text_w)/2:y=200`;

  const vf = [watermarkFilter, hookFilter, ctaFilter].join(",");

  return [
    "ffmpeg -y",
    `-f lavfi -i "${bgFilter}"`,
    `-vf "${vf}"`,
    `-c:v libx264 -preset fast -crf 23 -pix_fmt yuv420p`,
    `-r ${fps}`,
    `-t ${duration}`,
    `"${outputPath}"`,
  ].join(" ");
}

// ─── Generate one video ───────────────────────────────────────────────────────
async function generateVideo(script, pack, outputDir) {
  const pillarId = script.pillar_id;
  const filename = `bloom_focus_w${WEEK}_p${pillarId}_${script.pillar_name.replace(/\s+/g, "_").toLowerCase()}.mp4`;
  const outputPath = path.join(outputDir, filename);

  if (fs.existsSync(outputPath)) {
    console.log(`   ⏭  Pillar ${pillarId} video already exists, skipping`);
    return { pillar_id: pillarId, status: "skipped", path: outputPath };
  }

  const imagePath = findImageForPillar(pack, pillarId);

  let cmd;
  if (imagePath) {
    cmd = buildFFmpegCommand(script, imagePath, null, outputPath);
  } else {
    console.log(`   ⚠  No image found for Pillar ${pillarId} — using placeholder`);
    cmd = buildPlaceholderFFmpegCommand(script, outputPath);
  }

  await execAsync(cmd, { maxBuffer: 50 * 1024 * 1024 });

  return {
    pillar_id: pillarId,
    pillar_name: script.pillar_name,
    status: imagePath ? "generated" : "placeholder",
    path: outputPath,
    filename,
    duration_seconds: VIDEO_CONFIG.duration,
    has_image: !!imagePath,
  };
}

// ─── Main runner ──────────────────────────────────────────────────────────────
async function generateVideos(weekNumber) {
  console.log(`\n🎬 bloom focus — generating Week ${weekNumber} videos\n`);
  console.log("━".repeat(50));

  checkFFmpeg();

  const pack = loadWeeklyPack(weekNumber);
  let scripts = pack.video_scripts;

  if (SINGLE_PILLAR) {
    scripts = scripts.filter((s) => s.pillar_id === SINGLE_PILLAR);
  }

  const outputDir = path.join(
    __dirname,
    `../output/videos/week_${weekNumber}`
  );
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  console.log(`📋 ${scripts.length} video(s) to generate`);
  console.log(`📁 Output: output/videos/week_${weekNumber}/\n`);

  const results = [];
  let generated = 0;
  let skipped = 0;
  let failed = 0;

  for (const script of scripts) {
    process.stdout.write(
      `   Pillar ${script.pillar_id} [${script.pillar_name}]... `
    );
    try {
      const result = await generateVideo(script, pack, outputDir);
      results.push(result);

      if (result.status === "skipped") {
        skipped++;
      } else {
        generated++;
        console.log(`✓ ${result.filename}`);
      }
    } catch (err) {
      failed++;
      console.log(`✗ FAILED: ${err.message}`);
      results.push({
        pillar_id: script.pillar_id,
        status: "failed",
        error: err.message,
      });
    }
  }

  // Update weekly pack with video paths
  const updatedPack = { ...pack };
  if (!updatedPack.videos) updatedPack.videos = [];
  for (const result of results) {
    const existing = updatedPack.videos.find((v) => v.pillar_id === result.pillar_id);
    if (existing) {
      Object.assign(existing, result);
    } else {
      updatedPack.videos.push(result);
    }
  }
  const packPath = path.join(
    __dirname,
    `../output/bloom_focus_week_${weekNumber}.json`
  );
  fs.writeFileSync(packPath, JSON.stringify(updatedPack, null, 2));

  console.log("\n" + "━".repeat(50));
  console.log(`✅ Video generation complete!`);
  console.log(`   ✓ Generated: ${generated}`);
  if (skipped > 0) console.log(`   ⏭  Skipped: ${skipped}`);
  if (failed > 0) console.log(`   ✗ Failed: ${failed}`);
  console.log(`   📁 Saved to: output/videos/week_${weekNumber}/`);
  console.log(`\n   ➜ Next: run sheets-publisher.js --week=${weekNumber}`);
  console.log("━".repeat(50) + "\n");

  return results;
}

// ─── Run ──────────────────────────────────────────────────────────────────────
generateVideos(WEEK).catch((err) => {
  console.error("\n❌ video-generator failed:", err.message);
  process.exit(1);
});
