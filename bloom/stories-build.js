/**
 * bloom focus — stories-build.js
 * Builds 1080x1920 (9:16) Instagram Story images from stories_week_X.json.
 *
 * Types:
 *   test     → question at top + 2 or 4 image tiles + tap prompt
 *   factcard → one insight big-centered on a pastel Gemini background
 *   cta      → invitation text on a pastel background + (link sticker added by IG)
 *   story    → storytelling slide: overlay text on a fitting background
 *
 * The link sticker itself is added by the Make/Instagram post step (linkStickerUrl).
 * We bake a subtle "↑ tap the link" hint into CTA/test cards.
 *
 * Output: output/stories/week_X/ST_..._.png  (committed; Make reads GitHub raw)
 * Env: GEMINI_API_KEY
 * Usage: node bloom/stories-build.js --week=29 [--limit=N] [--skip-existing]
 */

import "dotenv/config";
import fs from "fs";
import path from "path";
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

async function geminiBackground(prompt) {
  if (!GEMINI_KEY) throw new Error("GEMINI_API_KEY missing");
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent?key=${GEMINI_KEY}`;
  const res = await fetch(url, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt + " Vertical 9:16 portrait composition." }] }] }),
  });
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  const img = (data.candidates?.[0]?.content?.parts ?? []).find((p) => p.inlineData)?.inlineData?.data;
  if (!img) throw new Error("Gemini returned no image");
  return Buffer.from(img, "base64");
}

// fact card / cta / story slide: text on a background
async function buildTextStory(story, outPath, opts = {}) {
  const bg = await geminiBackground(story.imagePrompt || "Realistic aesthetic photograph, soft pastel lavender cream sage blush, cozy minimal, soft natural light, shallow depth of field, no people no text.");
  const base = await sharp(bg).resize(W, H, { fit: "cover", position: "centre" }).toBuffer();

  const text = story.overlayText || story.caption || "";
  const lines = wrapText(text, 22);
  const fontSize = lines.length > 4 ? 64 : 76;
  const lineHeight = fontSize * 1.28;
  const blockH = lines.length * lineHeight;
  const startY = (H - blockH) / 2 + fontSize * 0.7;
  const tspans = lines.map((ln, i) => `<tspan x="${W/2}" dy="${i === 0 ? 0 : lineHeight}">${esc(ln)}</tspan>`).join("");
  const panelY = startY - fontSize - 40;
  const panelH = blockH + 110;

  const hint = opts.tapHint
    ? `<text x="${W/2}" y="${H-150}" font-family="Arial, sans-serif" font-size="40" font-weight="700" fill="#ffffff" text-anchor="middle">${esc(opts.tapHint)} ↑</text>`
    : "";

  const overlay = Buffer.from(`
<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <rect x="70" y="${panelY}" width="${W-140}" height="${panelH}" rx="36" fill="rgba(255,248,240,0.92)"/>
  <text x="${W/2}" y="${startY}" font-family="Georgia, serif" font-size="${fontSize}" font-weight="700"
        fill="#3d2c6e" text-anchor="middle" style="letter-spacing:-0.5px;">${tspans}</text>
  ${hint}
  <text x="${W/2}" y="${H-80}" font-family="Arial, sans-serif" font-size="32" font-weight="500"
        fill="rgba(255,255,255,0.9)" text-anchor="middle">bloomfocus.org</text>
</svg>`);
  await sharp(base).composite([{ input: overlay, top: 0, left: 0 }]).png().toFile(outPath);
  return outPath;
}

// visual test: question + 2 or 4 tiles + tap hint
async function buildTestStory(story, outPath) {
  const count = Number(story.optionCount) === 4 ? 4 : 2;
  const opts = (story.options || []).slice(0, count);

  let tiles = [];
  if (count === 2) {
    const tw = W, th = Math.floor((H - 700) / 2);
    for (let i = 0; i < 2; i++) {
      const raw = await geminiBackground(opts[i]?.imagePrompt || "pastel aesthetic minimal scene no people no text");
      const t = await sharp(raw).resize(tw, th, { fit: "cover" }).toBuffer();
      const badge = Buffer.from(`<svg width="${tw}" height="${th}" xmlns="http://www.w3.org/2000/svg">
        <circle cx="80" cy="80" r="50" fill="rgba(61,44,110,0.92)"/>
        <text x="80" y="100" font-family="Arial" font-size="56" font-weight="800" fill="#fff" text-anchor="middle">${i+1}</text>
        <rect x="0" y="${th-70}" width="${tw}" height="70" fill="rgba(40,30,50,0.5)"/>
        <text x="${tw/2}" y="${th-24}" font-family="Arial" font-size="36" font-weight="700" fill="#fff" text-anchor="middle">${esc(opts[i]?.label||"")}</text>
      </svg>`);
      tiles.push({ buf: await sharp(t).composite([{ input: badge, top: 0, left: 0 }]).png().toBuffer(), top: 360 + i * th, left: 0, w: tw, h: th });
    }
  } else {
    const tw = Math.floor(W / 2), th = Math.floor((H - 700) / 2);
    for (let i = 0; i < 4; i++) {
      const raw = await geminiBackground(opts[i]?.imagePrompt || "pastel aesthetic minimal scene no people no text");
      const t = await sharp(raw).resize(tw, th, { fit: "cover" }).toBuffer();
      const badge = Buffer.from(`<svg width="${tw}" height="${th}" xmlns="http://www.w3.org/2000/svg">
        <circle cx="60" cy="60" r="42" fill="rgba(61,44,110,0.92)"/>
        <text x="60" y="78" font-family="Arial" font-size="48" font-weight="800" fill="#fff" text-anchor="middle">${i+1}</text>
        <rect x="0" y="${th-62}" width="${tw}" height="62" fill="rgba(40,30,50,0.5)"/>
        <text x="${tw/2}" y="${th-22}" font-family="Arial" font-size="30" font-weight="700" fill="#fff" text-anchor="middle">${esc(opts[i]?.label||"")}</text>
      </svg>`);
      tiles.push({ buf: await sharp(t).composite([{ input: badge, top: 0, left: 0 }]).png().toBuffer(), top: 360 + Math.floor(i/2)*th, left: (i%2)*tw, w: tw, h: th });
    }
  }

  const qLines = wrapText(story.question || "Which one is you?", 20);
  const qSpans = qLines.map((ln, i) => `<tspan x="${W/2}" dy="${i===0?0:78}">${esc(ln)}</tspan>`).join("");
  const banner = Buffer.from(`
<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <rect x="0" y="0" width="${W}" height="${H}" fill="#FFF8F0"/>
  <text x="${W/2}" y="170" font-family="Georgia, serif" font-size="68" font-weight="800" fill="#3d2c6e" text-anchor="middle">${qSpans}</text>
  <text x="${W/2}" y="${H-200}" font-family="Arial" font-size="44" font-weight="700" fill="#3d2c6e" text-anchor="middle">${esc(story.overlayText||"Tap the link to find out")}</text>
  <text x="${W/2}" y="${H-130}" font-family="Arial" font-size="40" font-weight="800" fill="#7c6bb0" text-anchor="middle">Take the quiz ↑</text>
</svg>`);

  await sharp(banner).composite(tiles.map((t) => ({ input: t.buf, top: t.top, left: t.left }))).png().toFile(outPath);
  return outPath;
}

function loadStories(week) {
  const p = path.join(REPO_ROOT, `stories_week_${week}.json`);
  if (!fs.existsSync(p)) throw new Error(`${p} not found — run stories-generator.js first`);
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

async function main() {
  console.log(`\n📱 bloom focus — Stories build — Week ${WEEK}\n${"━".repeat(50)}`);
  let stories = loadStories(WEEK);
  if (LIMIT) stories = stories.slice(0, LIMIT);

  const outDir = path.join(REPO_ROOT, `output/stories/week_${WEEK}`);
  fs.mkdirSync(outDir, { recursive: true });

  let done = 0, failed = 0, skipped = 0;
  for (const s of stories) {
    const outPath = path.join(outDir, `${s.id}.png`);
    if (SKIP_EXISTING && fs.existsSync(outPath) && fs.statSync(outPath).size > 10000) {
      s.generatedImageURL = `${REPO_RAW}/output/stories/week_${WEEK}/${s.id}.png`;
      skipped++; console.log(`   ${s.id} — exists, skip`); continue;
    }
    process.stdout.write(`   ${s.id} [${s.storyType}]... `);
    try {
      if (s.storyType === "test") await buildTestStory(s, outPath);
      else if (s.storyType === "cta") await buildTextStory(s, outPath, { tapHint: "Tap the link" });
      else await buildTextStory(s, outPath); // factcard, story
      s.generatedImageURL = `${REPO_RAW}/output/stories/week_${WEEK}/${s.id}.png`;
      done++; console.log("✓");
      await new Promise((r) => setTimeout(r, 500));
    } catch (e) {
      failed++; console.log(`✗ ${e.message}`);
    }
  }

  const full = loadStories(WEEK);
  const byId = Object.fromEntries(stories.filter((s) => s.generatedImageURL).map((s) => [s.id, s.generatedImageURL]));
  for (const s of full) if (byId[s.id]) s.generatedImageURL = byId[s.id];
  fs.writeFileSync(path.join(REPO_ROOT, `stories_week_${WEEK}.json`), JSON.stringify(full, null, 2));
  fs.writeFileSync(path.join(REPO_ROOT, "stories_current.json"), JSON.stringify(full, null, 2));

  console.log(`\n${"━".repeat(50)}\n✅ done ${done} · skipped ${skipped} · failed ${failed}`);
}

main().catch((e) => { console.error("❌", e.message); process.exit(1); });
