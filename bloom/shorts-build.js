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
import { makeVoiceover, elevenLabsWithTimestamps } from "./tts.js";
import { getOrCreate, normalizeTag, libraryStats, writeLibraryManifest } from "./image-library.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

const args = Object.fromEntries(
  process.argv.slice(2).filter((a) => a.startsWith("--")).map((a) => {
    const [k, v] = a.slice(2).split("=");
    return [k, v ?? true];
  })
);
function isoWeek(d = new Date()) {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - day + 3);
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  const fday = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - fday + 3);
  return 1 + Math.round((date - firstThursday) / (7 * 24 * 3600 * 1000));
}
const WEEK = args.week ? parseInt(args.week) : isoWeek();
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
  const body = JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] });
  const maxAttempts = 5;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let res;
    try {
      res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body });
    } catch (netErr) {
      if (attempt === maxAttempts) throw new Error(`Gemini image network error: ${netErr.message}`);
      await new Promise((r) => setTimeout(r, 3000 * attempt));
      continue;
    }
    if (res.ok) {
      const data = await res.json();
      const img = (data.candidates?.[0]?.content?.parts ?? []).find((p) => p.inlineData)?.inlineData?.data;
      if (img) return Buffer.from(img, "base64");
    }
    const status = res.ok ? "no-image" : res.status;
    const transient = res.ok || [429, 500, 502, 503, 504].includes(res.status);
    if (!transient) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 160)}`);
    if (attempt === maxAttempts) throw new Error(`Gemini image failed after ${maxAttempts} attempts (last: ${status})`);
    await new Promise((r) => setTimeout(r, 3000 * attempt));
  }
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
  // Library-backed: reuse a stored variant for this tag, or generate+store a new
  // one (up to MAX_VARIANTS). Library images are stored finished (bg+scrim) so
  // reuse is a plain copy. Tag falls back to a prompt hash if missing.
  const tag = scene.tag || normalizeTag((scene.imagePrompt || "scene").slice(0, 30));
  await getOrCreate(tag, "vertical", async () => {
    const bg = await geminiBackground(scene.imagePrompt);
    const base = await sharp(bg).resize(W, H, { fit: "cover", position: "centre" }).toBuffer();
    return await sharp(base).composite([{ input: bottomScrim(), top: 0, left: 0 }]).png().toBuffer();
  }, outPath);
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

// Build an .srt from real per-word timestamps (ElevenLabs) — perfect sync.
function writeSRTfromWords(words, outPath, maxWords = 5) {
  const cues = [];
  let cur = [];
  for (const w of words) {
    cur.push(w);
    const endsClause = /[.!?;:,]$/.test(w.word);
    if (cur.length >= maxWords || (endsClause && cur.length >= 2)) { cues.push(cur); cur = []; }
  }
  if (cur.length) cues.push(cur);
  let srt = "";
  cues.forEach((group, i) => {
    srt += `${i + 1}\n${srtTime(group[0].start)} --> ${srtTime(group[group.length - 1].end)}\n${group.map((g) => g.word).join(" ")}\n\n`;
  });
  fs.writeFileSync(outPath, srt);
  return outPath;
}

// Detect real speech segments by finding silence gaps in the audio. Returns
// an array of {start,end} spoken regions. This lets subtitles follow the
// actual voice (which pauses between phrases) instead of a flat estimate, so
// text stops racing ahead during the speaker's natural pauses.
function speechSegments(voicePath, totalDur) {
  let out = "";
  try {
    // silencedetect prints silence_start / silence_end to stderr
    out = execSync(
      `ffmpeg -i "${voicePath}" -af silencedetect=noise=-32dB:d=0.35 -f null - 2>&1`,
      { encoding: "utf8" }
    );
  } catch (e) {
    out = e.stdout ? e.stdout.toString() : (e.message || "");
  }
  const silences = [];
  const re = /silence_start:\s*([\d.]+)[\s\S]*?silence_end:\s*([\d.]+)/g;
  let m;
  while ((m = re.exec(out)) !== null) {
    silences.push([parseFloat(m[1]), parseFloat(m[2])]);
  }
  // invert silences → speech segments
  const segs = [];
  let cursor = 0;
  for (const [s, e] of silences) {
    if (s > cursor + 0.15) segs.push({ start: cursor, end: s });
    cursor = e;
  }
  if (cursor < totalDur - 0.15) segs.push({ start: cursor, end: totalDur });
  return segs.length ? segs : [{ start: 0, end: totalDur }];
}

// Write an .srt. If we have real speech segments, distribute the subtitle cues
// across them (weighted by word count within each segment), so cues align to
// the voice's actual phrasing and pauses. Falls back to flat word-weighted
// timing if detection finds nothing useful.
function writeSRT(chunks, totalDur, outPath, voicePath = null) {
  const wordCounts = chunks.map((c) => Math.max(1, c.trim().split(/\s+/).length));
  const totalWords = wordCounts.reduce((a, b) => a + b, 0);

  let cues = [];
  const segs = voicePath ? speechSegments(voicePath, totalDur) : [{ start: 0, end: totalDur }];
  const segDur = segs.reduce((a, s) => a + (s.end - s.start), 0) || totalDur;

  // Assign each chunk a span of "words" proportional to its length, then walk
  // the speech segments consuming that many words-worth of time. Each cue is
  // placed inside real spoken time, so pauses naturally hold the previous cue.
  const perWord = segDur / totalWords;
  let segIdx = 0;
  let segPos = segs[0].start;
  for (let i = 0; i < chunks.length; i++) {
    let need = wordCounts[i] * perWord;
    const start = segPos;
    while (need > 0 && segIdx < segs.length) {
      const remain = segs[segIdx].end - segPos;
      if (remain > need) { segPos += need; need = 0; }
      else { need -= remain; segIdx++; if (segIdx < segs.length) segPos = segs[segIdx].start; }
    }
    const end = segIdx < segs.length ? segPos : totalDur;
    cues.push({ start, end });
  }
  // ensure non-overlap / monotonic, end last cue at totalDur
  for (let i = 0; i < cues.length; i++) {
    if (i < cues.length - 1) cues[i].end = Math.max(cues[i].start + 0.4, cues[i + 1].start);
    else cues[i].end = totalDur;
  }

  let srt = "";
  chunks.forEach((c, i) => {
    srt += `${i + 1}\n${srtTime(cues[i].start)} --> ${srtTime(cues[i].end)}\n${c}\n\n`;
  });
  fs.writeFileSync(outPath, srt);
  return outPath;
}

// ─── Quiz-test 2x2 grid image (4 options + question + numbers) ───────────────
async function buildQuizGrid(short, outPath) {
  // Layout: question (top) + 2x2 grid (middle) + CTA (bottom), no overlap.
  const gridTop = 340;
  const bottomReserve = 240;                          // space for bottom text
  const tileW = Math.floor(W / 2);                    // 540
  const tileH = Math.floor((H - gridTop - bottomReserve) / 2);
  const tiles = [];
  for (let i = 0; i < 4; i++) {
    const opt = short.options[i];
    const raw = await geminiBackground(opt.imagePrompt);
    const tile = await sharp(raw).resize(tileW, tileH, { fit: "cover", position: "centre" }).toBuffer();
    const badge = Buffer.from(`
