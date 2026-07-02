/**
 * bloom focus — carousel-build.js  (v2 — journal design system, pure SVG via sharp)
 * Renders typed slides from carousel_week_X.json into 1080x1350 JPEGs.
 * No AI image generation — fonts + code only.
 *
 *   node bloom/carousel-build.js --week=27 [--limit=N]
 */

import sharp from "sharp";
import fs from "fs";
import path from "path";
import os from "os";
import { execSync } from "child_process";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const [k, v] = a.replace(/^--/, "").split("=");
  return [k, v ?? true];
}));
function isoWeek(d = new Date()) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return Math.ceil((((t - yearStart) / 86400000) + 1) / 7);
}
const WEEK = parseInt(args.week) || isoWeek();
const LIMIT = args.limit ? parseInt(args.limit) : Infinity;

const RAW_BASE = "https://raw.githubusercontent.com/dianahohol97-max/content/main";

// ---------------- font bootstrap ----------------
const FONTS = [
  ["PlayfairDisplay.ttf", "https://raw.githubusercontent.com/google/fonts/main/ofl/playfairdisplay/PlayfairDisplay%5Bwght%5D.ttf"],
  ["PlayfairDisplayItalic.ttf", "https://raw.githubusercontent.com/google/fonts/main/ofl/playfairdisplay/PlayfairDisplay-Italic%5Bwght%5D.ttf"],
  ["Poppins-ExtraBold.ttf", "https://raw.githubusercontent.com/google/fonts/main/ofl/poppins/Poppins-ExtraBold.ttf"],
  ["Poppins-Medium.ttf", "https://raw.githubusercontent.com/google/fonts/main/ofl/poppins/Poppins-Medium.ttf"],
  ["Caveat.ttf", "https://raw.githubusercontent.com/google/fonts/main/ofl/caveat/Caveat%5Bwght%5D.ttf"],
];
async function ensureFonts() {
  const dir = path.join(os.homedir(), ".fonts");
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, url] of FONTS) {
    const p = path.join(dir, name);
    if (fs.existsSync(p) && fs.statSync(p).size > 10000) continue;
    console.log(`  ⬇ font ${name}`);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`font ${name}: HTTP ${res.status}`);
    fs.writeFileSync(p, Buffer.from(await res.arrayBuffer()));
  }
  try { execSync("fc-cache -f", { stdio: "ignore" }); } catch { /* fine locally */ }
}

// ---------------- design tokens ----------------
const W = 1080, H = 1350;
const INK = "#3d2c6e";
const UNDERLINES = ["#E8A0BC", "#8FBF9F", "#8FB8D8", "#B79CE8"];
const TAPES = ["#F2D9A0", "#C9E4D0", "#F4C9D8", "#CFE3F5"];
const GRADS = {
  chapters:   ["#E8DEFF", "#FFE9F1", "#D4EEFF"],
  steps:      ["#DFF0E4", "#FFF4E2", "#D4EEFF"],
  quiz:       ["#FFE9F1", "#F3E8FF", "#D4EEFF"],
  myth:       ["#E8DEFF", "#FFE9F1", "#FFEFE2"],
  truth:      ["#DFF0E4", "#F0FFF4", "#D4EEFF"],
  diary:      ["#FFEFE2", "#FFE9F1", "#E8DEFF"],
  dictionary: ["#E8DEFF", "#FFE9F1", "#D4EEFF"],
  reset:      ["#D8E6F5", "#E8E4F8", "#EAF4EF"],
};
const PILLS = {
  myth: "✦ myth-busting monday",
  quiz: "✦ which one are you?",
  steps: "✦ actually useful",
  chapters: "✦ know your brain",
  diary: "✦ dear ADHD diary",
  dictionary: "✦ word of the week",
  reset: "✦ sunday reset",
};
const HEADER_LABEL = {
  myth: (s) => `myth no. ${s.idx || 1}`,
  truth: () => "the truth",
  quiz: (s) => `type ${s.letter || "A"}`,
  step: (s) => `step ${String(s.idx || 1).padStart(2, "0")}`,
  chapter: (s) => `chapter ${String(s.idx || 1).padStart(2, "0")}`,
  diary: () => "dear diary",
  dict: () => "the ADHD dictionary",
  checklist: () => "quick recap",
  reset: () => "sunday reset",
  cta: () => "the last page",
};
const DEFAULT_KICKERS = {
  myth: "except... it's not true →",
  truth: "tell someone who needs this →",
  quiz: "is this you? →",
  step: "try this one →",
  chapter: "sound familiar?",
  diary: "it's not just you →",
  checklist: "screenshot this one 📸",
  reset: "breathe. that's it.",
};

