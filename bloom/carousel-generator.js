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

// "Symptom list" carousels — the proven save-heavy format: a named ADHD pattern
// + "What it might look like" with concrete relatable examples. One pattern per
// slide (each slide = one pattern), so the whole carousel is a set of patterns.
const PATTERN_SETS = [
  { theme: "ADHD traits you thought were personality flaws", patterns: ["Object Permanence", "Low Interoception", "Rejection Masking", "Time Blindness", "Emotional Permanence"] },
  { theme: "Hidden ADHD struggles no one talks about", patterns: ["Waiting Mode", "Decision Paralysis", "Auditory Processing Lag", "The Wall of Awful", "Hyperfixation Crash"] },
  { theme: "Why ADHD makes everyday life harder", patterns: ["Task Switching Cost", "Working Memory Gaps", "Sensory Overload", "Demand Avoidance", "Revenge Bedtime Procrastination"] },
  { theme: "ADHD signs that hide in plain sight", patterns: ["Justice Sensitivity", "Stimulation Seeking", "Object Permanence", "Emotional Dysregulation", "Time Agnosia"] },
];

async function generatePatternCarousel(set) {
  const prompt = `You are an Instagram carousel writer for bloom focus, a faceless ADHD education brand.

Voice/tone: warm, direct, science-backed but simple — "a friend with a neuroscience degree who also lost their keys this morning". Validating, never patronizing. Clinically ACCURATE. Never "just try harder" or "ADHD is a superpower".

Write ONE highly save-worthy Instagram carousel in the "named pattern + What it might look like" format (this format gets huge saves because people recognize themselves).

Carousel theme: "${set.theme}"
Patterns to cover (ONE per content slide, in this order): ${set.patterns.map((p, i) => `${i + 1}. ${p}`).join("  ")}

STRUCTURE (${set.patterns.length + 2} slides total):
- Slide 1 (HOOK): bold title = the theme, made scroll-stopping. Add a subtle "save this 🔖" feel. body can tease "you'll recognize yourself."
- Slides 2-${set.patterns.length + 1} (ONE PATTERN EACH): 
    - headline: the pattern name (e.g. "Object Permanence").
    - body: structured as a SHORT 1-2 sentence plain-language explanation of the pattern, THEN a line "What it might look like:" THEN 3 concrete relatable examples each on its own line starting with a relevant emoji. Keep examples specific and real ("You forget laundry in the machine until it smells"), not abstract. Use \\n for line breaks inside body.
- Final slide (CTA): warm validating wrap-up ("You're not broken — your brain just works differently") + "Save this and follow @bloomfocus for more."

For EACH slide also return:
- tag: a SHORT reusable image slug (lowercase, underscores) from: brain, desk_messy, desk_tidy, coffee, journal, window_light, clock, plant, books, path, sparks, cozy_room, sky, phone, bed. Same subject shares a tag.
- imagePrompt: ALWAYS begin with exactly: "${ART_STYLE}" then add one simple scene detail matching the tag.

Also return:
- title: internal title (for filenames).
- caption: IG caption — hook + 2-3 sentences + a question to drive comments ("Which one surprised you most?") + "Save this and follow for daily ADHD content."
- hashtags: 8-12 hashtags.
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
  const patStart = ((WEEK - 1) * COUNT) % PATTERN_SETS.length;

  const out = [];
  let patCount = 0, eduCount = 0;
  for (let i = 0; i < COUNT; i++) {
    // alternate: even slots = proven "pattern + what it might look like" format,
    // odd slots = standard educational carousel. Pattern format drives saves.
    const usePattern = i % 2 === 0;
    let c;
    if (usePattern) {
      const set = PATTERN_SETS[(patStart + patCount) % PATTERN_SETS.length];
      console.log(`  [${i + 1}/${COUNT}] (pattern) ${set.theme}`);
      c = await retry(() => generatePatternCarousel(set), "pattern carousel");
      c.format = "pattern";
      patCount++;
    } else {
      const topic = weekTopics[eduCount % weekTopics.length];
      console.log(`  [${i + 1}/${COUNT}] (educational) ${topic}`);
      c = await retry(() => generateOne(topic), "carousel");
      c.format = "educational";
      eduCount++;
    }
    c.id = `CR_W${WEEK}_${String(i + 1).padStart(2, "0")}`;
    c.week = WEEK;
    c.status = "pending";
    c.slideImageURLs = [];
    console.log(`    ✓ ${c.slides.length} slides`);
    out.push(c);
  }

  fs.writeFileSync(path.join(REPO_ROOT, `carousel_week_${WEEK}.json`), JSON.stringify(out, null, 2));
  console.log(`\n✅ ${out.length} carousels (${patCount} pattern + ${eduCount} educational) → carousel_week_${WEEK}.json`);
}

main().catch((e) => { console.error("✗", e); process.exit(1); });
