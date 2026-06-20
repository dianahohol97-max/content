/**
 * bloom focus — longform-build.js
 * Assembles 8-10 min documentary YouTube videos from longform_week_X.json.
 *
 * Per video:
 *   1. ElevenLabs → one voiceover MP3 per chapter (measured for real timecodes)
 *   2. Gemini     → bg per scene; sharp burns caption
 *   3. FFmpeg     → concat all scenes (timed), concat chapter audios, mix quiet music
 *                   → 1920x1080 landscape MP4 (long-form is horizontal)
 *   4. Computes real chapter timecodes → injects into description as Chapters list
 *
 * Output: output/longform/week_X/LF_..._.mp4
 * Env: ELEVENLABS_API_KEY, GEMINI_API_KEY
 * Usage: node bloom/longform-build.js --week=29 --limit=1 [--skip-existing]
 */

import "dotenv/config";
import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { fileURLToPath } from "url";
import sharp from "sharp";
import { makeVoiceover as _makeVoiceover } from "./tts.js";

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

const W = 1920, H = 1080; // long-form is landscape
const ELEVEN_KEY = process.env.ELEVENLABS_API_KEY;
const GEMINI_KEY = process.env.GEMINI_API_KEY;
const VOICE_ID = process.env.ELEVENLABS_VOICE_ID || "21m00Tcm4TlvDq8ikWAM";
const MUSIC_PATH = path.join(REPO_ROOT, "bloom/assets/music-calm.mp3");
const REPO_RAW = "https://raw.githubusercontent.com/dianahohol97-max/content/main";

function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function wrapText(text, maxChars) {
  const words = String(text).split(/\s+/);
  const lines = []; let line = "";
  for (const w of words) {
    if ((line + " " + w).trim().length > maxChars) { if (line) lines.push(line); line = w; }
    else line = (line + " " + w).trim();
  }
  if (line) lines.push(line);
  return lines;
}
function fmtTime(sec) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

// Long-form is huge (~8000 chars each) — default to free Gemini TTS so it
// doesn't drain ElevenLabs. Override per-run with VOICE_ENGINE=elevenlabs.
async function makeVoiceover(text, outPath) {
  const engine = process.env.VOICE_ENGINE || "gemini";
  return _makeVoiceover(text, outPath, engine);
}

async function geminiBackground(prompt) {
  if (!GEMINI_KEY) throw new Error("GEMINI_API_KEY missing");
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent?key=${GEMINI_KEY}`;
  const body = JSON.stringify({ contents: [{ parts: [{ text: prompt + " Wide landscape 16:9 composition." }] }] });
  // Gemini image gen is flaky: transient 429/500/503 + "no image" 200s. Retry.
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
      // 200 but no image → transient, retry
    }
    const status = res.ok ? "no-image" : res.status;
    const transient = res.ok || [429, 500, 502, 503, 504].includes(res.status);
    if (!transient) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 160)}`);
    if (attempt === maxAttempts) throw new Error(`Gemini image failed after ${maxAttempts} attempts (last: ${status})`);
    await new Promise((r) => setTimeout(r, 3000 * attempt));
  }
}

// Soft bottom scrim so white subtitles stay readable (landscape).
function bottomScrim() {
  return Buffer.from(`
<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <defs><linearGradient id="f" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0%" stop-color="rgba(40,30,50,0)"/><stop offset="100%" stop-color="rgba(40,30,50,0.6)"/>
  </linearGradient></defs>
  <rect x="0" y="${H-320}" width="${W}" height="320" fill="url(#f)"/>
</svg>`);
}

async function buildSceneImage(scene, outPath) {
  const bg = await geminiBackground(scene.imagePrompt);
  const base = await sharp(bg).resize(W, H, { fit: "cover", position: "centre" }).toBuffer();
  await sharp(base).composite([{ input: bottomScrim(), top: 0, left: 0 }]).png().toFile(outPath);
  return outPath;
}

// ─── Subtitles synced to narration (same approach as Shorts) ────────────────
function splitIntoSubtitles(text, maxWords = 9) {
  const words = String(text).replace(/\s+/g, " ").trim().split(" ");
  const chunks = []; let cur = [];
  for (const w of words) {
    cur.push(w);
    const endsClause = /[.,!?;:]$/.test(w);
    if (cur.length >= maxWords || (endsClause && cur.length >= 4)) { chunks.push(cur.join(" ")); cur = []; }
  }
  if (cur.length) chunks.push(cur.join(" "));
  return chunks;
}

function srtTime(sec) {
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = Math.floor(sec % 60);
  const ms = Math.round((sec - Math.floor(sec)) * 1000);
  const p = (n, l = 2) => String(n).padStart(l, "0");
  return `${p(h)}:${p(m)}:${p(s)},${p(ms, 3)}`;
}

