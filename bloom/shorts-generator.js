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

// Concrete how-to techniques for practical shorts
const PRACTICAL_TOPICS = [
  "how to use a dopamine menu to start hard tasks",
  "body doubling: how to focus by working alongside someone",
  "the 2-minute rule to beat ADHD task paralysis",
  "the launch pad method so you stop losing keys and phone",
  "how to body-double with a video when you're alone",
  "task batching for ADHD: group similar tasks to save focus",
  "the 'eat the frog' tweak that actually works for ADHD",
  "how to use timers and visual countdowns for time blindness",
  "the brain dump method to quiet a racing ADHD mind",
  "habit stacking: attach new habits to ones you already do",
];

function parseJSON(text) {
  let t = text.trim();
  if (t.startsWith("```")) t = t.replace(/^```(json)?/i, "").replace(/```$/, "").trim();
  const start = t.indexOf("[");
  const end = t.lastIndexOf("]");
  if (start !== -1 && end !== -1) t = t.slice(start, end + 1);
  return JSON.parse(t);
}

const SHARED_VOICE = `Voice/tone: warm, direct, science-backed but simple — "a friend with a neuroscience degree who also lost their keys this morning". Validating, never patronizing. Never say "just try harder" or "ADHD is a superpower".

IMPORTANT — what makes these perform (from real ADHD short-form data):
- Lead with RECOGNITION: the first line should make the viewer think "wait, that's me". Specific lived moments beat clinical definitions.
- Be relatable AND accurate. Most viral ADHD content is misleading; bloom focus wins trust by being correct. Frame as "common in ADHD" not "if you do this you have ADHD".
- The quiz/professional help is the next step (no fear-mongering, no fake certainty).`;

const SCENE_SPEC = `    - caption: SHORT on-screen text (max 6 words) — the key phrase of that moment, big and readable. NOT the full sentence.
    - imagePrompt: a detailed prompt for a REALISTIC aesthetic vertical photo background (Gemini). Style: "Realistic aesthetic photograph, soft pastel tones (lavender, cream, sage, blush), cozy minimal scene, soft natural light, shallow depth of field, film-like. No people, no faces, no text. Vertical 9:16 (1080x1920)." Add a scene detail relevant to that moment (desk, coffee, plant, bed, window light, journal, phone, clock).
    - seconds: how long this scene shows (number, total ≈ voiceover length, usually 5-8 each).`;

// ── Educational + pain-point shorts (voiced, changing scenes) ──
async function generateVoicedShorts(weekTopics, kind) {
  const count = weekTopics.length;
  const kindGuide = kind === "painpoint"
    ? `These are PAIN-POINT shorts. Each opens by naming a frustrating, relatable ADHD struggle as a direct hook that hits home ("Your home is always a mess and no matter how hard you try, you can't keep it tidy?"), validates it's not a character flaw, briefly explains the ADHD reason, then sends them to the free ADHD test. Keep it emotional and validating, short on theory.`
    : kind === "practical"
    ? `These are PRACTICAL HOW-TO shorts. Each teaches ONE concrete ADHD-friendly technique the viewer can use today (e.g. dopamine menu, body doubling, the 2-minute rule, launch pad). Structure: name the struggle briefly, then walk through the method in clear simple steps, end with encouragement + the free quiz. Actionable and specific, not theory-heavy.`
    : `These are EDUCATIONAL shorts. Each teaches the topic simply with recognition + one practical takeaway.`;

  const prompt = `You are a YouTube Shorts scriptwriter for bloom focus, a faceless ADHD education brand.

${SHARED_VOICE}

${kindGuide}

Write exactly ${count} YouTube Shorts (30-45s, faceless, voiced narration over changing aesthetic backgrounds).

Topics (one Short each):
${weekTopics.map((t, i) => `${i + 1}. ${t}`).join("\n")}

STRUCTURE:
- HOOK (0-3s): scroll-stopping, instant recognition. No "hey guys".
- BODY (3-38s): ${kind === "painpoint" ? "validate + brief ADHD reason" : "explain simply + one takeaway"}. 4-6 short scenes.
- CTA (last 3s): "Take the free ADHD quiz — link below".

For EACH Short return:
- voiceover: FULL narration as one flowing text (~85-110 words for ~35s). Natural spoken rhythm.
- scenes: array of 5-7 scenes. Each:
${SCENE_SPEC}
- title: 40-70 chars, search-friendly, ends with #Shorts.
- description: 2-3 sentences with keywords, then the CTA URL on its own line.
- tags: 8-12 YouTube tags.
- funnel: "quiz".
- shortType: "${kind}".
- destinationUrl: ${URLS.quiz}.

Use ONLY straight ASCII apostrophes ('). No curly quotes, no special characters.

Return ONLY a valid JSON array, no markdown:
[
  { "voiceover": "...", "scenes": [{ "caption": "...", "imagePrompt": "...", "seconds": 6 }], "title": "... #Shorts", "description": "...", "tags": ["..."], "funnel": "quiz", "shortType": "${kind}", "destinationUrl": "${URLS.quiz}" }
]`;

  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 4000,
    messages: [{ role: "user", content: prompt }],
  });
  return parseJSON(response.content[0].text).map((s) => ({ ...s, shortType: kind }));
}