// ---------------- helpers ----------------
function esc(s) { return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;"); }
function wrapLine(text, max) {
  const words = String(text || "").split(/\s+/).filter(Boolean);
  const lines = []; let cur = "";
  for (const w of words) {
    if ((cur + " " + w).trim().length > max) { if (cur) lines.push(cur); cur = w; }
    else cur = (cur + " " + w).trim();
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [""];
}
function wrapText(text, max) { return String(text || "").split(/\r?\n/).flatMap((l) => (l.trim() === "" ? [""] : wrapLine(l, max))); }
function grad(rubric) {
  const [a, b, c] = GRADS[rubric] || GRADS.chapters;
  return `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
  <stop offset="0%" stop-color="${a}"/><stop offset="55%" stop-color="${b}"/><stop offset="100%" stop-color="${c}"/>
</linearGradient></defs><rect width="${W}" height="${H}" fill="url(#g)"/>
<circle cx="950" cy="140" r="180" fill="rgba(255,255,255,0.35)"/>
<circle cx="110" cy="${H - 160}" r="140" fill="rgba(255,255,255,0.3)"/>`;
}
function tape(cx, cy, fill, angle) { return `<rect x="${cx - 110}" y="${cy - 28}" width="220" height="56" rx="8" fill="${fill}" opacity="0.85" transform="rotate(${angle} ${cx} ${cy})"/>`; }
function header(label, right) {
  return `<text x="100" y="170" font-family="Caveat" font-weight="700" font-size="64" fill="${INK}">${esc(label)}</text>
<text x="${W - 100}" y="165" font-family="Poppins" font-weight="500" font-size="28" fill="rgba(61,44,110,0.55)" text-anchor="end">${esc(right)}</text>`;
}
function footer(kicker, site = "bloomfocus.org") {
  return `<text x="100" y="${H - 100}" font-family="Caveat" font-weight="700" font-size="56" fill="${INK}">${esc(kicker)}</text>
<text x="${W - 100}" y="${H - 104}" font-family="Poppins" font-weight="500" font-size="26" fill="rgba(61,44,110,0.5)" text-anchor="end">${esc(site)}</text>`;
}
function spans(lines, x, lh) { return lines.map((l, i) => `<tspan x="${x}" dy="${i === 0 ? 0 : lh}">${esc(l)}</tspan>`).join(""); }
const svgWrap = (inner) => `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">${inner}</svg>`;

// ---------------- slide renderers ----------------
function hookSVG(s, rubric, total) {
  const hLines = wrapText(s.headline, 16);
  const hFont = hLines.length > 4 ? 72 : hLines.length > 3 ? 82 : 92;
  const hLH = hFont * 1.16;
  const sLines = wrapText(s.sub, 34);
  const sFont = 40, sLH = sFont * 1.5;
  const cardY = 290, cardH = H - 560;
  const pillH = 58, pillGap = 40;
  const blockH = pillH + pillGap + hLines.length * hLH + (sLines.length ? 50 + sLines.length * sLH : 0);
  const topPad = Math.max(60, (cardH - blockH) / 2);
  const pillY = cardY + topPad;
  const pillText = PILLS[rubric] || "✦ bloom focus";
  const pillW = Math.max(300, pillText.length * 16 + 60);
  const hY = pillY + pillH + pillGap + hFont * 0.78;
  const sY = hY + (hLines.length - 1) * hLH + 50 + sFont * 0.9;
  return svgWrap(`${grad(rubric)}
  <text x="100" y="170" font-family="Caveat" font-weight="700" font-size="72" fill="${INK}">bloom focus</text>
  <text x="${W - 100}" y="165" font-family="Poppins" font-weight="500" font-size="28" fill="rgba(61,44,110,0.55)" text-anchor="end">@bloomfocus.adhd</text>
  <rect x="90" y="${cardY}" width="${W - 180}" height="${cardH}" rx="24" fill="rgba(255,252,248,0.95)" transform="rotate(-1 ${W / 2} ${cardY + cardH / 2})"/>
  ${tape(W / 2, cardY - 2, TAPES[0], -3)}
  <rect x="150" y="${pillY}" width="${pillW}" height="${pillH}" rx="${pillH / 2}" fill="${GRADS[rubric] ? GRADS[rubric][0] : "#E8DEFF"}"/>
  <text x="${150 + pillW / 2}" y="${pillY + 39}" font-family="Poppins" font-weight="500" font-size="28" fill="${INK}" text-anchor="middle">${esc(pillText)}</text>
  <text x="150" y="${hY}" font-family="Playfair Display" font-weight="700" font-size="${hFont}" fill="${INK}" style="letter-spacing:-1px;">${spans(hLines, 150, hLH)}</text>
  ${sLines.length ? `<text x="150" y="${sY}" font-family="Poppins" font-weight="500" font-size="${sFont}" fill="#4a3a7a">${spans(sLines, 150, sLH)}</text>` : ""}
  <text x="100" y="${H - 150}" font-family="Caveat" font-weight="700" font-size="60" fill="${INK}">save this for later 🔖</text>
  <text x="${W - 100}" y="${H - 150}" font-family="Caveat" font-weight="700" font-size="60" fill="${INK}" text-anchor="end">swipe →</text>
  <text x="${W / 2}" y="${H - 70}" font-family="Poppins" font-weight="500" font-size="26" fill="rgba(61,44,110,0.45)" text-anchor="middle">1 / ${total}</text>`);
}

function chapterStepSVG(s, rubric, pos, total, isStep) {
  const idx = s.idx || 1;
  const under = UNDERLINES[(idx - 1) % UNDERLINES.length];
  const tp = TAPES[(idx - 1) % TAPES.length];
  const tilt = idx % 2 === 0 ? -1 : 1;
  const hLines = wrapText(s.headline, isStep ? 18 : 20);
  const hFont = hLines.length > 2 ? 58 : isStep ? 66 : 70;
  const hLH = hFont * 1.18;
  let bFont = 38, bLines = s.body ? wrapText(s.body, 42) : [];
  if (bLines.length > 12) { bFont = 30; bLines = wrapText(s.body, 52); }
  else if (bLines.length > 9) { bFont = 34; bLines = wrapText(s.body, 46); }
  const bLH = bFont * 1.5;
  const numBlock = isStep ? 160 : 0;
  const inner = 110 + numBlock + hLines.length * hLH + 34 + 46 + bLines.length * bLH + 90;
  const cardH = Math.min(inner, H - 400);
  const cardY = (H - cardH) / 2 - 20;
  const numY = cardY + 118;
  const hY = (isStep ? numY + 70 : cardY + 110) + hFont * 0.75;
  const underY = hY + (hLines.length - 1) * hLH + 32;
  const bY = underY + 52 + bFont * 0.85;
  const label = (isStep ? HEADER_LABEL.step : HEADER_LABEL.chapter)(s);
  return svgWrap(`${grad(rubric)}
  ${header(label, `${pos} / ${total}`)}
  <rect x="90" y="${cardY}" width="${W - 180}" height="${cardH}" rx="24" fill="rgba(255,252,248,0.95)" transform="rotate(${tilt} ${W / 2} ${cardY + cardH / 2})"/>
  ${tape(W / 2, cardY - 2, tp, tilt * -3)}
  ${isStep ? `<circle cx="196" cy="${numY}" r="46" fill="none" stroke="${under}" stroke-width="8"/>
  <text x="196" y="${numY + 18}" font-family="Caveat" font-weight="700" font-size="58" fill="${INK}" text-anchor="middle">${idx}</text>` : ""}
  <text x="150" y="${hY}" font-family="Playfair Display" font-weight="700" font-size="${hFont}" fill="${INK}">${spans(hLines, 150, hLH)}</text>
  <path d="M 150 ${underY} q 130 26 ${Math.min(hLines[hLines.length - 1].length * hFont * 0.5, 560)} 6" stroke="${under}" stroke-width="10" fill="none" stroke-linecap="round"/>
  ${bLines.length ? `<text x="150" y="${bY}" font-family="Poppins" font-weight="500" font-size="${bFont}" fill="#4a3a7a">${spans(bLines, 150, bLH)}</text>` : ""}
  ${footer(s.kicker || DEFAULT_KICKERS[isStep ? "step" : "chapter"])}`);
}

function checklistSVG(s, rubric, pos, total) {
  const hLines = wrapText(s.headline, 20);
  const hFont = 62, hLH = hFont * 1.18;
  const items = s.items || [];
  const itemFont = 38;
  const wrapped = items.map((t) => wrapText(t, 34));
  const listH = wrapped.reduce((a, ls) => a + Math.max(1, ls.length) * itemFont * 1.35 + 52, 0);
  const inner = 140 + hLines.length * hLH + 60 + listH + 80;
  const cardH = Math.min(inner, H - 380);
  const cardY = (H - cardH) / 2 - 20;
  const hY = cardY + 110 + hFont * 0.75;
  let y = hY + (hLines.length - 1) * hLH + 90;
  let list = "";
  wrapped.forEach((ls) => {
    const boxY = y - 30;
    list += `<rect x="150" y="${boxY}" width="44" height="44" rx="10" fill="none" stroke="${INK}" stroke-width="5"/>
    <path d="M 158 ${boxY + 22} l 12 14 l 22 -26" stroke="#8FBF9F" stroke-width="7" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`;
    ls.forEach((ln, j) => { list += `<text x="230" y="${y + j * itemFont * 1.35}" font-family="Poppins" font-weight="500" font-size="${itemFont}" fill="#4a3a7a">${esc(ln)}</text>`; });
    y += Math.max(1, ls.length) * itemFont * 1.35 + 52;
  });
  return svgWrap(`${grad(rubric)}
  ${header("quick recap", `${pos} / ${total}`)}
  <rect x="90" y="${cardY}" width="${W - 180}" height="${cardH}" rx="24" fill="rgba(255,252,248,0.95)" transform="rotate(1 ${W / 2} ${cardY + cardH / 2})"/>
  ${tape(W / 2, cardY - 2, TAPES[3], 3)}
  <text x="150" y="${hY}" font-family="Playfair Display" font-weight="700" font-size="${hFont}" fill="${INK}">${spans(hLines, 150, hLH)}</text>
  ${list}
  ${footer(s.kicker || DEFAULT_KICKERS.checklist)}`);
}

function quizSVG(s, rubric, pos, total) {
  const colors = { A: "#E8A0BC", B: "#8FBF9F", C: "#8FB8D8", D: "#B79CE8" };
  const letter = (s.letter || "A").toUpperCase();
  const col = colors[letter] || "#E8A0BC";
  const hLines = wrapText(s.typeName || s.headline, 18);
  const hFont = hLines.length > 2 ? 56 : 66, hLH = hFont * 1.18;
  let bFont = 37, bLines = wrapText(s.body, 40), bLH0 = 1.5;
  if (bLines.length > 10) { bFont = 32; bLines = wrapText(s.body, 46); }
  const bLH = bFont * bLH0;
  const inner = 210 + hLines.length * hLH + 46 + bLines.length * bLH + 80;
  const cardH = Math.min(inner, H - 400), cardY = (H - cardH) / 2 - 20;
  const letY = cardY + 150;
  const hY = letY + 110 + hFont * 0.7;
  const bY = hY + (hLines.length - 1) * hLH + 46 + bFont * 0.85;
  const idx = "ABCD".indexOf(letter);
  return svgWrap(`${grad(rubric)}
  ${header(`type ${letter}`, `${pos} / ${total}`)}
  <rect x="90" y="${cardY}" width="${W - 180}" height="${cardH}" rx="24" fill="rgba(255,252,248,0.95)" transform="rotate(${idx % 2 ? 1 : -1} ${W / 2} ${cardY + cardH / 2})"/>
  ${tape(W / 2, cardY - 2, col, idx % 2 ? 3 : -3)}
  <circle cx="216" cy="${letY}" r="66" fill="${col}"/>
  <text x="216" y="${letY + 30}" font-family="Playfair Display" font-weight="700" font-size="86" fill="#FFF6EE" text-anchor="middle">${letter}</text>
  <text x="150" y="${hY}" font-family="Playfair Display" font-weight="700" font-size="${hFont}" fill="${INK}">${spans(hLines, 150, hLH)}</text>
  <text x="150" y="${bY}" font-family="Poppins" font-weight="500" font-size="${bFont}" fill="#4a3a7a">${spans(bLines, 150, bLH)}</text>
  ${footer(s.kicker || DEFAULT_KICKERS.quiz, "bloomfocus.org/quiz")}`);
}

function mythSVG(s, rubric, pos, total) {
  const hLines = wrapText(s.headline || s.mythText, 18);
  const hFont = hLines.length > 3 ? 62 : 72, hLH = hFont * 1.2;
  const cardH = Math.max(560, 280 + hLines.length * hLH + 170);
  const cardY = (H - cardH) / 2 - 20;
  const hY = cardY + 190 + hFont * 0.75;
  const strikes = hLines.map((l, i) => {
    const y = hY + i * hLH - hFont * 0.28;
    const w = Math.min(l.length * hFont * 0.46, 720);
    return `<path d="M ${W / 2 - w / 2} ${y} q ${w / 2} ${i % 2 ? 14 : -14} ${w} 0" stroke="#D9737F" stroke-width="9" fill="none" stroke-linecap="round"/>`;
  }).join("");
  return svgWrap(`${grad("myth")}
  ${header(`myth no. ${s.idx || 1}`, `${pos} / ${total}`)}
  <rect x="90" y="${cardY}" width="${W - 180}" height="${cardH}" rx="24" fill="rgba(255,252,248,0.95)" transform="rotate(-1 ${W / 2} ${cardY + cardH / 2})"/>
  ${tape(W / 2, cardY - 2, "#F4C9D8", -3)}
  <text x="${W / 2}" y="${cardY + 110}" font-family="Poppins" font-weight="500" font-size="30" fill="#D9737F" text-anchor="middle" letter-spacing="4">EVERYONE SAYS:</text>
  <text x="${W / 2}" y="${hY}" font-family="Playfair Display" font-weight="700" font-size="${hFont}" fill="${INK}" text-anchor="middle">${spans(hLines, W / 2, hLH)}</text>
  ${strikes}
  <text x="${W / 2}" y="${cardY + cardH - 90}" font-family="Caveat" font-weight="700" font-size="58" fill="${INK}" text-anchor="middle">${esc(s.kicker || DEFAULT_KICKERS.myth)}</text>
  <text x="${W - 100}" y="${H - 104}" font-family="Poppins" font-weight="500" font-size="26" fill="rgba(61,44,110,0.5)" text-anchor="end">bloomfocus.org</text>`);
}

function truthSVG(s, rubric, pos, total) {
  const hLines = wrapText(s.headline, 20);
  const hFont = hLines.length > 2 ? 58 : 66, hLH = hFont * 1.18;
  let bFont = 37, bLines = wrapText(s.body, 42);
  if (bLines.length > 9) { bFont = 33; bLines = wrapText(s.body, 47); }
  const bLH = bFont * 1.5;
  const inner = 200 + hLines.length * hLH + 46 + bLines.length * bLH + 90;
  const cardH = Math.min(inner, H - 400), cardY = (H - cardH) / 2 - 20;
  const hY = cardY + 170 + hFont * 0.7;
  const bY = hY + (hLines.length - 1) * hLH + 46 + bFont * 0.85;
  return svgWrap(`${grad("truth")}
  ${header("the truth", `${pos} / ${total}`)}
  <rect x="90" y="${cardY}" width="${W - 180}" height="${cardH}" rx="24" fill="rgba(255,252,248,0.95)" transform="rotate(1 ${W / 2} ${cardY + cardH / 2})"/>
  ${tape(W / 2, cardY - 2, "#C9E4D0", 3)}
  <circle cx="196" cy="${cardY + 108}" r="40" fill="none" stroke="#8FBF9F" stroke-width="7"/>
  <path d="M 178 ${cardY + 108} l 13 15 l 25 -30" stroke="#8FBF9F" stroke-width="8" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
  <text x="150" y="${hY}" font-family="Playfair Display" font-weight="700" font-size="${hFont}" fill="${INK}">${spans(hLines, 150, hLH)}</text>
  <text x="150" y="${bY}" font-family="Poppins" font-weight="500" font-size="${bFont}" fill="#4a3a7a">${spans(bLines, 150, bLH)}</text>
  ${footer(s.kicker || DEFAULT_KICKERS.truth)}`);
}

function dictSVG(s, rubric, pos, total) {
  const cardY = 210, cardH = H - 420;
  let y = cardY + 320;
  let defsSvg = "";
  (s.defs || []).forEach((d, i) => {
    const ls = wrapText(d, 38);
    defsSvg += `<text x="170" y="${y}" font-family="Playfair Display" font-style="italic" font-weight="500" font-size="34" fill="#A98F6F">${i + 1}.</text>`;
    ls.forEach((l, j) => { defsSvg += `<text x="230" y="${y + j * 52}" font-family="Poppins" font-weight="500" font-size="35" fill="#4a3a7a">${esc(l)}</text>`; });
    y += ls.length * 52 + 40;
  });
  const exLines = wrapText('"' + (s.example || "") + '"', 38);
  const exY = y + 40;
  return svgWrap(`${grad("dictionary")}
  ${header("the ADHD dictionary", `${pos} / ${total}`)}
  <rect x="90" y="${cardY}" width="${W - 180}" height="${cardH}" rx="24" fill="#FFFCF6" transform="rotate(-1 ${W / 2} ${cardY + cardH / 2})"/>
  ${tape(W / 2, cardY - 2, "#F2D9A0", -3)}
  <text x="170" y="${cardY + 130}" font-family="Playfair Display" font-weight="700" font-size="${Math.min(92, Math.floor(1500 / Math.max(8, (s.word || "").length)))}" fill="${INK}" style="letter-spacing:-1px;">${esc(s.word)}</text>
  <text x="170" y="${cardY + 186}" font-family="Playfair Display" font-style="italic" font-weight="500" font-size="36" fill="#A98F6F">${esc(s.pos)} · ${esc(s.phonetic)}</text>
  <line x1="170" y1="${cardY + 230}" x2="${W - 170}" y2="${cardY + 230}" stroke="rgba(61,44,110,0.2)" stroke-width="2"/>
  ${defsSvg}
  <text x="170" y="${exY}" font-family="Playfair Display" font-style="italic" font-weight="500" font-size="36" fill="#7a6a9e">${spans(exLines, 170, 54)}</text>
  <text x="${W / 2}" y="${H - 110}" font-family="Poppins" font-weight="500" font-size="26" fill="rgba(61,44,110,0.5)" text-anchor="middle">bloomfocus.org · word of the week</text>`);
}

function diarySVG(s, rubric, pos, total) {
  const dateLines = wrapText(s.dateLine || "monday, 9am", 24);
  let bFont = 44, bLines = wrapText(s.body, 34);
  if (bLines.length > 8) { bFont = 38; bLines = wrapText(s.body, 40); }
  const bLH = bFont * 1.55;
  const inner = 200 + bLines.length * bLH + 110;
  const cardH = Math.min(Math.max(inner, 560), H - 400);
  const cardY = (H - cardH) / 2 - 20;
  const dY = cardY + 130;
  const bY = dY + 90 + bFont * 0.85;
  const idx = pos % 4;
  return svgWrap(`${grad("diary")}
  ${header("dear diary", `${pos} / ${total}`)}
  <rect x="90" y="${cardY}" width="${W - 180}" height="${cardH}" rx="24" fill="rgba(255,252,248,0.96)" transform="rotate(${idx % 2 ? 1 : -1} ${W / 2} ${cardY + cardH / 2})"/>
  ${tape(W / 2, cardY - 2, TAPES[idx % TAPES.length], idx % 2 ? 3 : -3)}
  <text x="150" y="${dY}" font-family="Caveat" font-weight="700" font-size="66" fill="#B0699C">${esc(dateLines[0])}</text>
  <line x1="150" y1="${dY + 26}" x2="${W - 150}" y2="${dY + 26}" stroke="rgba(61,44,110,0.15)" stroke-width="2"/>
  <text x="150" y="${bY}" font-family="Poppins" font-weight="500" font-size="${bFont}" fill="#4a3a7a">${spans(bLines, 150, bLH)}</text>
  ${footer(s.kicker || DEFAULT_KICKERS.diary)}`);
}

function resetSVG(s, rubric, pos, total) {
  const hLines = wrapText(s.headline, 16);
  const hFont = hLines.length > 3 ? 66 : 78, hLH = hFont * 1.2;
  const bLines = wrapText(s.body, 34);
  const bFont = 38, bLH = bFont * 1.55;
  const blockH = hLines.length * hLH + (bLines.length ? 56 + bLines.length * bLH : 0);
  const hY = (H - blockH) / 2 + hFont * 0.75 - 20;
  const bY = hY + (hLines.length - 1) * hLH + 56 + bFont * 0.9;
  return svgWrap(`${grad("reset")}
  ${header("sunday reset", `${pos} / ${total}`)}
  <circle cx="${W / 2}" cy="${H / 2}" r="420" fill="rgba(255,255,255,0.45)"/>
  <text x="${W / 2}" y="${hY}" font-family="Playfair Display" font-weight="700" font-size="${hFont}" fill="${INK}" text-anchor="middle" style="letter-spacing:-1px;">${spans(hLines, W / 2, hLH)}</text>
  ${bLines.length ? `<text x="${W / 2}" y="${bY}" font-family="Poppins" font-weight="500" font-size="${bFont}" fill="#4a3a7a" text-anchor="middle">${spans(bLines, W / 2, bLH)}</text>` : ""}
  <text x="${W / 2}" y="${H - 100}" font-family="Caveat" font-weight="700" font-size="56" fill="${INK}" text-anchor="middle">${esc(s.kicker || DEFAULT_KICKERS.reset)}</text>`);
}

function ctaSVG(s, rubric, total) {
  const hLines = wrapText(s.headline, 16);
  const hFont = hLines.length > 3 ? 66 : 78, hLH = hFont * 1.16;
  const bLines = wrapText(s.body, 38);
  const bFont = 38, bLH = bFont * 1.5;
  const cardY = 210, cardH = H - 420;
  const blockH = hLines.length * hLH + 40 + bLines.length * bLH;
  const hY = cardY + Math.max(90, (cardH - 300 - blockH) / 2) + hFont * 0.75;
  const bY = hY + (hLines.length - 1) * hLH + 40 + bFont * 0.9;
  const site = rubric === "quiz" ? "free ADHD quiz → bloomfocus.org/quiz" : "bloomfocus.org · free ADHD quiz inside";
  const comment = s.commentPrompt ? `${s.commentPrompt} 👇` : "which one hit hardest? tell us 👇";
  return svgWrap(`${grad(rubric)}
  ${header("the last page", `${total} / ${total}`)}
  <rect x="90" y="${cardY}" width="${W - 180}" height="${cardH}" rx="24" fill="rgba(61,44,110,0.96)" transform="rotate(-1 ${W / 2} ${cardY + cardH / 2})"/>
  ${tape(W / 2, cardY - 2, TAPES[2], -3)}
  <text x="${W / 2}" y="${hY}" font-family="Playfair Display" font-weight="700" font-size="${hFont}" fill="#FFF6EE" text-anchor="middle" style="letter-spacing:-1px;">${spans(hLines, W / 2, hLH)}</text>
  <text x="${W / 2}" y="${bY}" font-family="Poppins" font-weight="500" font-size="${bFont}" fill="#DCD0F5" text-anchor="middle">${spans(bLines, W / 2, bLH)}</text>
  <text x="${W / 2}" y="${cardY + cardH - 150}" font-family="Caveat" font-weight="700" font-size="64" fill="#F4C9D8" text-anchor="middle">follow @bloomfocus.adhd 🌱</text>
  <text x="${W / 2}" y="${cardY + cardH - 80}" font-family="Poppins" font-weight="500" font-size="30" fill="#FFF6EE" text-anchor="middle">${esc(site)}</text>
  <text x="${W / 2}" y="${H - 90}" font-family="Caveat" font-weight="700" font-size="54" fill="${INK}" text-anchor="middle">${esc(comment)}</text>`);
}

// ---------------- render dispatch ----------------
function renderSlide(s, rubric, pos, total) {
  switch (s.type) {
    case "hook": return hookSVG(s, rubric, total);
    case "chapter": return chapterStepSVG(s, rubric, pos, total, false);
    case "step": return chapterStepSVG(s, rubric, pos, total, true);
    case "checklist": return checklistSVG(s, rubric, pos, total);
    case "quiz": return quizSVG(s, rubric, pos, total);
    case "myth": return mythSVG(s, rubric, pos, total);
    case "truth": return truthSVG(s, rubric, pos, total);
    case "dict": return dictSVG(s, rubric, pos, total);
    case "diary": return diarySVG(s, rubric, pos, total);
    case "reset": return resetSVG(s, rubric, pos, total);
    case "cta": return ctaSVG(s, rubric, total);
    default: return chapterStepSVG(s, rubric, pos, total, false);
  }
}

// ---------------- main ----------------
async function main() {
  console.log(`\n🖼  bloom focus — Carousel build v2 (journal) — Week ${WEEK}\n${"━".repeat(50)}`);
  await ensureFonts();

  const jsonPath = path.join(REPO_ROOT, `carousel_week_${WEEK}.json`);
  if (!fs.existsSync(jsonPath)) throw new Error(`missing ${jsonPath} — run carousel-generator first`);
  const full = JSON.parse(fs.readFileSync(jsonPath, "utf8"));

  const outDir = path.join(REPO_ROOT, "output", "carousels", `week_${WEEK}`);
  fs.mkdirSync(outDir, { recursive: true });

  let built = 0;
  for (const c of full) {
    if (built >= LIMIT) break;
    const total = c.slides.length;
    const urls = [];
    console.log(`  ▶ ${c.id} (${c.rubric}, ${total} slides)`);
    for (let i = 0; i < total; i++) {
      const s = c.slides[i];
      const svg = renderSlide(s, c.rubric, i + 1, total);
      const fname = `${c.id}_${String(i + 1).padStart(2, "0")}.jpg`;
      await sharp(Buffer.from(svg)).jpeg({ quality: 92 }).toFile(path.join(outDir, fname));
      urls.push(`${RAW_BASE}/output/carousels/week_${WEEK}/${fname}`);
    }
    c.slideImageURLs = urls;
    c.files = urls.map((u) => ({ media_type: "IMAGE", image_url: u }));
    built++;
    console.log(`    ✓ ${urls.length} slides rendered`);
  }

  fs.writeFileSync(jsonPath, JSON.stringify(full, null, 2));
  fs.writeFileSync(path.join(REPO_ROOT, "carousel_current.json"), JSON.stringify(full, null, 2));
  console.log(`\n✅ ${built} carousels built → output/carousels/week_${WEEK}/ + carousel_current.json`);
}

main().catch((e) => { console.error("✗", e); process.exit(1); });
