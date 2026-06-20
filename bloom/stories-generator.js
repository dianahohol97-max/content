/**
 * bloom focus — stories-generator.js
 * Generates Instagram Stories (faceless, pastel) for the ADHD brand.
 *
 * Stories are an engagement + funnel tool for the WARM audience (existing
 * followers): visual tests, fact cards, direct quiz CTAs, and 1-2 storytelling
 * series per week. No native poll stickers (API can't add them) — every Story
 * drives action through a LINK STICKER to quiz/app/etsy.
 *
 * Output: stories_week_X.json + stories_current.json
 *
 * Weekly mix (21/week, 3/day):
 *   7 visual tests   (pick 1 of 2/4 → quiz)
 *   7 fact cards     (one ADHD insight → warm value)
 *   5 quiz/app CTAs  (direct invite → link sticker)
 *   2 storytelling   (multi-slide relatable arc → quiz)
 *
 * Usage: node bloom/stories-generator.js --week=29
 */

import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

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

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const URLS = {
  quiz: "https://bloomfocus.org/quiz",
  app: "https://bloomfocus.org/app",
  etsy: "https://www.etsy.com/shop/BloomfocusShop",
  site: "https://bloomfocus.org",
};
const LINK_TEXT = {
  quiz: "Take the free quiz",
  app: "Try the free app",
  etsy: "Shop on Etsy",
  site: "Learn more",
};

const SHARED = `You write Instagram Stories for bloom focus, a faceless ADHD brand.
Voice: warm, direct, science-backed but simple — "a friend with a neuroscience degree who also lost their keys this morning". Validating, never patronizing. Relatable AND accurate. Never "just try harder" or "ADHD is a superpower".
Audience: the WARM audience (existing followers) — these Stories deepen connection and drive action, they don't have to explain ADHD from scratch.
Pastel aesthetic: lavender, cream, sage, blush. No real people, no faces, no clinical imagery.
Use ONLY straight ASCII apostrophes ('). No curly quotes or special characters.`;

function parseJSON(text) {
  let t = text.trim();
  if (t.startsWith("```")) t = t.replace(/^```(json)?/i, "").replace(/```$/, "").trim();
  const start = t.indexOf("[");
  const end = t.lastIndexOf("]");
  if (start !== -1 && end !== -1) t = t.slice(start, end + 1);
  return JSON.parse(t);
}

// ── Visual tests (pick 1 of 2-4 → quiz) ──
async function genTests(n) {
  const prompt = `${SHARED}

Generate ${n} VISUAL TEST stories. Each poses a quick "pick one" question with 2-4 image options arranged on the story, and a LINK STICKER to the quiz (the real answer/type is revealed by taking the quiz). High engagement, drives quiz clicks.

For each:
- question: the on-screen question (max 8 words). e.g. "Which morning is yours?", "Pick the desk that's most you"
- optionCount: 2 or 4
- options: array of optionCount items, each: { label (max 3 words), imagePrompt (realistic aesthetic pastel vertical photo for this tile, distinct from others, no people no text) }
- overlayText: a short line under the question inviting the tap (max 8 words), e.g. "Your pick says a lot - find out"
- caption: the story caption text (max 12 words)
- funnel: "quiz"

Return ONLY a JSON array:
[{ "question": "...", "optionCount": 2, "options": [{"label":"...","imagePrompt":"..."},{"label":"...","imagePrompt":"..."}], "overlayText": "...", "caption": "...", "funnel": "quiz" }]`;

  const r = await client.messages.create({ model: "claude-sonnet-4-6", max_tokens: 3000, messages: [{ role: "user", content: prompt }] });
  return parseJSON(r.content[0].text).map((s) => ({ ...s, storyType: "test" }));
}

// ── Fact cards (one insight → warm value) ──
async function genFactCards(n) {
  const prompt = `${SHARED}

Generate ${n} FACT CARD stories. Each is ONE bite-size ADHD insight on a pastel background — a moment of "oh, that explains it". Warm value for the existing audience, builds trust. Soft link sticker to quiz or app.

For each:
- overlayText: the main text shown big on the card (max 18 words). One clear insight. e.g. "ADHD isn't a focus problem - it's a focus REGULATION problem."
- caption: short caption (max 12 words)
- imagePrompt: realistic aesthetic pastel vertical background (cozy minimal, soft light, no people no text) that fits the insight mood
- funnel: "quiz" or "app"

Return ONLY a JSON array:
[{ "overlayText": "...", "caption": "...", "imagePrompt": "...", "funnel": "quiz" }]`;

  const r = await client.messages.create({ model: "claude-sonnet-4-6", max_tokens: 3000, messages: [{ role: "user", content: prompt }] });
  return parseJSON(r.content[0].text).map((s) => ({ ...s, storyType: "factcard" }));
}