// ── Interactive quiz-test shorts (2x2 image grid, answer in description) ──
async function generateQuizTestShorts(count) {
  const prompt = `You are a YouTube Shorts creator for bloom focus, a faceless ADHD brand.

${SHARED_VOICE}

Create exactly ${count} INTERACTIVE TEST shorts. Format: a question with FOUR image options shown as a 2x2 grid, viewer picks one, and the ANSWER / meaning is revealed in the video description (classic "pick one → answer in description" engagement format). High shareability, drives comments and quiz clicks.

Good test concepts:
- "Which of these 4 mornings is yours?" (4 morning scenes) → each reveals an ADHD pattern
- "Pick the desk that looks most like yours" → reveals a focus type
- "What do you see first?" (4 ambiguous calming images) → playful ADHD-style result
- "Which mess stresses you least?" → reveals overwhelm style

For EACH test short return:
- question: the on-screen question (max 8 words), shown at the top.
- options: an array of EXACTLY 4 options, each:
    - label: short label shown on the tile (max 3 words), e.g. "Option 1" or "The pile".
    - imagePrompt: realistic aesthetic vertical photo for this tile (same pastel style: "Realistic aesthetic photograph, soft pastel tones lavender cream sage blush, cozy minimal, soft natural light, shallow depth of field. No people, no text. Square-ish framing works."). Each of the 4 must be visually distinct.
- voiceover: short narration (~40-60 words): read the question, tease "your answer says something about your ADHD brain — check the description", invite a comment, end with "take the free ADHD quiz to really find out".
- answerKey: the text that goes in the DESCRIPTION revealing what each choice means. Format as "1) ... \\n2) ... \\n3) ... \\n4) ...". Keep each playful, validating, ADHD-relevant, accurate (not fake-clinical).
- title: 40-70 chars, ends with #Shorts. e.g. "Which morning is yours? (ADHD test) #Shorts"
- description: 1-2 sentence intro + the answerKey + the quiz URL on its own line.
- tags: 8-12 tags.
- funnel: "quiz".
- shortType: "quiztest".
- destinationUrl: ${URLS.quiz}.

Use ONLY straight ASCII apostrophes ('). No curly quotes.

Return ONLY a valid JSON array, no markdown:
[
  { "question": "...", "options": [{ "label": "...", "imagePrompt": "..." }, { "label": "...", "imagePrompt": "..." }, { "label": "...", "imagePrompt": "..." }, { "label": "...", "imagePrompt": "..." }], "voiceover": "...", "answerKey": "1) ...\\n2) ...\\n3) ...\\n4) ...", "title": "... #Shorts", "description": "...", "tags": ["..."], "funnel": "quiz", "shortType": "quiztest", "destinationUrl": "${URLS.quiz}" }
]`;

  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 4000,
    messages: [{ role: "user", content: prompt }],
  });
  return parseJSON(response.content[0].text).map((s) => ({ ...s, shortType: "quiztest" }));
}

async function generateShorts(weekNum, count) {
  // Mix (scaled to count): ~4 educational, ~3 practical, ~3 pain-point, ~4 quiz-test
  const nEdu = Math.max(1, Math.round(count * 4 / 14));
  const nPrac = Math.max(1, Math.round(count * 3 / 14));
  const nPain = Math.max(1, Math.round(count * 3 / 14));
  const nTest = Math.max(1, count - nEdu - nPrac - nPain);

  // rotate topics by week
  const startIdx = ((weekNum - 1) * count) % TOPICS.length;
  const topicsFor = (n, offset) =>
    Array.from({ length: n }, (_, i) => TOPICS[(startIdx + offset + i) % TOPICS.length]);

  console.log(`  mix → ${nEdu} educational, ${nPrac} practical, ${nPain} pain-point, ${nTest} quiz-test`);

  const all = [];
  console.log("  ✏️  educational...");
  all.push(...await generateVoicedShorts(topicsFor(nEdu, 0), "educational"));
  console.log("  🔧 practical...");
  all.push(...await generateVoicedShorts(PRACTICAL_TOPICS.slice(0, nPrac), "practical"));
  console.log("  💢 pain-point...");
  all.push(...await generateVoicedShorts(topicsFor(nPain, nEdu), "painpoint"));
  console.log("  🧩 quiz-test...");
  all.push(...await generateQuizTestShorts(nTest));

  return all;
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
  shorts.forEach((s) => {
    const parts = s.shortType === "quiztest" ? `${s.options?.length ?? 0} options` : `${s.scenes?.length ?? 0} scenes`;
    console.log(`   ${s.id} [${s.shortType}]: ${s.title} (${parts})`);
  });
}

main().catch((e) => { console.error("❌", e.message); process.exit(1); });
