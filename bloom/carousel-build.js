/**
 * bloom focus — carousel-build.js
 * Renders 1080x1350 (4:5) carousel slides from carousel_week_X.json.
 * Each slide: library-backed pastel background + headline + body on a soft card.
 * Output: output/carousels/week_X/CR_..._01.png ... (committed; Make reads raw)
 *
 *   node bloom/carousel-build.js --week=29 [--limit=N]
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import sharp from "sharp";
import { getOrCreate, normalizeTag, writeLibraryManifest, libraryStats } from "./image-library.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const REPO_RAW = "https://raw.githubusercontent.com/dianahohol97-max/content/main";
const GEMINI_KEY = process.env.GEMINI_API_KEY;

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const [k, v] = a.replace(/^--/, "").split("=");
  return [k, v ?? true];
}));
const WEEK = parseInt(args.week) || 29;
const LIMIT = args.limit ? parseInt(args.limit) : null;

const W = 1080, H = 1350;

function esc(s) {
  return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function wrapText(text, max) {
  const words = String(text || "").split(/\s+/);
  const lines = []; let cur = "";
  for (const w of words) {
    if ((cur + " " + w).trim().length > max) { if (cur) lines.push(cur); cur = w; }
    else cur = (cur + " " + w).trim();
  }
  if (cur) lines.push(cur);
  return lines;
}

async function geminiBackground(prompt) {
  if (!GEMINI_KEY) throw new Error("GEMINI_API_KEY missing");
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent?key=${GEMINI_KEY}`;
  const body = JSON.stringify({ contents: [{ parts: [{ text: prompt + "" }] }] });
  const maxAttempts = 5;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let res;
    try { res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body }); }
    catch (e) { if (attempt === maxAttempts) throw new Error(`Gemini net: ${e.message}`); await new Promise(r => setTimeout(r, 3000 * attempt)); continue; }
    if (res.ok) {
      const data = await res.json();
      const img = (data.candidates?.[0]?.content?.parts ?? []).find(p => p.inlineData)?.inlineData?.data;
      if (img) return Buffer.from(img, "base64");
    }
    const transient = res.ok || [429, 500, 502, 503, 504].includes(res.status);
    if (!transient) throw new Error(`Gemini ${res.status}`);
    if (attempt === maxAttempts) throw new Error(`Gemini image failed after ${maxAttempts} attempts`);
    await new Promise(r => setTimeout(r, 3000 * attempt));
  }
}

// Background for a slide tag — library-backed (reuse/cache, square aspect).
async function slideBackground(scene, dest) {
  const tag = scene.tag || normalizeTag((scene.imagePrompt || "scene").slice(0, 30));
  await getOrCreate(tag, "portrait", async () => {
    const bg = await geminiBackground(scene.imagePrompt);
    return await sharp(bg).resize(W, H, { fit: "cover", position: "centre" }).png().toBuffer();
  }, dest);
  return dest;
}

// Render one slide: bg + headline (big) + body (smaller) on a soft cream card.
async function buildSlide(slide, idx, total, outPath, workDir) {
  const bgPath = path.join(workDir, `bg_${idx}.png`);
  await slideBackground(slide, bgPath);
  const base = await sharp(bgPath).resize(W, H, { fit: "cover" }).toBuffer();

  const headline = slide.headline || "";
  const body = slide.body || "";
  const hLines = wrapText(headline, 20);
  const bLines = body ? wrapText(body, 34) : [];

  const hFont = hLines.length > 2 ? 64 : 76;
  const hLH = hFont * 1.2;
  const bFont = 40, bLH = bFont * 1.35;
  const hBlock = hLines.length * hLH;
  const bBlock = bLines.length * bLH;
  const gap = bLines.length ? 40 : 0;
  const totalBlock = hBlock + gap + bBlock;
  const cardPad = 70;
  const cardH = totalBlock + cardPad * 2;
  const cardY = (H - cardH) / 2;

  let hStartY = cardY + cardPad + hFont * 0.8;
  const hSpans = hLines.map((ln, i) => `<tspan x="${W/2}" dy="${i === 0 ? 0 : hLH}">${esc(ln)}</tspan>`).join("");
  let bStartY = cardY + cardPad + hBlock + gap + bFont * 0.8;
  const bSpans = bLines.map((ln, i) => `<tspan x="${W/2}" dy="${i === 0 ? 0 : bLH}">${esc(ln)}</tspan>`).join("");

  const overlay = Buffer.from(`
<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <rect x="60" y="${cardY}" width="${W-120}" height="${cardH}" rx="40" fill="rgba(255,248,240,0.94)"/>
  <text x="${W/2}" y="${hStartY}" font-family="Georgia, serif" font-size="${hFont}" font-weight="800"
        fill="#3d2c6e" text-anchor="middle" style="letter-spacing:-0.5px;">${hSpans}</text>
  ${bLines.length ? `<text x="${W/2}" y="${bStartY}" font-family="Arial, sans-serif" font-size="${bFont}" font-weight="500" fill="#5a4a8a" text-anchor="middle">${bSpans}</text>` : ""}
  <text x="${W/2}" y="${H-50}" font-family="Arial, sans-serif" font-size="30" font-weight="600" fill="rgba(61,44,110,0.55)" text-anchor="middle">${idx + 1} / ${total}   ·   bloomfocus.org</text>
  ${idx === 0 ? `<text x="${W/2}" y="${cardY-30}" font-family="Arial, sans-serif" font-size="38" font-weight="700" fill="#ffffff" text-anchor="middle" stroke="#3d2c6e" stroke-width="1" paint-order="stroke">Save this 🔖</text>` : ""}
</svg>`);
  await sharp(base).composite([{ input: overlay, top: 0, left: 0 }]).jpeg({ quality: 90 }).toFile(outPath);
  return outPath;
}

async function main() {
  console.log(`\n🎠 bloom focus — Carousel build — Week ${WEEK}\n${"━".repeat(50)}\n`);
  const jsonPath = path.join(REPO_ROOT, `carousel_week_${WEEK}.json`);
  if (!fs.existsSync(jsonPath)) { console.error(`✗ ${jsonPath} not found — run carousel-generator first`); process.exit(1); }
  const carousels = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
  const todo = LIMIT ? carousels.slice(0, LIMIT) : carousels;

  const outDir = path.join(REPO_ROOT, `output/carousels/week_${WEEK}`);
  fs.mkdirSync(outDir, { recursive: true });

  let done = 0, failed = 0;
  for (const c of todo) {
    console.log(`▶ ${c.id}: ${c.title} (${c.slides.length} slides)`);
    const workDir = path.join(outDir, `_work_${c.id}`);
    fs.mkdirSync(workDir, { recursive: true });
    try {
      const urls = [];
      for (let i = 0; i < c.slides.length; i++) {
        process.stdout.write(`   🖼  slide ${i + 1}/${c.slides.length}... `);
        const sp = path.join(outDir, `${c.id}_${String(i + 1).padStart(2, "0")}.jpg`);
        await buildSlide(c.slides[i], i, c.slides.length, sp, workDir);
        urls.push(`${REPO_RAW}/output/carousels/week_${WEEK}/${c.id}_${String(i + 1).padStart(2, "0")}.jpg`);
        console.log("✓");
        await new Promise(r => setTimeout(r, 400));
      }
      c.slideImageURLs = urls;
      c.files = urls.map((u) => ({ media_type: "IMAGE", image_url: u }));
      done++;
      console.log(`   ✅ ${urls.length} slides`);
    } catch (err) {
      failed++;
      console.log(`   ✗ ${err.message}`);
    } finally {
      try { fs.rmSync(workDir, { recursive: true, force: true }); } catch {}
    }
  }

  // write back URLs + current pointer
  const full = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
  const byId = Object.fromEntries(carousels.filter(c => c.slideImageURLs?.length).map(c => [c.id, c]));
  for (const c of full) if (byId[c.id]) { c.slideImageURLs = byId[c.id].slideImageURLs; c.files = byId[c.id].files; }
  fs.writeFileSync(jsonPath, JSON.stringify(full, null, 2));
  fs.writeFileSync(path.join(REPO_ROOT, "carousel_current.json"), JSON.stringify(full, null, 2));

  try { writeLibraryManifest(); } catch {}
  try { const s = libraryStats("portrait"); console.log(`   📚 portrait library: ${s.total} images across ${Object.keys(s.tags).length} tags`); } catch {}

  console.log(`\n${"━".repeat(50)}\n✅ done ${done} · failed ${failed}`);
}

main().catch((e) => { console.error("✗", e); process.exit(1); });
