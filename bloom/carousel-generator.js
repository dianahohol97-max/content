/**
 * bloom focus — carousel-generator.js
 * Generates Instagram carousel text packs (educational, saves-focused).
 * 3-4 carousels/week, 5-8 slides each (dynamic by topic).
 * Output: carousel_week_X.json (slides + per-slide imagePrompt tag + caption).
 *
 *   node bloom/carousel-generator.js --week=29 --count=4
 */

import Anthropic from "@anthropic-ai/sdk";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const [k, v] = a.replace(/^--/, "").split("=");
  return [k, v ?? true];
}));
const WEEK = parseInt(args.week) || 29;
const COUNT = args.count ? parseInt(args.count) : 4;

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const ART_STYLE = "Hand-drawn illustration in soft pastel colors, cozy and warm style. Soft watercolor texture, gentle hand-painted lines, flat illustration. Palette: lavender, cream, sage green, blush pink. Calm, friendly, approachable, non-judgmental mood. No people, no faces, no text, no letters. Portrait 4:5 composition.";

// Carousel topics (educational, save-worthy ADHD concepts)
const TOPICS = [
  "why ADHD brains can't 'just focus' - the dopamine explanation",
  "task paralysis: what it actually is and why it happens",
  "the ADHD tax: what executive dysfunction really costs you",
  "why you can hyperfocus on games but not work",
  "time blindness: why 'now' and 'not now' are your only times",
  "the wall of awful: why caring makes tasks harder to start",
  "rejection sensitive dysphoria explained",
  "why ADHD brains struggle with object permanence",
  "emotional dysregulation: why feelings hit twice as hard",
  "the 7 types of executive function and how ADHD affects each",
  "why dopamine menus work when to-do lists don't",
  "body doubling: the science of why it helps ADHD focus",
  "ADHD burnout: the cycle and how to break it",
  "why ADHD brains crave novelty and what to do about it",
  "working memory: why you forget what you just thought",
  "why 'just try harder' is the worst ADHD advice",
];

async function generateOne(topic) {
  const prompt = `You are an Instagram carousel writer for bloom focus, a faceless ADHD education brand.

Voice/tone: warm, direct, science-backed but simple — "a friend with a neuroscience degree who also lost their keys this morning". Validating, never patronizing. Clinically ACCURATE. Never "just try harder" or "ADHD is a superpower".

Write ONE educational, save-worthy Instagram carousel on:
"${topic}"

Carousels are for SAVES and SHARES — dense, genuinely useful, one clear idea per slide. Pick the natural number of slides for this topic: between 5 and 8 (including the hook slide and the final CTA slide). Don't pad.

STRUCTURE:
- Slide 1 (HOOK): a sharp scroll-stopping title + a subtle "save this 🔖" cue. Max 12 words of title.
- Middle slides (3-6): ONE concept each. A short bold headline (max 8 words) + 1-2 sentences of body (max 35 words). Numbered feel, builds understanding.
- Final slide (CTA): warm wrap-up + invite to save/share/follow. e.g. "Save this for the next hard day. Follow @bloomfocus for more."

For EACH slide return:
- headline: the bold text on the slide (short).
- body: the supporting sentence(s) (empty "" for hook/CTA if not needed).
- tag: a SHORT reusable image category slug (lowercase, underscores) for the slide background, from: brain, desk_messy, desk_tidy, coffee, journal, window_light, clock, plant, books, path, sparks, cozy_room, sky. Same subject shares a tag.
- imagePrompt: ALWAYS begin with exactly: "${ART_STYLE}" then add one simple scene detail matching the tag.

Also return:
- title: internal title for this carousel (for filenames/tracking).
- caption: the Instagram caption — hook line + 2-3 sentences + soft CTA. NO hashtags on its own line; instead end with: "Save this and follow for daily ADHD content."
- hashtags: array of 8-12 hashtags (e.g. "#ADHD", "#ADHDbrain", "#neurodivergent").
- funnel: "follow".

Use ONLY straight ASCII apostrophes ('). No curly quotes.

Return ONLY a valid JSON array with ONE object, no markdown:
[
  {
    "title": "...",
    "slides": [ { "headline": "...", "body": "...", "tag": "brain", "imagePrompt": "..." } ],
    "caption": "...",
    "hashtags": ["..."],
    "funnel": "follow"
  }
]`;

  const r = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 8000,
    messages: [{ role: "user", content: prompt }],
  });
  return parseJSON(r.content[0].text)[0];
}

function parseJSON(text) {
  let t = text.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "");
  const s = t.indexOf("["), e = t.lastIndexOf("]");
  if (s !== -1 && e !== -1) t = t.slice(s, e + 1);
  return JSON.parse(t);
}

async function retry(fn, label, tries = 3) {
  for (let i = 1; i <= tries; i++) {
    try { return await fn(); }
    catch (e) {
      console.warn(`   ⚠ ${label} attempt ${i} failed: ${e.message.slice(0, 80)}`);
      if (i === tries) throw e;
      await new Promise((r) => setTimeout(r, 2000 * i));
    }
  }
}

async function main() {
  console.log(`\n🎠 bloom focus — Carousel generator — Week ${WEEK}\n${"━".repeat(50)}\n`);

  const startIdx = ((WEEK - 1) * COUNT) % TOPICS.length;
  const weekTopics = Array.from({ length: COUNT }, (_, i) => TOPICS[(startIdx + i) % TOPICS.length]);

  const out = [];
  for (let i = 0; i < weekTopics.length; i++) {
    console.log(`  [${i + 1}/${COUNT}] ${weekTopics[i]}`);
    const c = await retry(() => generateOne(weekTopics[i]), "carousel");
    c.id = `CR_W${WEEK}_${String(i + 1).padStart(2, "0")}`;
    c.week = WEEK;
    c.status = "pending";
    c.slideImageURLs = [];
    console.log(`    ✓ ${c.slides.length} slides`);
    out.push(c);
  }

  fs.writeFileSync(path.join(REPO_ROOT, `carousel_week_${WEEK}.json`), JSON.stringify(out, null, 2));
  console.log(`\n✅ ${out.length} carousels → carousel_week_${WEEK}.json`);
}

main().catch((e) => { console.error("✗", e); process.exit(1); });
