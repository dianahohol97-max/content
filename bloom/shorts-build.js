/**
 * bloom focus — shorts-build.js
 * Assembles YouTube Shorts MP4s from shorts_week_X.json.
 *
 * For each Short:
 *   1. ElevenLabs  → voiceover MP3 from the `voiceover` text
 *   2. Gemini      → one aesthetic background per scene
 *   3. sharp/SVG   → burn the scene caption onto each background
 *   4. FFmpeg      → slideshow of captioned scenes, timed to scenes[].seconds,
 *                    mixed with voiceover + quiet background music, 1080x1920 MP4
 *
 * Output: output/shorts/week_X/SH_W..._.mp4  (committed; Make reads GitHub raw)
 *
 * Env: ELEVENLABS_API_KEY, GEMINI_API_KEY
 * Usage:
 *   node bloom/shorts-build.js --week=29 --limit=1
 *   node bloom/shorts-build.js --week=29 --skip-existing
 */

import "dotenv/config";
import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { fileURLToPath } from "url";
import sharp from "sharp";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

const args = Object.fromEntries(
  process.argv.slice(2).filter((a) => a.startsWith("--")).map((a) => {
    const [k, v] = a.slice(2).split("=");
    return [k, v ?? true];
  })
);
const WEEK = args.week ? parseInt(args.week) : 29;
const LIMIT = args.limit ? parseInt(args.limit) : null;
const SKIP_EXISTING = !!args["skip-existing"];

const W = 1080, H = 1920;
const ELEVEN_KEY = process.env.ELEVENLABS_API_KEY;
const GEMINI_KEY = process.env.GEMINI_API_KEY;
// Default ElevenLabs voice — warm female ("Rachel"). Override with VOICE_ID env.
const VOICE_ID = process.env.ELEVENLABS_VOICE_ID || "21m00Tcm4TlvDq8ikWAM";
const MUSIC_PATH = path.join(REPO_ROOT, "bloom/assets/music-calm.mp3");

// ─── helpers ──────────────────────────────────────────────────────────────────
function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function wrapText(text, maxChars) {
  const words = String(text).split(/\s+/);
  const lines = [];
  let line = "";
  for (const w of words) {
    if ((line + " " + w).trim().length > maxChars) { if (line) lines.push(line); line = w; }
    else line = (line + " " + w).trim();
  }
  if (line) lines.push(line);
  return lines;
}

// ─── ElevenLabs voiceover ───────────────────────────────────────────────────
async function makeVoiceover(text, outPath) {
  if (!ELEVEN_KEY) throw new Error("ELEVENLABS_API_KEY missing");
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}`, {
    method: "POST",
    headers: {
      "xi-api-key": ELEVEN_KEY,
      "Content-Type": "application/json",
      "Accept": "audio/mpeg",
    },
    body: JSON.stringify({
      text,
      model_id: "eleven_multilingual_v2",
      voice_settings: { stability: 0.5, similarity_boost: 0.75, style: 0.0, use_speaker_boost: true },
    }),
  });
  if (!res.ok) throw new Error(`ElevenLabs ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(outPath, buf);
  return outPath;
}

// ─── Gemini background ──────────────────────────────────────────────────────
async function geminiBackground(prompt) {
  if (!GEMINI_KEY) throw new Error("GEMINI_API_KEY missing");
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent?key=${GEMINI_KEY}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
  });
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  const parts = data.candidates?.[0]?.content?.parts ?? [];
  const img = parts.find((p) => p.inlineData)?.inlineData?.data;
  if (!img) throw new Error("Gemini returned no image");
  return Buffer.from(img, "base64");
}

// ─── Caption overlay (big readable text, lower third) ───────────────────────
function captionOverlay(caption) {
  const lines = wrapText(caption, 16);
  const fontSize = 90;
  const lineHeight = fontSize * 1.2;
  const blockH = lines.length * lineHeight;
  const baseY = H - 460; // lower third
  const tspans = lines.map((ln, i) =>
    `<tspan x="${W/2}" dy="${i === 0 ? 0 : lineHeight}">${esc(ln)}</tspan>`).join("");
  return Buffer.from(`
<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="f" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="rgba(40,30,50,0)"/>
      <stop offset="100%" stop-color="rgba(40,30,50,0.65)"/>
    </linearGradient>
  </defs>
  <rect x="0" y="${H-700}" width="${W}" height="700" fill="url(#f)"/>
  <text x="${W/2}" y="${baseY}" font-family="Arial, Helvetica, sans-serif" font-size="${fontSize}"
        font-weight="800" fill="#ffffff" text-anchor="middle"
        stroke="#3d2c6e" stroke-width="3" paint-order="stroke"
        style="letter-spacing:-1px;">${tspans}</text>
</svg>`);
}

async function buildSceneImage(scene, outPath) {
  const bg = await geminiBackground(scene.imagePrompt);
  const base = await sharp(bg).resize(W, H, { fit: "cover", position: "centre" }).toBuffer();
  const overlay = captionOverlay(scene.caption);
  await sharp(base).composite([{ input: overlay, top: 0, left: 0 }]).png().toFile(outPath);
  return outPath;
}

// ─── FFmpeg assembly ────────────────────────────────────────────────────────
function ffmpegAvailable() {
  try { execSync("ffmpeg -version", { stdio: "ignore" }); return true; } catch { return false; }
}

