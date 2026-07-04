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
// Solid brand-cream fallback frame if an illustration fails — keeps a build alive.
async function brandFallback() {
  const sharp = (await import("sharp")).default;
  return await sharp({ create: { width: 1080, height: 1920, channels: 3, background: "#F0E9F7" } })
    .jpeg({ quality: 90 }).toBuffer();
}

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
    let bg; try { bg = await geminiBackground(scene.imagePrompt); } catch (e) { console.log("   ⚠ image fallback:", e.message.slice(0,60)); bg = await brandFallback(); }
    const base = await sharp(bg).resize(W, H, { fit: "cover", position: "centre" }).toBuffer();
    return await sharp(base).composite([{ input: bottomScrim(), top: 0, left: 0 }]).png().toBuffer();
  }, outPath);
  return outPath;
}

// ─── Subtitles synced to the voiceover ──────────────────────────────────────
// Split the full narration into short subtitle chunks (4-7 words), then time
// each chunk proportionally to its length across the measured voiceover.
function splitIntoSubtitles(text, maxWords = 4) {
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
function writeSRTfromWords(words, outPath, maxWords = 4) {
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
  const gridTop = 360;
  const bottomReserve = 300;                          // more space so CTA never overlaps tiles
  const tileW = Math.floor(W / 2);                    // 540
  const tileH = Math.floor((H - gridTop - bottomReserve) / 2);
  const tiles = [];
  for (let i = 0; i < 4; i++) {
    const opt = short.options[i];
    let raw;
    try { raw = await geminiBackground(opt.imagePrompt); }
    catch (e) { console.log(`   ⚠ quiz tile ${i+1} fallback:`, e.message.slice(0,50)); raw = await brandFallback(); }
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
  <text x="${W/2}" y="${H-160}" font-family="Arial, sans-serif" font-size="46" font-weight="800"
        fill="#3d2c6e" text-anchor="middle">Keep watching for your result</text>
  <text x="${W/2}" y="${H-100}" font-family="Arial, sans-serif" font-size="36" font-weight="600"
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
  let raw;
  try { raw = await geminiBackground(opt.imagePrompt); }
  catch (e) { console.log("   ⚠ result img fallback:", e.message.slice(0,50)); raw = await brandFallback(); }
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

// ── ЧОМУ shorts educational/practical були БЕЗ субтитрів (виправлено) ──────────
// Стиль субтитрів мав MarginV=320. Без параметра original_size libass рахує
// координати у власному дефолтному полотні PlayResY=288. MarginV=320 > 288 —
// отже текст виштовхувався ЗА нижній край кадру й був невидимий, хоча ffmpeg
// завершувався успішно (subtitle:0kB, без помилки). ВИПРАВЛЕНО: MarginV=50 +
// Fontsize=20 у системі координат libass (288), Outline=2. Прибрано MarginL/R,
// що стискали перенос рядків. Перевірено локально на реальному SH_W27_01 —
// субтитри тепер великі, білі з обведенням, у нижній третині кадру.
// Self-drawing reveal: violet lines draw themselves in a serpentine sweep,
// then color washes fade in. Pure pixel math over the finished illustration —
// zero API cost. Returns path to an mp4 segment of `drawDur` seconds.
// Clean scene: illustration fades in over the paper, then a gentle continuous
// Ken Burns push. No drawing, no wave — just a calm, professional appearance.
async function selfDrawSegment(scenePath, tmp, idx, sceneDur) {
  const seg = `seg_${idx}.mp4`;
  const total = Math.max(1.5, sceneDur);
  const N = Math.round(total * 30);
  const fadeDur = Math.min(0.6, total * 0.25);
  // alternate slow zoom in / out per scene for subtle variety
  const z = idx % 2 === 0
    ? `'min(1.00+0.06*on/${N},1.06)'`
    : `'max(1.06-0.06*on/${N},1.00)'`;
  const drift = idx % 4 < 2 ? "+" : "-";
  const cmd = `ffmpeg -y -loop 1 -i "${path.basename(scenePath)}" ` +
    `-vf "scale=${Math.round(W*1.12)}:${Math.round(H*1.12)},` +
    `zoompan=z=${z}:x='iw/2-(iw/zoom/2)${drift}20*on/${N}':y='ih/2-(ih/zoom/2)':d=${N}:s=${W}x${H}:fps=30,` +
    `fade=t=in:st=0:d=${fadeDur.toFixed(2)},format=yuv420p" ` +
    `-frames:v ${N} -c:v libx264 -preset veryfast -crf 19 -pix_fmt yuv420p "${seg}"`;
  execSync(cmd, { stdio: "inherit", cwd: tmp });
  return seg;
}

function ensureSubFont(tmp) {
  const dir = path.join(tmp, "fonts");
  fs.mkdirSync(dir, { recursive: true });
  const p = path.join(dir, "Poppins-ExtraBold.ttf");
  if (!fs.existsSync(p) || fs.statSync(p).size < 10000) {
    execSync(`curl -sL -o "${p}" "https://raw.githubusercontent.com/google/fonts/main/ofl/poppins/Poppins-ExtraBold.ttf"`);
  }
  return "fonts";
}

const SUB_STYLE = "Fontname=Poppins ExtraBold,Fontsize=14,Bold=1,PrimaryColour=&H00FFFFFF,OutlineColour=&H803D2C6E,BorderStyle=1,Outline=2,Shadow=0,Alignment=2,MarginV=60";

function audioChain(hasMusic) {
  return hasMusic
    ? `[1:a]loudnorm=I=-14:TP=-1.5:LRA=7[vn];[2:a]volume=0.10[m];[vn][m]amix=inputs=2:duration=first:dropout_transition=2[mx];[mx]alimiter=limit=0.891[a]`
    : `[1:a]loudnorm=I=-14:TP=-1.5:LRA=7[a]`;
}

const ENC = `-c:v libx264 -preset medium -crf 20 -c:a aac -b:a 192k -ar 44100 -pix_fmt yuv420p -movflags +faststart`;

async function buildVideo(scenePaths, durations, voicePath, outPath, matchVoice = false, srtPath = null) {
  const tmp = path.dirname(scenePaths[0]);
  const hasMusic = fs.existsSync(MUSIC_PATH);
  const fontsDir = ensureSubFont(tmp);
  const sub = srtPath
    ? `,subtitles=${path.basename(srtPath)}:fontsdir=${fontsDir}:force_style='${SUB_STYLE}'`
    : "";

  // ── single still, length = voiceover (quiz segments): slow continuous zoom ──
  if (matchVoice) {
    const still = path.basename(scenePaths[0]);
    const voiceName = path.basename(voicePath);
    const motion = `scale=1620:2880,zoompan=z='min(1+0.00030*on,1.10)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=18000:s=${W}x${H}:fps=30,format=yuv420p`;
    const cmd = `ffmpeg -y -loop 1 -i "${still}" -i "${voiceName}" ` +
      (hasMusic ? `-stream_loop -1 -i "${MUSIC_PATH}" ` : "") +
      `-filter_complex "[0:v]${motion}${sub}[v];${audioChain(hasMusic)}" ` +
      `-map "[v]" -map "[a]" -shortest ${ENC} "${path.basename(outPath)}"`;
    execSync(cmd, { stdio: "inherit", cwd: tmp });
    return outPath;
  }

  // ── voiced shorts: Ken Burns per scene (alternating zoom in/out + drift),
  //    then concat segments, then subs + audio in the final pass ──
  const segNames = [];
  for (let i = 0; i < scenePaths.length; i++) {
    const d = Math.max(1.5, durations[i]);
    segNames.push(await selfDrawSegment(scenePaths[i], tmp, i, d));
  }

  const listFile = path.join(tmp, "scenes.txt");
  fs.writeFileSync(listFile, segNames.map((s) => `file '${s}'`).join("\n") + "\n");
  const totalDur = durations.reduce((a, b) => a + b, 0);

  const cmd = `ffmpeg -y -f concat -safe 0 -i "scenes.txt" -i "${path.basename(voicePath)}" ` +
    (hasMusic ? `-stream_loop -1 -i "${MUSIC_PATH}" ` : "") +
    `-filter_complex "[0:v]fps=30${sub}[v];${audioChain(hasMusic)}" ` +
    `-map "[v]" -map "[a]" -t ${totalDur} ${ENC} "${outPath}"`;
  execSync(cmd, { stdio: "inherit", cwd: tmp });
  return outPath;
}

// ─── main ───────────────────────────────────────────────────────────────────
function loadShorts(week) {
  const p = path.join(REPO_ROOT, `shorts_week_${week}.json`);
  if (!fs.existsSync(p)) throw new Error(`${p} not found — run shorts-generator.js first`);
  return JSON.parse(fs.readFileSync(p, "utf8"));
}


// ── Branded Reel/Short cover (muted-noir) ────────────────────────────────────
// Rendered for every built video: {id}_cover.jpg next to the mp4. Used by the
// Instagram Reels poster as cover_url so the profile grid shows a designed
// card instead of a black first frame.
import os from "os";
import { execSync as _execSyncCover } from "child_process";
const COVER_FONTS = [
  ["PlayfairDisplay.ttf", "https://raw.githubusercontent.com/google/fonts/main/ofl/playfairdisplay/PlayfairDisplay%5Bwght%5D.ttf"],
  ["Poppins-Medium.ttf", "https://raw.githubusercontent.com/google/fonts/main/ofl/poppins/Poppins-Medium.ttf"],
  ["Caveat.ttf", "https://raw.githubusercontent.com/google/fonts/main/ofl/caveat/Caveat%5Bwght%5D.ttf"],
];
async function ensureCoverFonts() {
  const dir = path.join(os.homedir(), ".fonts");
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, url] of COVER_FONTS) {
    const p = path.join(dir, name);
    if (fs.existsSync(p) && fs.statSync(p).size > 10000) continue;
    const res = await fetch(url);
    if (!res.ok) { console.warn(`  cover font ${name}: HTTP ${res.status}`); continue; }
    fs.writeFileSync(p, Buffer.from(await res.arrayBuffer()));
  }
  try { _execSyncCover("fc-cache -f", { stdio: "ignore" }); } catch {}
}
function coverEsc(s){return String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");}
function coverWrap(t,max){const w=String(t).split(" ");const l=[];let cur="";for(const x of w){if((cur+" "+x).trim().length>max){if(cur)l.push(cur.trim());cur=x;}else cur=(cur+" "+x).trim();}if(cur)l.push(cur.trim());return l;}
function coverHash(s){let h=0;for(const ch of String(s))h=(h*31+ch.charCodeAt(0))>>>0;return h;}
async function buildCover(short, outDir) {
  const CW = 1080, CH = 1920, CREAM = "#FFF8F0";
  const GRADS = [["#241b3a","#3d2c6e","#1c1626"],["#1e1830","#4a3560","#2a1f3d"],["#2a2138","#3d2c6e","#241b3a"]];
  const g = GRADS[coverHash(short.id) % GRADS.length];
  const title = String(short.title).replace(/#Shorts?/gi, "").trim();
  const lines = coverWrap(title, 16);
  const font = lines.length > 4 ? 88 : lines.length > 3 ? 100 : 112;
  const lh = font * 1.22;
  const startY = CH/2 - (lines.length*lh)/2 + font*0.8 - 60;
  const spans = lines.map((l,i)=>`<tspan x="${CW/2}" dy="${i===0?0:lh}">${coverEsc(l)}</tspan>`).join("");
  let grain = ""; let seed = coverHash(short.id);
  for (let i=0;i<70;i++){ seed=(seed*1103515245+12345)>>>0; const x=seed%CW; seed=(seed*1103515245+12345)>>>0; const y=seed%CH;
    grain += `<circle cx="${x}" cy="${y}" r="1.2" fill="#ffffff" opacity="0.05"/>`; }
  const svg = Buffer.from(`<svg width="${CW}" height="${CH}" xmlns="http://www.w3.org/2000/svg">
  <defs><linearGradient id="g" x1="0" y1="0" x2="0.7" y2="1">
    <stop offset="0%" stop-color="${g[0]}"/><stop offset="55%" stop-color="${g[1]}"/><stop offset="100%" stop-color="${g[2]}"/>
  </linearGradient>
  <radialGradient id="glow" cx="0.5" cy="0.42" r="0.55">
    <stop offset="0%" stop-color="#f4c9d8" stop-opacity="0.13"/><stop offset="100%" stop-color="#000000" stop-opacity="0"/>
  </radialGradient></defs>
  <rect width="${CW}" height="${CH}" fill="url(#g)"/>
  <rect width="${CW}" height="${CH}" fill="url(#glow)"/>
  ${grain}
  <text x="${CW/2}" y="210" font-family="Caveat" font-weight="700" font-size="88" fill="${CREAM}" text-anchor="middle">bloom focus</text>
  <rect x="${CW/2-60}" y="${startY - font - 60}" width="120" height="6" rx="3" fill="#D8A0B4"/>
  <text x="${CW/2}" y="${startY}" font-family="Playfair Display" font-weight="700" font-size="${font}" fill="${CREAM}" text-anchor="middle" style="letter-spacing:-1px;">${spans}</text>
  <text x="${CW/2}" y="${CH-200}" font-family="Poppins" font-weight="500" font-size="40" letter-spacing="8" fill="rgba(255,248,240,0.65)" text-anchor="middle">WATCH \u2192</text>
</svg>`);
  const coverPath = path.join(outDir, `${short.id}_cover.jpg`);
  await sharp(svg).jpeg({ quality: 90 }).toFile(coverPath);
  return coverPath;
}

async function main() {
  await ensureCoverFonts();
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
      try { await buildCover(short, outDir); short.coverUrl = `${REPO_RAW}/output/shorts/week_${WEEK}/${short.id}_cover.jpg`; } catch (e) { console.warn(`   cover: ${e.message}`); }
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
          // lightweight: static image + subtitle + audio, gentle zoom, NO heavy pipeline
          const fontsDir2 = ensureSubFont(workDir);
          const N = Math.round(segDur * 30);
          const subF = fs.existsSync(segSrt) ? `,subtitles=${path.basename(segSrt)}:fontsdir=${fontsDir2}:force_style='${SUB_STYLE}'` : "";
          execSync(
            `ffmpeg -y -loop 1 -i "${path.basename(img)}" -i "${path.basename(segVoice)}" ` +
            `-vf "scale=${Math.round(W*1.06)}:${Math.round(H*1.06)},zoompan=z='min(1.00+0.03*on/${N},1.03)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${N}:s=${W}x${H}:fps=30${subF},format=yuv420p" ` +
            `-c:v libx264 -preset veryfast -crf 21 -c:a aac -b:a 192k -ar 44100 -shortest -pix_fmt yuv420p "${path.basename(segMp4)}"`,
            { stdio: "inherit", cwd: workDir }
          );
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
        await buildVideo(scenePaths, durations, voicePath, mp4Path, false, srtPath);
        console.log("✓");
      }

      short.videoUrl = `${REPO_RAW}/output/shorts/week_${WEEK}/${short.id}.mp4`;
      try { await buildCover(short, outDir); short.coverUrl = `${REPO_RAW}/output/shorts/week_${WEEK}/${short.id}_cover.jpg`; } catch (e) { console.warn(`   cover: ${e.message}`); }
      done++;
    } catch (err) {
      failed++;
      // persist error so it survives in the repo (Actions logs are not always reachable)
      try {
        fs.appendFileSync(path.join(outDir, "build_errors.log"),
          `${new Date().toISOString()} ${short.id} (${short.shortType||"voiced"}): ${err.message}\n${(err.stack||"").split("\n").slice(0,6).join("\n")}\n\n`);
      } catch {}
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
  const byCover = Object.fromEntries(shorts.filter(s => s.coverUrl).map(s => [s.id, s.coverUrl]));
  for (const s of full) {
    if (byId[s.id]) s.videoUrl = byId[s.id];
    if (byCover[s.id]) s.coverUrl = byCover[s.id];
  }
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
