/**
 * bloom focus — shorts-generator.js
 * Generates YouTube Shorts scripts (faceless, voiced) for the ADHD brand.
 *
 * Output: shorts_week_X.json  (array of shorts, each with scenes + voiceover + meta)
 *
 * Each Short:
 *   - hook (0-3s), body scenes, CTA (last 3s → take the free quiz)
 *   - voiceover: full narration text (for ElevenLabs)
 *   - scenes[]: { caption (on-screen text), imagePrompt (Gemini bg), seconds }
 *   - title / description / tags (YouTube SEO)
 *
 * Usage:
 *   node bloom/shorts-generator.js --week=29 --count=3
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
const WEEK = args.week ? parseInt(args.week) : 29;
const COUNT = args.count ? parseInt(args.count) : 14;

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const URLS = {
  quiz: "https://bloomfocus.org/quiz",
  app: "https://bloomfocus.org/app",
  site: "https://bloomfocus.org",
};

// Rotating topics for ADHD Shorts (education + relatable + practical)
const TOPICS = [
  // — Core education (the brain) —
  "why ADHD brains can't 'just start' tasks (dopamine explained)",
  "task paralysis is not laziness — what's actually happening",
  "the ADHD time blindness problem and one way to fix it",
  "why you can focus 6 hours on a game but not 20 min on work",
  "the 3am racing thoughts and why ADHD brains do this",
  "why ADHD medication isn't the only answer (and what helps)",
  "the ADHD 'wall of awful' and how to climb it",
  "object permanence and ADHD: out of sight, out of mind",
  "rejection sensitive dysphoria explained in 60 seconds",
  "why ADHD brains crave novelty (and how to use it)",
  "the science of hyperfocus: gift and trap",
  "why transitions between tasks are so hard with ADHD",
  "emotional dysregulation in ADHD — it's not 'too sensitive'",
  "working memory and ADHD: why you forget mid-sentence",
  "ADHD and the 'now vs not now' sense of time",
  // — Practical tools —
  "dopamine menus: how to trick an ADHD brain into starting",
  "body doubling — the weird trick that actually works for ADHD",
  "the 2-minute rule for ADHD task initiation",
  "how to build an ADHD morning routine that survives real life",
  "externalize everything: the ADHD memory hack",
  "the 'launch pad' trick so you stop losing your keys",
  "habit stacking for ADHD brains (without rigid schedules)",
  "body-based resets when your ADHD brain is stuck",
  "how to make boring tasks dopamine-friendly",
  // — Relatable / validation —
  "things neurotypical productivity advice gets wrong about ADHD",
  "the ADHD tax: what executive dysfunction really costs you",
  "'I'll do it in 5 minutes' — the ADHD time lie",
  "why your ADHD brain starts 5 things and finishes none",
  "the doom pile and why ADHD brains create it",
  "why 'just try harder' is the worst ADHD advice",
];

function parseJSON(text) {
  let t = text.trim();
  if (t.startsWith("```")) t = t.replace(/^```(json)?/i, "").replace(/```$/, "").trim();
  const start = t.indexOf("[");
  const end = t.lastIndexOf("]");
  if (start !== -1 && end !== -1) t = t.slice(start, end + 1);
  return JSON.parse(t);
}

async function generateShorts(weekNum, count) {
  // Pick `count` topics for the week, rotating by week number
  const startIdx = ((weekNum - 1) * count) % TOPICS.length;
  const weekTopics = Array.from({ length: count }, (_, i) => TOPICS[(startIdx + i) % TOPICS.length]);

  const prompt = `You are a YouTube Shorts scriptwriter for bloom focus, a faceless ADHD education brand.

Voice/tone: warm, direct, science-backed but simple — "a friend with a neuroscience degree who also lost their keys this morning". Validating, never patronizing. Never say "just try harder" or "ADHD is a superpower".

Write exactly ${count} YouTube Shorts (30-45 seconds each, faceless, voiced narration over changing aesthetic background shots).

Topics (one Short each):
${weekTopics.map((t, i) => `${i + 1}. ${t}`).join("\n")}

STRUCTURE of each Short:
- HOOK (0-3s): a scroll-stopping line that creates instant recognition or curiosity. No "hey guys", no intro.
- BODY (3-38s): explain the idea simply, validate the experience, give ONE practical takeaway. Broken into 4-6 short scenes.
- CTA (last 3s): "Take the free ADHD quiz — link below" (or for some, "the free app" — vary it).

For EACH Short return:
- voiceover: the FULL narration as one flowing text (what ElevenLabs will speak). Natural, spoken rhythm, ~85-110 words for ~35s. This is the spine.
- scenes: an array of 5-7 scenes. Each scene = a moment of the voiceover with its own on-screen caption + background visual. Each scene:
    - caption: SHORT on-screen text (max 6 words) — the key phrase of that moment, big and readable. NOT the full sentence.
    - imagePrompt: a detailed prompt for a REALISTIC aesthetic vertical photo background (Gemini). Style: "Realistic aesthetic photograph, soft pastel tones (lavender, cream, sage, blush), cozy minimal scene, soft natural light, shallow depth of field, film-like. No people, no faces, no text. Vertical 9:16 (1080x1920)." Add a scene detail relevant to that moment (desk, coffee, plant, bed, window light, journal, phone, clock).
    - seconds: how long this scene shows (number, total across scenes ≈ voiceover length, usually 5-8 each).
- title: YouTube Shorts title, 40-70 chars, search-friendly, ends with #Shorts. e.g. "Why ADHD brains can't 'just start' tasks #Shorts"
- description: 2-3 sentences with keywords, then the CTA URL on its own line.
- tags: array of 8-12 YouTube tags (ADHD, neurodivergent, etc).
- funnel: "quiz" for most, occasionally "app".
- destinationUrl: ${URLS.quiz} (or ${URLS.app} for app ones).

Use ONLY straight ASCII apostrophes ('), no curly quotes, no special characters.

Return ONLY a valid JSON array, no markdown:
[
  {
    "voiceover": "...",
    "scenes": [
      { "caption": "...", "imagePrompt": "...", "seconds": 6 }
    ],
    "title": "... #Shorts",
    "description": "...",
    "tags": ["...", "..."],
    "funnel": "quiz",
    "destinationUrl": "${URLS.quiz}"
  }
]`;

  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 4000,
    messages: [{ role: "user", content: prompt }],
  });

  return parseJSON(response.content[0].text);
}

async function main() {
  console.log(`\n🎬 bloom focus — YouTube Shorts generator — Week ${WEEK}\n${"━".repeat(50)}`);
  console.log(`Generating ${COUNT} shorts...`);

  let shorts;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      shorts = await generateShorts(WEEK, COUNT);
      if (!Array.isArray(shorts) || shorts.length === 0) throw new Error("empty");
      break;
    } catch (err) {
      console.warn(`  ✗ attempt ${attempt}: ${err.message}`);
      if (attempt === 3) throw err;
      await new Promise((r) => setTimeout(r, 1500 * attempt));
    }
  }

  // Add metadata + IDs
  shorts = shorts.map((s, i) => ({
    id: `SH_W${WEEK}_${String(i + 1).padStart(2, "0")}`,
    week: WEEK,
    ...s,
    status: "pending",
    videoUrl: null,
    postedAt: null,
  }));

  const outPath = path.join(REPO_ROOT, `shorts_week_${WEEK}.json`);
  fs.writeFileSync(outPath, JSON.stringify(shorts, null, 2));
  // Stable file Make can always read
  fs.writeFileSync(path.join(REPO_ROOT, "shorts_current.json"), JSON.stringify(shorts, null, 2));

  console.log(`\n✅ ${shorts.length} shorts → shorts_week_${WEEK}.json`);
  shorts.forEach((s) => console.log(`   ${s.id}: ${s.title} (${s.scenes.length} scenes)`));
}

main().catch((e) => { console.error("❌", e.message); process.exit(1); });
