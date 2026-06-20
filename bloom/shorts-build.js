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
import { makeVoiceover } from "./tts.js";

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
const GEMINI_KEY = process.env.GEMINI_API_KEY;
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

// ─── Voiceover via shared engine (ElevenLabs or Gemini, see tts.js) ─────────

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

// Scene background WITHOUT text — subtitles are burned later as a separate
// synced layer. We add a soft bottom scrim so white subtitles stay readable.
function bottomScrim() {
  return Buffer.from(`
<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <defs><linearGradient id="f" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0%" stop-color="rgba(40,30,50,0)"/>
    <stop offset="100%" stop-color="rgba(40,30,50,0.55)"/>
  </linearGradient></defs>
  <rect x="0" y="${H-650}" width="${W}" height="650" fill="url(#f)"/>
</svg>`);
}

async function buildSceneImage(scene, outPath) {
  const bg = await geminiBackground(scene.imagePrompt);
  const base = await sharp(bg).resize(W, H, { fit: "cover", position: "centre" }).toBuffer();
  await sharp(base).composite([{ input: bottomScrim(), top: 0, left: 0 }]).png().toFile(outPath);
  return outPath;
}

// ─── Subtitles synced to the voiceover ──────────────────────────────────────
// Split the full narration into short subtitle chunks (4-7 words), then time
// each chunk proportionally to its length across the measured voiceover.
function splitIntoSubtitles(text, maxWords = 6) {
  // Prefer breaking at natural pauses (commas, clause/sentence ends) so cues
  // read naturally, while keeping each cue <= maxWords.
  const words = String(text).replace(/\s+/g, " ").trim().split(" ");
  const chunks = [];
  let cur = [];
  for (const w of words) {
    cur.push(w);
    const hardBreak = /[.!?;:]$/.test(w);   // strong pause → break
    const softBreak = /,$/.test(w);          // comma → break if cue is decent length
    if (cur.length >= maxWords || (hardBreak && cur.length >= 2) || (softBreak && cur.length >= 3)) {
      chunks.push(cur.join(" "));
      cur = [];
    }
  }
  if (cur.length) chunks.push(cur.join(" "));
  return chunks;
}

function srtTime(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const ms = Math.round((sec - Math.floor(sec)) * 1000);
  const p = (n, l = 2) => String(n).padStart(l, "0");
  return `${p(h)}:${p(m)}:${p(s)},${p(ms, 3)}`;
}

// Write an .srt timed by WORD COUNT (closer to speech pace than char count),
// and hold each cue until the next one starts so subtitles never run AHEAD of
// the narration (a small bias toward lingering rather than racing).
function writeSRT(chunks, totalDur, outPath) {
  const wordCounts = chunks.map((c) => Math.max(1, c.trim().split(/\s+/).length));
  const sum = wordCounts.reduce((a, b) => a + b, 0);
  // start times are cumulative; each cue ends right where the next begins
  const starts = [];
  let t = 0;
  for (let i = 0; i < chunks.length; i++) {
    starts.push(t);
    t += (totalDur * wordCounts[i]) / sum;
  }
  starts.push(totalDur); // sentinel end
  let srt = "";
  chunks.forEach((c, i) => {
    srt += `${i + 1}\n${srtTime(starts[i])} --> ${srtTime(starts[i + 1])}\n${c}\n\n`;
  });
  fs.writeFileSync(outPath, srt);
  return outPath;
}