function ffprobeDuration(file) {
  const out = execSync(`ffprobe -v error -show_entries format=duration -of csv=p=0 "${file}"`).toString().trim();
  return parseFloat(out) || 0;
}

function ffmpegAvailable() {
  try { execSync("ffmpeg -version", { stdio: "ignore" }); return true; } catch { return false; }
}

function loadVideos(week) {
  const p = path.join(REPO_ROOT, `longform_week_${week}.json`);
  if (!fs.existsSync(p)) throw new Error(`${p} not found — run longform-generator.js first`);
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

async function main() {
  console.log(`\n🎥 bloom focus — Long-form build — Week ${WEEK}\n${"━".repeat(50)}`);
  if (!ffmpegAvailable()) throw new Error("ffmpeg not found");

  let videos = loadVideos(WEEK);
  if (LIMIT) videos = videos.slice(0, LIMIT);

  const outDir = path.join(REPO_ROOT, `output/longform/week_${WEEK}`);
  fs.mkdirSync(outDir, { recursive: true });

  let done = 0, failed = 0, skipped = 0;
  for (const vid of videos) {
    const mp4Path = path.join(outDir, `${vid.id}.mp4`);
    if (SKIP_EXISTING && fs.existsSync(mp4Path) && fs.statSync(mp4Path).size > 50000) {
      vid.videoUrl = `${REPO_RAW}/output/longform/week_${WEEK}/${vid.id}.mp4`;
      skipped++; console.log(`   ${vid.id} — exists, skip`); continue;
    }
    console.log(`\n▶ ${vid.id}: ${vid.title}`);
    try {
      const workDir = path.join(outDir, `_work_${vid.id}`);
      fs.mkdirSync(workDir, { recursive: true });

      const allScenePaths = [];
      const allDurations = [];
      const chapterTimecodes = [];
      const srtCues = []; // { start, end, text } across the whole video
      let runningTime = 0;

      // Process each chapter: voiceover (measure), scenes, subtitles
      for (let ci = 0; ci < vid.chapters.length; ci++) {
        const ch = vid.chapters[ci];
        console.log(`   📖 ch ${ci + 1}/${vid.chapters.length}: ${ch.title}`);

        // voiceover for chapter → measure its real duration
        process.stdout.write("      🎤 voiceover... ");
        const chVoice = path.join(workDir, `voice_${ci}.mp3`);
        await makeVoiceover(ch.voiceover, chVoice);
        const chDur = ffprobeDuration(chVoice);
        console.log(`✓ ${chDur.toFixed(1)}s`);

        chapterTimecodes.push({ title: ch.title, t: runningTime });

        // subtitles for this chapter, timed within [runningTime, runningTime+chDur]
        const chunks = splitIntoSubtitles(ch.voiceover, 7);
        const lens = chunks.map((c) => Math.max(1, c.trim().split(/\s+/).length));
        const sum = lens.reduce((a, b) => a + b, 0);
        let local = runningTime;
        chunks.forEach((c, i) => {
          const dur = (chDur * lens[i]) / sum;
          srtCues.push({ start: local, end: local + dur, text: c });
          local += dur;
        });

        runningTime += chDur;

        // scenes for chapter — distribute chapter duration across its scenes.
        // If one image ultimately fails, skip just that scene (don't kill the
        // whole video); remaining scenes simply hold a bit longer.
        const scenes = ch.scenes ?? [];
        const builtThisChapter = [];
        for (let si = 0; si < scenes.length; si++) {
          process.stdout.write(`      🖼  scene ${si + 1}/${scenes.length}... `);
          const sp = path.join(workDir, `ch${ci}_s${si}.png`);
          try {
            await buildSceneImage(scenes[si], sp);
            builtThisChapter.push(sp);
            console.log("✓");
          } catch (e) {
            console.log(`✗ skipped (${e.message.slice(0, 40)})`);
          }
          await new Promise((r) => setTimeout(r, 500));
        }
        // fallback: if a chapter produced NO images at all, reuse the last good
        // image we have so the chapter still has visuals.
        if (builtThisChapter.length === 0 && allScenePaths.length > 0) {
          builtThisChapter.push(allScenePaths[allScenePaths.length - 1]);
        }
        const perScene = chDur / Math.max(1, builtThisChapter.length);
        for (const sp of builtThisChapter) {
          allScenePaths.push(sp);
          allDurations.push(perScene);
        }
      }

      // write full-video subtitle track
      const srtPath = path.join(workDir, "subs.srt");
      fs.writeFileSync(srtPath,
        srtCues.map((c, i) => `${i + 1}\n${srtTime(c.start)} --> ${srtTime(c.end)}\n${c.text}\n`).join("\n"));
      console.log(`   💬 ${srtCues.length} subtitle cues`);

      // concat chapter audios into one voiceover track
      process.stdout.write("   🔉 concat audio... ");
      const audioList = path.join(workDir, "audio.txt");
      fs.writeFileSync(audioList,
        vid.chapters.map((_, ci) => `file 'voice_${ci}.mp3'`).join("\n"));
      const fullVoice = path.join(workDir, "voice_full.mp3");
      execSync(`ffmpeg -y -f concat -safe 0 -i audio.txt -c copy voice_full.mp3`, { stdio: "ignore", cwd: workDir });
      console.log("✓");

      // slideshow — scene list uses bare filenames (ffmpeg runs with cwd=workDir)
      process.stdout.write("   🎞  assemble... ");
      const sceneList = path.join(workDir, "scenes.txt");
      let sl = "";
      allScenePaths.forEach((p, i) => { sl += `file '${path.basename(p)}'\nduration ${allDurations[i].toFixed(3)}\n`; });
      sl += `file '${path.basename(allScenePaths[allScenePaths.length - 1])}'\n`;
      fs.writeFileSync(sceneList, sl);

      const vf = `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},fps=30,format=yuv420p`;
      // libass chokes on absolute paths with slashes/colons inside filtergraph.
      // Run ffmpeg with cwd=workDir and reference the .srt by bare filename.
      const subFilter = `,subtitles=subs.srt:force_style='Fontname=Arial,Fontsize=16,Bold=1,PrimaryColour=&H00FFFFFF,OutlineColour=&H803D2C6E,BorderStyle=1,Outline=3,Shadow=0,Alignment=2,MarginV=70,MarginL=240,MarginR=240'`;
      const hasMusic = fs.existsSync(MUSIC_PATH);
      const sceneListName = path.basename(sceneList);
      const fullVoiceName = path.basename(fullVoice);
      let cmd;
      if (hasMusic) {
        cmd = `ffmpeg -y -f concat -safe 0 -i "${sceneListName}" -i "${fullVoiceName}" -stream_loop -1 -i "${MUSIC_PATH}" ` +
          `-filter_complex "[0:v]${vf}${subFilter}[v];[2:a]volume=0.1[m];[1:a][m]amix=inputs=2:duration=first:dropout_transition=2[a]" ` +
          `-map "[v]" -map "[a]" -shortest -c:v libx264 -preset veryfast -crf 23 -c:a aac -b:a 192k -pix_fmt yuv420p "${mp4Path}"`;
      } else {
        cmd = `ffmpeg -y -f concat -safe 0 -i "${sceneListName}" -i "${fullVoiceName}" ` +
          `-filter_complex "[0:v]${vf}${subFilter}[v]" -map "[v]" -map 1:a -shortest ` +
          `-c:v libx264 -preset veryfast -crf 23 -c:a aac -b:a 192k -pix_fmt yuv420p "${mp4Path}"`;
      }
      execSync(cmd, { stdio: "inherit", cwd: workDir });
      console.log("✓");

      // build description with real chapter timecodes
      const chaptersBlock = "Chapters:\n" +
        chapterTimecodes.map((c) => `${fmtTime(c.t)} ${c.title}`).join("\n");
      vid.description = `${vid.description}\n\n${chaptersBlock}\n\n${vid.destinationUrl}`;
      vid.videoUrl = `${REPO_RAW}/output/longform/week_${WEEK}/${vid.id}.mp4`;
      vid.durationSec = Math.round(runningTime);

      done++;
      console.log(`   ✅ ${fmtTime(runningTime)} total`);
    } catch (err) {
      failed++;
      console.log(`   ✗ ${err.message}`);
    } finally {
      // Always remove the intermediate work dir — even if assembly failed —
      // so heavy temp files (PNGs, chapter MP3s) never get committed.
      const wd = path.join(outDir, `_work_${vid.id}`);
      try { fs.rmSync(wd, { recursive: true, force: true }); } catch {}
    }
  }

  // rewrite JSON
  const full = loadVideos(WEEK);
  const byId = Object.fromEntries(videos.map((v) => [v.id, v]));
  for (let i = 0; i < full.length; i++) if (byId[full[i].id]) full[i] = byId[full[i].id];
  fs.writeFileSync(path.join(REPO_ROOT, `longform_week_${WEEK}.json`), JSON.stringify(full, null, 2));
  fs.writeFileSync(path.join(REPO_ROOT, "longform_current.json"), JSON.stringify(full, null, 2));

  console.log(`\n${"━".repeat(50)}\n✅ done ${done} · skipped ${skipped} · failed ${failed}`);
}

main().catch((e) => { console.error("❌", e.message); process.exit(1); });