// ── Direct CTAs (quiz/app/etsy invite) ──
async function genCTAs(n) {
  const prompt = `${SHARED}

Generate ${n} CTA stories. Each warmly invites the viewer to take an action via a link sticker. Vary funnel across quiz, app, and etsy. Keep it inviting, not salesy.

For each:
- overlayText: the on-card invitation (max 16 words). e.g. "Still wondering if it's ADHD? The free 2-minute quiz can help."
- caption: short caption (max 12 words)
- imagePrompt: realistic aesthetic pastel vertical background (cozy minimal, no people no text)
- funnel: one of "quiz", "app", "etsy"

Aim for roughly: ${Math.ceil(n*0.5)} quiz, ${Math.floor(n*0.3)} app, ${Math.max(1,Math.floor(n*0.2))} etsy.

Return ONLY a JSON array:
[{ "overlayText": "...", "caption": "...", "imagePrompt": "...", "funnel": "quiz" }]`;

  const r = await client.messages.create({ model: "claude-sonnet-4-6", max_tokens: 3000, messages: [{ role: "user", content: prompt }] });
  return parseJSON(r.content[0].text).map((s) => ({ ...s, storyType: "cta" }));
}

// ── Storytelling series (multi-slide arc → quiz) ──
async function genStories(n) {
  const prompt = `${SHARED}

Generate ${n} STORYTELLING series. Each is a 5-slide relatable arc told as a COLLECTIVE, recognizable ADHD experience (not a fake invented person — frame as the lived experience many people with ADHD share, honest and faceless). The arc: hook -> unfolding -> turn ("it wasn't laziness, it was ADHD") -> insight -> CTA to the quiz. Each slide is one Story.

For each series return:
- theme: short label
- slides: array of EXACTLY 5 slides, each: { overlayText (max 20 words, the text on that slide), imagePrompt (realistic aesthetic pastel vertical background fitting that beat, no people no text) }
  Slide 5 must be the quiz CTA.
- funnel: "quiz"

Return ONLY a JSON array:
[{ "theme": "...", "slides": [{"overlayText":"...","imagePrompt":"..."}, ... 5 total], "funnel": "quiz" }]`;

  const r = await client.messages.create({ model: "claude-sonnet-4-6", max_tokens: 4000, messages: [{ role: "user", content: prompt }] });
  return parseJSON(r.content[0].text).map((s) => ({ ...s, storyType: "story" }));
}

async function retry(fn, label) {
  for (let a = 1; a <= 3; a++) {
    try {
      const res = await fn();
      if (!Array.isArray(res) || res.length === 0) throw new Error("empty");
      console.log(`  ✓ ${label} — ${res.length}`);
      return res;
    } catch (e) {
      console.warn(`  ✗ ${label} attempt ${a}: ${e.message}`);
      if (a === 3) { console.warn(`  ⚠ ${label} skipped`); return []; }
      await new Promise((r) => setTimeout(r, 1500 * a));
    }
  }
}

async function main() {
  console.log(`\n📱 bloom focus — Instagram Stories generator — Week ${WEEK}\n${"━".repeat(50)}`);

  const tests = await retry(() => genTests(7), "tests");
  const facts = await retry(() => genFactCards(7), "fact cards");
  const ctas = await retry(() => genCTAs(5), "CTAs");
  const series = await retry(() => genStories(2), "storytelling");

  // Flatten into individual story rows. Storytelling expands into 5 rows each.
  const rows = [];
  let idx = 0;
  const dayFor = () => (Math.floor(idx / 3) % 7) + 1; // ~3/day across 7 days

  const pushRow = (s, extra = {}) => {
    idx++;
    rows.push({
      id: `ST_W${WEEK}_${String(idx).padStart(2, "0")}`,
      week: WEEK,
      day: dayFor(),
      storyType: s.storyType,
      funnel: s.funnel ?? "quiz",
      storyGroup: extra.storyGroup ?? "",
      slideOrder: extra.slideOrder ?? "",
      question: s.question ?? "",
      optionCount: s.optionCount ?? "",
      options: s.options ?? [],
      overlayText: extra.overlayText ?? s.overlayText ?? "",
      caption: s.caption ?? extra.caption ?? "",
      imagePrompt: extra.imagePrompt ?? s.imagePrompt ?? "",
      linkStickerUrl: URLS[s.funnel ?? "quiz"] ?? URLS.quiz,
      linkStickerText: LINK_TEXT[s.funnel ?? "quiz"] ?? LINK_TEXT.quiz,
      generatedImageURL: null,
      status: "pending",
      postedAt: null,
      instagramStoryID: null,
    });
  };

  tests.forEach((s) => pushRow(s));
  facts.forEach((s) => pushRow(s));
  ctas.forEach((s) => pushRow(s));
  series.forEach((serie, si) => {
    const group = `STORY_W${WEEK}_${si + 1}`;
    serie.slides.forEach((slide, sl) => {
      pushRow(
        { storyType: "story", funnel: serie.funnel ?? "quiz", caption: serie.theme },
        { storyGroup: group, slideOrder: sl + 1, overlayText: slide.overlayText, imagePrompt: slide.imagePrompt }
      );
    });
  });

  fs.writeFileSync(path.join(REPO_ROOT, `stories_week_${WEEK}.json`), JSON.stringify(rows, null, 2));
  fs.writeFileSync(path.join(REPO_ROOT, "stories_current.json"), JSON.stringify(rows, null, 2));
  console.log(`\n✅ ${rows.length} stories → stories_week_${WEEK}.json`);
  console.log(`   ${tests.length} tests · ${facts.length} facts · ${ctas.length} CTAs · ${series.length} series (${series.length * 5} slides)`);
}

main().catch((e) => { console.error("❌", e.message); process.exit(1); });
