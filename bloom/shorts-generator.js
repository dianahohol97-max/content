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

// Topics chosen from what actually performs on ADHD short-form (2026 research):
// - "X signs" symptom lists (highest reach + self-recognition)
// - women's/late-diagnosis ADHD (underserved, viral, drives quiz traffic)
// - lesser-known symptoms presented as "didn't know that was ADHD"
// - relatable daily-struggle hooks (sleep, brain fog, time, mess)
// bloom focus angle: relatable AND accurate (most viral ADHD content is not).
const TOPICS = [
  // — "Signs" lists (cold traffic → quiz) —
  "7 signs of ADHD in women that get dismissed as personality",
  "5 ADHD symptoms you didn't know were ADHD",
  "signs you have inattentive ADHD (the quiet kind)",
  "ADHD in adults: 6 signs everyone misses",
  "why high-achieving women often have undiagnosed ADHD",
  "8 things that feel normal but are actually ADHD",
  "ADHD or anxiety? how to tell the difference",
  "late-diagnosed ADHD: signs you grew up masking it",
  "signs your 'laziness' is actually ADHD executive dysfunction",
  "ADHD and people-pleasing: the connection no one talks about",
  // — Lesser-known symptoms (recognition → quiz) —
  "ADHD time blindness: why you're always late (and the fix)",
  "ADHD paralysis: when you can't start even easy tasks",
  "why ADHD brains can't 'just start' — dopamine explained",
  "rejection sensitive dysphoria: the ADHD symptom that hurts most",
  "ADHD and brain fog: why your mind feels full of static",
  "why ADHD makes you forget mid-sentence (working memory)",
  "the ADHD sleep problem: revenge bedtime procrastination",
  "ADHD emotional dysregulation: it's not being 'too sensitive'",
  "why ADHD brains struggle with object permanence",
  "ADHD and the 'now vs not now' way of seeing time",
  // — Practical tools (warm → app) —
  "the dopamine menu trick to start tasks with ADHD",
  "body doubling: the ADHD focus hack that actually works",
  "the 2-minute rule for ADHD task paralysis",
  "how to build an ADHD routine that survives real life",
  "the launch-pad trick so ADHD brains stop losing keys",
  "how to make boring tasks dopamine-friendly for ADHD",
  // — Relatable / shareable —
  "things neurotypical productivity advice gets wrong about ADHD",
  "why your ADHD brain starts 5 things and finishes none",
  "the ADHD tax: what executive dysfunction really costs you",
  "'I'll do it in 5 minutes' — the ADHD time lie",
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

IMPORTANT — what makes these perform (from real ADHD short-form data):
- Lead with RECOGNITION: the first line should make the viewer think "wait, that's me". Specific lived moments beat clinical definitions.
- Be relatable AND accurate. Most viral ADHD content is misleading; bloom focus wins trust by being correct. Don't present normal-for-everyone experiences as ADHD-exclusive — frame as "common in ADHD" not "if you do this you have ADHD".
- Where relevant, gently note these can overlap with other things and the quiz/professional help is the next step (no fear-mongering, no fake certainty).

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