// ─── Quiz-test 2x2 grid image (4 options + question + numbers) ───────────────
async function buildQuizGrid(short, outPath) {
  // generate 4 tiles
  const tileW = Math.floor(W / 2);          // 540
  const tileH = Math.floor((H - 520) / 2);  // leave room for question top + CTA bottom
  const gridTop = 360;                       // question area above
  const tiles = [];
  for (let i = 0; i < 4; i++) {
    const opt = short.options[i];
    const raw = await geminiBackground(opt.imagePrompt);
    const tile = await sharp(raw).resize(tileW, tileH, { fit: "cover", position: "centre" }).toBuffer();
    // number + label badge on each tile
    const badge = Buffer.from(`
<svg width="${tileW}" height="${tileH}" xmlns="http://www.w3.org/2000/svg">
  <circle cx="64" cy="64" r="46" fill="rgba(61,44,110,0.92)"/>
  <text x="64" y="84" font-family="Arial, sans-serif" font-size="56" font-weight="800" fill="#fff" text-anchor="middle">${i + 1}</text>
  <rect x="0" y="${tileH-72}" width="${tileW}" height="72" fill="rgba(40,30,50,0.5)"/>
  <text x="${tileW/2}" y="${tileH-26}" font-family="Arial, sans-serif" font-size="36" font-weight="700" fill="#fff" text-anchor="middle">${esc(opt.label || "")}</text>
</svg>`);
    tiles.push(await sharp(tile).composite([{ input: badge, top: 0, left: 0 }]).png().toBuffer());
  }

  // question banner + CTA banner
  const qLines = wrapText(short.question, 20);
  const qFont = 72, qLH = qFont * 1.2;
  const qSpans = qLines.map((ln, i) => `<tspan x="${W/2}" dy="${i === 0 ? 0 : qLH}">${esc(ln)}</tspan>`).join("");
  const banner = Buffer.from(`
<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <rect x="0" y="0" width="${W}" height="${H}" fill="#FFF8F0"/>
  <text x="${W/2}" y="${160}" font-family="Georgia, serif" font-size="${qFont}" font-weight="800"
        fill="#3d2c6e" text-anchor="middle">${qSpans}</text>
  <text x="${W/2}" y="${H-150}" font-family="Arial, sans-serif" font-size="48" font-weight="800"
        fill="#3d2c6e" text-anchor="middle">Answer in the description ↓</text>
  <text x="${W/2}" y="${H-80}" font-family="Arial, sans-serif" font-size="40" font-weight="600"
        fill="#7c6bb0" text-anchor="middle">Take the free ADHD test — bloomfocus.org</text>
</svg>`);

  await sharp(banner)
    .composite([
      { input: tiles[0], top: gridTop, left: 0 },
      { input: tiles[1], top: gridTop, left: tileW },
      { input: tiles[2], top: gridTop + tileH, left: 0 },
      { input: tiles[3], top: gridTop + tileH, left: tileW },
    ])
    .png().toFile(outPath);
  return outPath;
}

// ─── FFmpeg assembly ────────────────────────────────────────────────────────
function ffmpegAvailable() {
  try { execSync("ffmpeg -version", { stdio: "ignore" }); return true; } catch { return false; }
}

function ffprobeDuration(file) {
  try {
    const out = execSync(`ffprobe -v error -show_entries format=duration -of csv=p=0 "${file}"`).toString().trim();
    return parseFloat(out) || 30;
  } catch { return 30; }
}