<svg width="${tileW}" height="${tileH}" xmlns="http://www.w3.org/2000/svg">
  <circle cx="58" cy="58" r="42" fill="rgba(61,44,110,0.92)"/>
  <text x="58" y="76" font-family="Arial, sans-serif" font-size="50" font-weight="800" fill="#fff" text-anchor="middle">${i + 1}</text>
  <rect x="0" y="${tileH-64}" width="${tileW}" height="64" fill="rgba(40,30,50,0.55)"/>
  <text x="${tileW/2}" y="${tileH-22}" font-family="Arial, sans-serif" font-size="32" font-weight="700" fill="#fff" text-anchor="middle">${esc(opt.label || "")}</text>
</svg>`);
    tiles.push(await sharp(tile).composite([{ input: badge, top: 0, left: 0 }]).png().toBuffer());
  }

  const qLines = wrapText(short.question, 18);
  const qFont = 66, qLH = qFont * 1.18;
  const qSpans = qLines.map((ln, i) => `<tspan x="${W/2}" dy="${i === 0 ? 0 : qLH}">${esc(ln)}</tspan>`).join("");
  const banner = Buffer.from(`
<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <rect x="0" y="0" width="${W}" height="${H}" fill="#FFF8F0"/>
  <text x="${W/2}" y="150" font-family="Georgia, serif" font-size="${qFont}" font-weight="800"
        fill="#3d2c6e" text-anchor="middle">${qSpans}</text>
  <text x="${W/2}" y="${H-130}" font-family="Arial, sans-serif" font-size="44" font-weight="800"
        fill="#3d2c6e" text-anchor="middle">Pick yours - watch for your result</text>
  <text x="${W/2}" y="${H-70}" font-family="Arial, sans-serif" font-size="38" font-weight="600"
        fill="#7c6bb0" text-anchor="middle">Free ADHD test - bloomfocus.org</text>
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

