/**
 * bloom focus — remotion/render.js
 * Renders dynamic TikTok/Reels videos from the weekly content pack.
 *
 * For each video script, it builds segments from hook/bridge/body/cta,
 * pairs them with the generated frame images, and renders a 9:16 MP4.
 *
 * Usage:
 *   node render.js --week=29
 *   node render.js --week=29 --limit=1   (render first video only, for testing)
 */

import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, "..");

const args = Object.fromEntries(
  process.argv.slice(2).filter((a) => a.startsWith("--"))
    .map((a) => { const [k, v] = a.slice(2).split("="); return [k, v ?? true]; })
);
const WEEK = args.week ? parseInt(args.week) : null;
const LIMIT = args.limit ? parseInt(args.limit) : null;
if (!WEEK) { console.error("❌ --week required"); process.exit(1); }

// ─── Load pack ────────────────────────────────────────────────────────────────
function loadPack(week) {
  const p = path.join(REPO_ROOT, `output/bloom_focus_week_${week}.json`);
  if (!fs.existsSync(p)) throw new Error(`Week ${week} pack not found. Run text-generator first.`);
  return JSON.parse(fs.readFileSync(p, "utf-8"));
}

// ─── Pick a keyword to highlight from a text line ────────────────────────────
function pickKeyword(text) {
  const candidates = ["dopamine", "lazy", "broken", "underfueled", "brain", "focus", "start", "task", "shame", "executive", "paralysis", "quiz", "save"];
  const lower = text.toLowerCase();
  for (const c of candidates) {
    if (lower.includes(c)) return c;
  }
  return null;
}

// ─── Build segments from a script ────────────────────────────────────────────
function buildSegments(script) {
  const segments = [];
  if (script.hook) segments.push({ text: script.hook, keyword: pickKeyword(script.hook) });
  if (script.bridge) segments.push({ text: script.bridge, keyword: pickKeyword(script.bridge) });
  for (const b of (script.body ?? [])) {
    segments.push({ text: b, keyword: pickKeyword(b) });
  }
  if (script.cta) segments.push({ text: script.cta, keyword: pickKeyword(script.cta) });
  return segments;
}

// ─── Collect frame images for a video (as file:// URLs) ──────────────────────
function collectImages(week, videoId) {
  const dir = path.join(REPO_ROOT, `output/images/week_${week}/videos/${videoId}`);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith(".png"))
    .sort()
    .map((f) => `file://${path.join(dir, f)}`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n🎬 bloom focus — Remotion render Week ${WEEK}\n${"━".repeat(50)}`);

  const pack = loadPack(WEEK);
  let scripts = pack.video_scripts;
  if (LIMIT) scripts = scripts.slice(0, LIMIT);

  console.log(`📦 Bundling Remotion project...`);
  const bundleLocation = await bundle({
    entryPoint: path.join(__dirname, "src/index.jsx"),
    onProgress: () => {},
  });
  console.log("   ✓ bundled");

  const outDir = path.join(REPO_ROOT, `output/videos/week_${WEEK}`);
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  console.log(`\n🎥 Rendering ${scripts.length} videos...\n`);

  let done = 0, failed = 0;
  const results = [];

  for (const script of scripts) {
    const videoId = `video_d${script.day}_s${script.slot}`;
    const segments = buildSegments(script);
    const images = collectImages(WEEK, videoId);
    const outPath = path.join(outDir, `${videoId}.mp4`);

    process.stdout.write(`   ${videoId} (${segments.length} segments, ${images.length} imgs)... `);

    try {
      const inputProps = { segments, images, music: null };
      const composition = await selectComposition({
        serveUrl: bundleLocation,
        id: "AdhdReel",
        inputProps,
      });

      await renderMedia({
        composition,
        serveUrl: bundleLocation,
        codec: "h264",
        outputLocation: outPath,
        inputProps,
      });

      done++;
      results.push({ videoId, status: "rendered", path: outPath });
      console.log("✓");
    } catch (err) {
      failed++;
      results.push({ videoId, status: "failed", error: err.message });
      console.log(`✗ ${err.message}`);
    }
  }

  fs.writeFileSync(
    path.join(outDir, "_render_manifest.json"),
    JSON.stringify({ week: WEEK, done, failed, results }, null, 2)
  );

  console.log(`\n${"━".repeat(50)}`);
  console.log(`✅ Rendered: ${done}, Failed: ${failed}`);
  console.log(`   📁 output/videos/week_${WEEK}/`);
  console.log(`${"━".repeat(50)}\n`);
}

main().catch((err) => { console.error("\n❌ render failed:", err.message); process.exit(1); });