function buildVideo(scenePaths, durations, voicePath, outPath, matchVoice = false, srtPath = null) {
  const tmp = path.dirname(outPath);
  const hasMusic = fs.existsSync(MUSIC_PATH);
  const vf = `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},fps=30,format=yuv420p`;

  // ── quiztest: single still image, length = voiceover ──
  if (matchVoice) {
    const still = scenePaths[0];
    let cmd;
    if (hasMusic) {
      cmd = `ffmpeg -y -loop 1 -i "${still}" -i "${voicePath}" -stream_loop -1 -i "${MUSIC_PATH}" ` +
        `-filter_complex "[0:v]${vf}[v];[2:a]volume=0.12[m];[1:a][m]amix=inputs=2:duration=first:dropout_transition=2[a]" ` +
        `-map "[v]" -map "[a]" -shortest -c:v libx264 -preset medium -crf 22 -c:a aac -b:a 192k -pix_fmt yuv420p "${outPath}"`;
    } else {
      cmd = `ffmpeg -y -loop 1 -i "${still}" -i "${voicePath}" ` +
        `-filter_complex "[0:v]${vf}[v]" -map "[v]" -map 1:a -shortest ` +
        `-c:v libx264 -preset medium -crf 22 -c:a aac -b:a 192k -pix_fmt yuv420p "${outPath}"`;
    }
    execSync(cmd, { stdio: "inherit" });
    return outPath;
  }

  // ── voiced shorts: slideshow of scenes via concat demuxer + synced subtitles ──
  const listFile = path.join(tmp, "scenes.txt");
  let list = "";
  scenePaths.forEach((p, i) => { list += `file '${p}'\nduration ${durations[i]}\n`; });
  list += `file '${scenePaths[scenePaths.length - 1]}'\n`;
  fs.writeFileSync(listFile, list);
  const totalDur = durations.reduce((a, b) => a + b, 0);

  // subtitle filter (burned in, synced via .srt). Styled: white, bold, outline,
  // lower-third, readable without sound. force_style uses libass.
  const subFilter = srtPath
    ? `,subtitles='${srtPath}':force_style='Fontname=Arial,Fontsize=15,Bold=1,PrimaryColour=&H00FFFFFF,OutlineColour=&H803D2C6E,BorderStyle=1,Outline=3,Shadow=0,Alignment=2,MarginV=120'`
    : "";

  let cmd;
  if (hasMusic) {
    cmd = `ffmpeg -y -f concat -safe 0 -i "${listFile}" -i "${voicePath}" -stream_loop -1 -i "${MUSIC_PATH}" ` +
      `-filter_complex "[0:v]${vf}${subFilter}[v];[2:a]volume=0.12[m];[1:a][m]amix=inputs=2:duration=first:dropout_transition=2[a]" ` +
      `-map "[v]" -map "[a]" -t ${totalDur} -c:v libx264 -preset medium -crf 22 -c:a aac -b:a 192k -pix_fmt yuv420p "${outPath}"`;
  } else {
    cmd = `ffmpeg -y -f concat -safe 0 -i "${listFile}" -i "${voicePath}" ` +
      `-filter_complex "[0:v]${vf}${subFilter}[v]" ` +
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

      const scenePaths = [];
      const durations = [];
      let srtPath = null;

      if (short.shortType === "quiztest") {
        // single 2x2 grid image held for the whole voiceover
        process.stdout.write("   🧩 quiz grid (4 tiles)... ");
        const gp = path.join(workDir, "grid.png");
        await buildQuizGrid(short, gp);
        scenePaths.push(gp);
        durations.push(18); // grid holds ~18s; ffmpeg trims to voiceover length via -shortest fallback
        console.log("✓");
      } else {
        // scene background images (NO baked text — subtitles are a synced layer)
        for (let i = 0; i < short.scenes.length; i++) {
          process.stdout.write(`   🖼  scene ${i + 1}/${short.scenes.length}... `);
          const sp = path.join(workDir, `scene_${String(i + 1).padStart(2, "0")}.png`);
          await buildSceneImage(short.scenes[i], sp);
          scenePaths.push(sp);
          console.log("✓");
          await new Promise((r) => setTimeout(r, 600));
        }
        // Backgrounds change slowly: split the real voiceover length EVENLY
        // across the scene images (each holds a few subtitles).
        const voiceDur = ffprobeDuration(voicePath);
        const per = voiceDur / short.scenes.length;
        for (let i = 0; i < short.scenes.length; i++) durations.push(per);

        // Subtitles: split the FULL voiceover into short chunks and time them
        // proportionally across the same voiceDur → synced, readable w/o sound.
        const chunks = splitIntoSubtitles(short.voiceover, 6);
        srtPath = path.join(workDir, "subs.srt");
        writeSRT(chunks, voiceDur, srtPath);
        console.log(`   💬 ${chunks.length} subtitle cues`);
      }

      // 4. assemble
      process.stdout.write("   🎞  ffmpeg assemble... ");
      buildVideo(scenePaths, durations, voicePath, mp4Path, short.shortType === "quiztest", srtPath);
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