// Result reveal image for one option: its illustration full-bleed + a big
// number badge + the label, with a bottom scrim (the result text is burned as
// a synced subtitle, like other shorts).
async function buildResultImage(opt, number, outPath) {
  const raw = await geminiBackground(opt.imagePrompt);
  const base = await sharp(raw).resize(W, H, { fit: "cover", position: "centre" }).toBuffer();
  const badge = Buffer.from(`
<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <defs><linearGradient id="f" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0%" stop-color="rgba(40,30,50,0)"/><stop offset="100%" stop-color="rgba(40,30,50,0.6)"/>
  </linearGradient></defs>
  <rect x="0" y="${H-650}" width="${W}" height="650" fill="url(#f)"/>
  <circle cx="${W/2}" cy="150" r="70" fill="rgba(61,44,110,0.92)"/>
  <text x="${W/2}" y="178" font-family="Arial, sans-serif" font-size="80" font-weight="800" fill="#fff" text-anchor="middle">${number}</text>
  <text x="${W/2}" y="285" font-family="Georgia, serif" font-size="56" font-weight="800" fill="#3d2c6e" text-anchor="middle" stroke="#FFF8F0" stroke-width="2" paint-order="stroke">${esc(opt.label || "")}</text>
</svg>`);
  await sharp(base).composite([{ input: badge, top: 0, left: 0 }]).png().toFile(outPath);
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

  // ── single still image, length = voiceover (quiztest segments) ──
  if (matchVoice) {
    const still = path.basename(scenePaths[0]);
    const voiceName = path.basename(voicePath);
    const sub = srtPath
      ? `,subtitles=${path.basename(srtPath)}:force_style='Fontname=Arial,Fontsize=13,Bold=1,PrimaryColour=&H00FFFFFF,OutlineColour=&H803D2C6E,BorderStyle=1,Outline=3,Shadow=0,Alignment=2,MarginV=320,MarginL=90,MarginR=90'`
      : "";
    let cmd;
    if (hasMusic) {
      cmd = `ffmpeg -y -loop 1 -i "${still}" -i "${voiceName}" -stream_loop -1 -i "${MUSIC_PATH}" ` +
        `-filter_complex "[0:v]${vf}${sub}[v];[2:a]volume=0.12[m];[1:a][m]amix=inputs=2:duration=first:dropout_transition=2[a]" ` +
        `-map "[v]" -map "[a]" -shortest -c:v libx264 -preset veryfast -crf 23 -c:a aac -b:a 192k -pix_fmt yuv420p "${path.basename(outPath)}"`;
    } else {
      cmd = `ffmpeg -y -loop 1 -i "${still}" -i "${voiceName}" ` +
        `-filter_complex "[0:v]${vf}${sub}[v]" -map "[v]" -map 1:a -shortest ` +
        `-c:v libx264 -preset veryfast -crf 23 -c:a aac -b:a 192k -pix_fmt yuv420p "${path.basename(outPath)}"`;
    }
    execSync(cmd, { stdio: "inherit", cwd: tmp });
    return outPath;
  }

  // ── voiced shorts: slideshow of scenes via concat demuxer + synced subtitles ──
  const listFile = path.join(tmp, "scenes.txt");
  let list = "";
  scenePaths.forEach((p, i) => { list += `file '${path.basename(p)}'\nduration ${durations[i]}\n`; });
  list += `file '${path.basename(scenePaths[scenePaths.length - 1])}'\n`;
  fs.writeFileSync(listFile, list);
  const totalDur = durations.reduce((a, b) => a + b, 0);

  // subtitle filter (burned in, synced via .srt). libass needs a bare filename
  // (absolute paths with slashes/colons break the filtergraph), so we run
  // ffmpeg with cwd=tmp and reference subs.srt / scenes.txt by basename.
  const subFilter = srtPath
    ? `,subtitles=${path.basename(srtPath)}:force_style='Fontname=Arial,Fontsize=13,Bold=1,PrimaryColour=&H00FFFFFF,OutlineColour=&H803D2C6E,BorderStyle=1,Outline=3,Shadow=0,Alignment=2,MarginV=320,MarginL=90,MarginR=90'`
    : "";
  const listName = path.basename(listFile);
  const voiceName = path.basename(voicePath);

  let cmd;
  if (hasMusic) {
    cmd = `ffmpeg -y -f concat -safe 0 -i "${listName}" -i "${voiceName}" -stream_loop -1 -i "${MUSIC_PATH}" ` +
      `-filter_complex "[0:v]${vf}${subFilter}[v];[2:a]volume=0.12[m];[1:a][m]amix=inputs=2:duration=first:dropout_transition=2[a]" ` +
      `-map "[v]" -map "[a]" -t ${totalDur} -c:v libx264 -preset veryfast -crf 23 -c:a aac -b:a 192k -pix_fmt yuv420p "${outPath}"`;
  } else {
    cmd = `ffmpeg -y -f concat -safe 0 -i "${listName}" -i "${voiceName}" ` +
      `-filter_complex "[0:v]${vf}${subFilter}[v]" ` +
      `-map "[v]" -map 1:a -t ${totalDur} -c:v libx264 -preset veryfast -crf 23 -c:a aac -b:a 192k -pix_fmt yuv420p "${outPath}"`;
  }
  execSync(cmd, { stdio: "inherit", cwd: tmp });
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
  // When LIMIT is set, build the next N shorts that don't have a video yet
  // (rather than the first N overall — those may already be built).
  if (LIMIT) {
    const pending = shorts.filter(s => !(typeof s.videoUrl === "string" && s.videoUrl.startsWith("http")));
    shorts = pending.slice(0, LIMIT);
    console.log(`   🎯 LIMIT=${LIMIT}: building ${shorts.length} of ${pending.length} pending shorts`);
  }

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

      // 1. voiceover (skip for quiztest — it builds per-segment audio below)
      let wordTimings = null;
      const voicePath = path.join(workDir, "voice.mp3");
      if (short.shortType !== "quiztest") {
        process.stdout.write("   🎤 voiceover... ");
        const engine = process.env.VOICE_ENGINE || "gemini";
        if (engine === "elevenlabs") {
          const r = await elevenLabsWithTimestamps(short.voiceover, voicePath);
          if (r.ok && r.words && r.words.length) { wordTimings = r.words; console.log("✓ (timestamped)"); }
          else { await makeVoiceover(short.voiceover, voicePath, "gemini"); console.log("✓ (gemini fallback)"); }
        } else {
          await makeVoiceover(short.voiceover, voicePath, engine);
          console.log("✓");
        }
      }

      const scenePaths = [];
      const durations = [];
      let srtPath = null;

      if (short.shortType === "quiztest") {
        // NEW quiz-test flow: grid (intro) → each option revealed full-screen
        // with its result as a synced subtitle. Built as segments, concatenated.
        const engine2 = process.env.VOICE_ENGINE || "gemini";
        const segVideos = [];   // per-segment mp4 paths
        const opts = (short.options || []).slice(0, 4);

        // helper to render one segment (image + its own voiceover + subtitle)
        const buildSegment = async (img, voText, idx) => {
          const segVoice = path.join(workDir, `seg_${idx}.mp3`);
          let words = null;
          if (engine2 === "elevenlabs") {
            const r = await elevenLabsWithTimestamps(voText, segVoice);
            if (r.ok && r.words?.length) words = r.words;
            else await makeVoiceover(voText, segVoice, "gemini");
          } else {
            await makeVoiceover(voText, segVoice, engine2);
          }
          const segDur = ffprobeDuration(segVoice);
          const segSrt = path.join(workDir, `seg_${idx}.srt`);
          if (words) writeSRTfromWords(words, segSrt, 5);
          else writeSRT(splitIntoSubtitles(voText, 5), segDur, segSrt, segVoice);
          const segMp4 = path.join(workDir, `seg_${idx}.mp4`);
          buildVideo([img], [segDur], segVoice, segMp4, true, segSrt);
          segVideos.push(segMp4);
        };

        // intro segment: the grid + intro voiceover
        process.stdout.write("   🧩 grid + intro... ");
        const gp = path.join(workDir, "grid.png");
        await buildQuizGrid(short, gp);
        await buildSegment(gp, short.introVoiceover || short.voiceover || "Which one is you?", 0);
        console.log("✓");

        // reveal segments: one per option (image + its result as subtitle)
        for (let i = 0; i < opts.length; i++) {
          process.stdout.write(`   🔎 reveal ${i + 1}/4... `);
          const rImg = path.join(workDir, `result_${i}.png`);
          await buildResultImage(opts[i], i + 1, rImg);
          const rText = `Number ${i + 1}. ${opts[i].result || ""}`;
          await buildSegment(rImg, rText, i + 1);
          console.log("✓");
          await new Promise((r) => setTimeout(r, 400));
        }

        // outro segment (last reveal image reused as bg)
        if (short.outroVoiceover) {
          process.stdout.write("   👋 outro... ");
          const oImg = path.join(workDir, `result_${opts.length - 1}.png`);
          await buildSegment(oImg, short.outroVoiceover, opts.length + 1);
          console.log("✓");
        }

        // concat all segments into the final quiztest video
        process.stdout.write("   🎞  assemble... ");
        const concatList = path.join(workDir, "segments.txt");
        fs.writeFileSync(concatList, segVideos.map((p) => `file '${path.basename(p)}'`).join("\n"));
        execSync(
          `ffmpeg -y -f concat -safe 0 -i segments.txt -c:v libx264 -preset veryfast -crf 23 -c:a aac -b:a 192k -pix_fmt yuv420p "${mp4Path}"`,
          { stdio: "inherit", cwd: workDir }
        );
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
        const voiceDur = ffprobeDuration(voicePath);
        const per = voiceDur / short.scenes.length;
        for (let i = 0; i < short.scenes.length; i++) durations.push(per);

        // Subtitles: use real word timestamps if we have them (perfect sync),
        // else split text + align to detected speech segments.
        srtPath = path.join(workDir, "subs.srt");
        if (wordTimings) {
          writeSRTfromWords(wordTimings, srtPath, 5);
          console.log(`   💬 ${wordTimings.length} words → timestamped subtitles`);
        } else {
          const chunks = splitIntoSubtitles(short.voiceover, 5);
          writeSRT(chunks, voiceDur, srtPath, voicePath);
          console.log(`   💬 ${chunks.length} subtitle cues (estimated)`);
        }

        // assemble (non-quiztest)
        process.stdout.write("   🎞  ffmpeg assemble... ");
        buildVideo(scenePaths, durations, voicePath, mp4Path, false, srtPath);
        console.log("✓");
      }

      short.videoUrl = `${REPO_RAW}/output/shorts/week_${WEEK}/${short.id}.mp4`;
      done++;
    } catch (err) {
      failed++;
      console.log(`   ✗ FAILED ${short.id} (${short.shortType}): ${err.message}`);
      console.log(err.stack);
    } finally {
      // Always clean the work dir (even on failure) so temp files never commit.
      const wd = path.join(outDir, `_work_${short.id}`);
      try { fs.rmSync(wd, { recursive: true, force: true }); } catch {}
    }
  }

  // rewrite JSON with videoUrl filled in
  const full = loadShorts(WEEK);
  const byId = Object.fromEntries(shorts.filter(s => s.videoUrl).map(s => [s.id, s.videoUrl]));
  for (const s of full) if (byId[s.id]) s.videoUrl = byId[s.id];
  fs.writeFileSync(path.join(REPO_ROOT, `shorts_week_${WEEK}.json`), JSON.stringify(full, null, 2));
  fs.writeFileSync(path.join(REPO_ROOT, "shorts_current.json"), JSON.stringify(full, null, 2));

  // shorts_ready.json — only items with a real videoUrl that are not yet posted.
  // Make.com reads this so it never has to filter null videoUrls itself.
  const ready = full.filter(s => typeof s.videoUrl === "string" && s.videoUrl.startsWith("http") && s.status !== "posted");
  fs.writeFileSync(path.join(REPO_ROOT, "shorts_ready.json"), JSON.stringify(ready, null, 2));
  console.log(`   ✅ shorts_ready.json: ${ready.length} videos ready to post`);

  try { const n = writeLibraryManifest(); console.log(`   🗂  library manifest: ${n} images`); } catch {}
  try { const s = libraryStats("vertical"); console.log(`   📚 vertical library: ${s.total} images across ${Object.keys(s.tags).length} tags`); } catch {}

  console.log(`\n${"━".repeat(50)}\n✅ done ${done} · skipped ${skipped} · failed ${failed}`);
}

main().catch((e) => { console.error("❌", e.message); process.exit(1); });