function buildVideo(scenePaths, durations, voicePath, outPath) {
  const tmp = path.dirname(outPath);
  // Build a concat input list with per-image durations
  const listFile = path.join(tmp, "scenes.txt");
  let list = "";
  scenePaths.forEach((p, i) => {
    list += `file '${p}'\nduration ${durations[i]}\n`;
  });
  // last image must be repeated for concat demuxer to honor final duration
  list += `file '${scenePaths[scenePaths.length - 1]}'\n`;
  fs.writeFileSync(listFile, list);

  const hasMusic = fs.existsSync(MUSIC_PATH);
  const totalDur = durations.reduce((a, b) => a + b, 0);

  // Inputs: 0 = slideshow (concat), 1 = voiceover, [2 = music]
  // Slideshow → scale, pad to 1080x1920, 30fps
  const vf = `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},fps=30,format=yuv420p`;

  let cmd;
  if (hasMusic) {
    cmd = `ffmpeg -y -f concat -safe 0 -i "${listFile}" -i "${voicePath}" -stream_loop -1 -i "${MUSIC_PATH}" ` +
      `-filter_complex "[0:v]${vf}[v];[2:a]volume=0.12[m];[1:a][m]amix=inputs=2:duration=first:dropout_transition=2[a]" ` +
      `-map "[v]" -map "[a]" -t ${totalDur} -c:v libx264 -preset medium -crf 22 -c:a aac -b:a 192k -pix_fmt yuv420p "${outPath}"`;
  } else {
    cmd = `ffmpeg -y -f concat -safe 0 -i "${listFile}" -i "${voicePath}" ` +
      `-filter_complex "[0:v]${vf}[v]" ` +
      `-map "[v]" -map 1:a -t ${totalDur} -c:v libx264 -preset medium -crf 22 -c:a aac -b:a 192k -pix_fmt yuv420p "${outPath}"`;
  }
  execSync(cmd, { stdio: "inherit" });
  return outPath;
}

// ─── main ───────────────────────────────────────────────────────────────────
function loadShorts(week) {
  const p = path.join(REPO_ROOT, `shorts_week_${week}.json`);
  if (!fs.existsSync(p)) throw new Error(`${p} not found — run shorts-generator.js first`);
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

async function main() {
  console.log(`\n🎬 bloom focus — Shorts build — Week ${WEEK}\n${"━".repeat(50)}`);
  if (!ffmpegAvailable()) throw new Error("ffmpeg not found on PATH");

  let shorts = loadShorts(WEEK);
  if (LIMIT) shorts = shorts.slice(0, LIMIT);

  const outDir = path.join(REPO_ROOT, `output/shorts/week_${WEEK}`);
  fs.mkdirSync(outDir, { recursive: true });
  const REPO_RAW = "https://raw.githubusercontent.com/dianahohol97-max/content/main";

  let done = 0, failed = 0, skipped = 0;
  for (const short of shorts) {
    const mp4Path = path.join(outDir, `${short.id}.mp4`);
    if (SKIP_EXISTING && fs.existsSync(mp4Path) && fs.statSync(mp4Path).size > 10000) {
      short.videoUrl = `${REPO_RAW}/output/shorts/week_${WEEK}/${short.id}.mp4`;
      skipped++; console.log(`   ${short.id} — exists, skip`); continue;
    }
    console.log(`\n▶ ${short.id}: ${short.title}`);
    try {
      const workDir = path.join(outDir, `_work_${short.id}`);
      fs.mkdirSync(workDir, { recursive: true });

      // 1. voiceover
      process.stdout.write("   🎤 voiceover... ");
      const voicePath = path.join(workDir, "voice.mp3");
      await makeVoiceover(short.voiceover, voicePath);
      console.log("✓");

      // 2+3. scene images with captions
      const scenePaths = [];
      const durations = [];
      for (let i = 0; i < short.scenes.length; i++) {
        process.stdout.write(`   🖼  scene ${i + 1}/${short.scenes.length}... `);
        const sp = path.join(workDir, `scene_${String(i + 1).padStart(2, "0")}.png`);
        await buildSceneImage(short.scenes[i], sp);
        scenePaths.push(sp);
        durations.push(Number(short.scenes[i].seconds) || 6);
        console.log("✓");
        await new Promise((r) => setTimeout(r, 600));
      }

      // 4. assemble
      process.stdout.write("   🎞  ffmpeg assemble... ");
      buildVideo(scenePaths, durations, voicePath, mp4Path);
      console.log("✓");

      short.videoUrl = `${REPO_RAW}/output/shorts/week_${WEEK}/${short.id}.mp4`;
      // cleanup work dir to keep repo light
      fs.rmSync(workDir, { recursive: true, force: true });
      done++;
    } catch (err) {
      failed++;
      console.log(`   ✗ ${err.message}`);
    }
  }

  // rewrite JSON with videoUrl filled in
  const full = loadShorts(WEEK);
  const byId = Object.fromEntries(shorts.filter(s => s.videoUrl).map(s => [s.id, s.videoUrl]));
  for (const s of full) if (byId[s.id]) s.videoUrl = byId[s.id];
  fs.writeFileSync(path.join(REPO_ROOT, `shorts_week_${WEEK}.json`), JSON.stringify(full, null, 2));
  fs.writeFileSync(path.join(REPO_ROOT, "shorts_current.json"), JSON.stringify(full, null, 2));

  console.log(`\n${"━".repeat(50)}\n✅ done ${done} · skipped ${skipped} · failed ${failed}`);
}

main().catch((e) => { console.error("❌", e.message); process.exit(1); });
