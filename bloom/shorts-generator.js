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
const COUNT = args.count ? parseInt(args.count) : 18;

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

// Deeper, meatier topics for flagship shorts (45-60s)
const FLAGSHIP_TOPICS = [
  "the ADHD wall of awful: why the things you care about are hardest to start",
  "ADHD working memory: why you forget what you were just about to do",
  "task paralysis fully explained: why you freeze and 3 ways to break it",
  "the ADHD dopamine system: why motivation works backwards for you",
  "rejection sensitive dysphoria: why criticism physically hurts with ADHD",
  "ADHD time blindness: why now and not-now are your only two times",
  "emotional dysregulation in ADHD: why feelings hit twice as hard",
  "the ADHD burnout cycle: why you crash after pushing too hard",
  "interest-based nervous system: why you can't focus on command",
  "executive dysfunction: the real reason simple tasks feel impossible",
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

THE HOOK IS EVERYTHING. The first line is the whole video's job. It must HIT in one second — a sharp punch of recognition, a painful paradox, or an instant "that's literally me". Examples of the bar to clear:
- "You can game for 6 hours but can't read one email. Here's why."
- "You don't have a motivation problem. You have a dopamine problem."
- "'I'll do it in 5 minutes.' It's now 3 hours later."
- "The things you care about most are the ones you can't start. That's not random."
NEVER open with a slow wind-up ("You meant to pay that bill for three weeks"). Open mid-punch.

IMPORTANT — what makes these perform:
- Lead with RECOGNITION + a sting. Specific lived moments beat clinical definitions.
- Relatable AND accurate. bloom focus wins trust by being correct. "common in ADHD" not "if you do this you have ADHD".`;

// Single fixed illustration style across ALL scenes — hand-drawn warm pastel.
const ART_STYLE = `Hand-drawn illustration in soft pastel colors, cozy and warm style. Soft watercolor texture, gentle hand-painted lines, flat illustration. Palette: lavender, cream, sage green, blush pink. Calm, friendly, approachable, non-judgmental mood. No people, no faces, no text, no letters. Vertical 9:16 composition.`;

const SCENE_SPEC = `    - tag: a SHORT category slug for this scene's main subject (lowercase, underscores) from a small reusable vocabulary so images can be cached/reused. Prefer ONE of: brain, desk_messy, desk_tidy, desk_empty, coffee, journal, window_light, bed, clock, plant, books, phone, path, lamp, calendar, sparks, cozy_room, sky. If none fit, make a simple 1-2 word slug. Scenes about the same thing MUST share the same tag.
    - imagePrompt: ALWAYS begin with exactly this style: "${ART_STYLE}" Then add ONE simple scene detail matching the tag (a desk with coffee and a notebook; an abstract brain of soft clouds and sparks; a gently messy cozy room; a window with morning light and a mug; a soft surreal melting clock; a plant; a journal). Keep every scene in this SAME hand-drawn pastel style.
    - caption: leave "" (on-screen text comes from synced subtitles).`;

const CTA_LINE = `"Follow for daily ADHD content."`;

// ── Educational + pain-point shorts (voiced, changing scenes) ──
async function generateVoicedShorts(weekTopics, kind) {
  const count = weekTopics.length;
  const kindGuide = kind === "painpoint"
    ? `These are PAIN-POINT shorts. Each opens by naming a frustrating, relatable ADHD struggle as a SHARP hook that hits home ("Your home is always a mess — no matter how hard you try"), validates it's not a character flaw, briefly explains the ADHD reason. Emotional and validating, short on theory. End by gently asking if this is them ("Sound familiar every single day?").`
    : kind === "practical"
    ? `These are PRACTICAL HOW-TO shorts. Each teaches ONE concrete ADHD-friendly technique (dopamine menu, body doubling, 2-minute rule, launch pad...). Hook with the struggle sharply ("Your brain won't start? Stop forcing it. Bribe it."), then walk through the method in clear simple steps. Actionable and specific.`
    : kind === "flagship"
    ? `These are FLAGSHIP shorts — longer (45-60s) and deeper. Same sharp hook, but richer: explain the underlying ADHD science AND give concrete practical steps. More substance, more scenes, still tight (no padding). Cover meatier concepts (wall of awful, working memory, full task-paralysis breakdown).`
    : `These are EDUCATIONAL shorts. Sharp hook, then explain the concept simply with recognition + one practical takeaway.`;

  const isFlag = kind === "flagship";
  const prompt = `You are a YouTube Shorts scriptwriter for bloom focus, a faceless ADHD education brand.

${SHARED_VOICE}

${kindGuide}

Write exactly ${count} YouTube Shorts (${isFlag ? "45-60s, deeper" : "30-40s"}, faceless, voiced narration over changing hand-drawn pastel illustrations).

Topics (one Short each):
${weekTopics.map((t, i) => `${i + 1}. ${t}`).join("\n")}

STRUCTURE:
- HOOK (0-2s): the sharp punch (see voice rules). This is the most important line.
- BODY: ${isFlag ? "science + concrete steps, broken into 7-9 scenes" : kind === "painpoint" ? "validate + brief ADHD reason, 5-6 scenes" : "explain + one takeaway, 5-6 scenes"}.
- CTA (last 2s): ${CTA_LINE} — NO links, NO "quiz". Just invite them to follow.

For EACH Short return:
- voiceover: FULL narration as one flowing text (${isFlag ? "~130-160 words for ~50s" : "~80-100 words for ~33s"}). Natural spoken rhythm. End with: Follow for daily ADHD content.
- scenes: array of ${isFlag ? "8-10" : "5-7"} scenes. Each:
${SCENE_SPEC}
- title: 40-70 chars, search-friendly, ends with #Shorts.
- description: 2-3 sentences with keywords. Then on its own line: "Follow for daily ADHD content."
- tags: 8-12 YouTube tags.
- funnel: "follow".
- shortType: "${kind}".

Use ONLY straight ASCII apostrophes ('). No curly quotes, no special characters.

Return ONLY a valid JSON array, no markdown:
[
  { "voiceover": "...", "scenes": [{ "tag": "brain", "imagePrompt": "...", "caption": "" }], "title": "... #Shorts", "description": "...", "tags": ["..."], "funnel": "follow", "shortType": "${kind}" }
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

Create exactly ${count} INTERACTIVE TEST shorts. Format: a question with FOUR image options shown as a 2x2 grid, viewer picks one — then the video REVEALS what each choice means, ONE option at a time, on screen (NOT hidden in the description). High shareability, drives comments.

Good test concepts:
- "Which of these 4 mornings is yours?" (4 morning scenes) → each reveals an ADHD pattern
- "Pick the desk that looks most like yours" → reveals a focus type
- "What do you see first?" (4 ambiguous calming images) → playful ADHD-style result
- "Which mess stresses you least?" → reveals overwhelm style

For EACH test short return:
- question: the on-screen question (max 8 words), shown at the top.
- options: an array of EXACTLY 4 options, each:
    - label: short label shown on the tile (max 3 words), e.g. "The avalanche".
    - imagePrompt: ALWAYS begin with exactly this style: "${ART_STYLE}" Then add one simple distinct scene for this tile. All 4 in the SAME hand-drawn pastel style, just different scenes.
    - result: ONE short sentence (max 16 words) revealing what picking this option says about the viewer's ADHD brain. Playful, validating, accurate (not fake-clinical). e.g. "You thrive in visible chaos - out of sight really is out of mind for you."
- introVoiceover: short narration (~20-30 words) for the GRID phase: read the question, tease "your pick says something about how your ADHD brain works - let's see", invite a comment.
- outroVoiceover: short closing line (~10-15 words) after the reveals, ending with: Follow for daily ADHD content.
- title: 40-70 chars, ends with #Shorts. e.g. "Which desk is yours? (ADHD test) #Shorts"
- description: 1-2 sentence intro (do NOT reveal answers - they're in the video), then on its own line: "Follow for daily ADHD content."
- tags: 8-12 tags.
- funnel: "follow".
- shortType: "quiztest".

Use ONLY straight ASCII apostrophes ('). No curly quotes.

Return ONLY a valid JSON array, no markdown:
[
  { "question": "...", "options": [{ "label": "...", "imagePrompt": "...", "result": "..." }, { "label": "...", "imagePrompt": "...", "result": "..." }, { "label": "...", "imagePrompt": "...", "result": "..." }, { "label": "...", "imagePrompt": "...", "result": "..." }], "introVoiceover": "...", "outroVoiceover": "...", "title": "... #Shorts", "description": "...", "tags": ["..."], "funnel": "follow", "shortType": "quiztest" }
]`;

  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 4000,
    messages: [{ role: "user", content: prompt }],
  });
  return parseJSON(response.content[0].text).map((s) => ({ ...s, shortType: "quiztest" }));
}

async function generateShorts(weekNum, count) {
  // Mix (scaled to count=18): 4 educational, 3 practical, 3 pain-point, 4 quiz-test, 4 flagship
  const nEdu = Math.max(1, Math.round(count * 4 / 18));
  const nPrac = Math.max(1, Math.round(count * 3 / 18));
  const nPain = Math.max(1, Math.round(count * 3 / 18));
  const nFlag = Math.max(1, Math.round(count * 4 / 18));
  const nTest = Math.max(1, count - nEdu - nPrac - nPain - nFlag);

  // rotate topics by week
  const startIdx = ((weekNum - 1) * count) % TOPICS.length;
  const topicsFor = (n, offset) =>
    Array.from({ length: n }, (_, i) => TOPICS[(startIdx + offset + i) % TOPICS.length]);
  const flagStart = ((weekNum - 1) * nFlag) % FLAGSHIP_TOPICS.length;
  const flagTopics = Array.from({ length: nFlag }, (_, i) => FLAGSHIP_TOPICS[(flagStart + i) % FLAGSHIP_TOPICS.length]);

  console.log(`  mix → ${nEdu} edu, ${nPrac} practical, ${nPain} pain-point, ${nTest} quiz-test, ${nFlag} flagship`);

  const all = [];
  console.log("  ✏️  educational...");
  all.push(...await generateVoicedShorts(topicsFor(nEdu, 0), "educational"));
  console.log("  🔧 practical...");
  all.push(...await generateVoicedShorts(PRACTICAL_TOPICS.slice(0, nPrac), "practical"));
  console.log("  💢 pain-point...");
  all.push(...await generateVoicedShorts(topicsFor(nPain, nEdu), "painpoint"));
  console.log("  🧩 quiz-test...");
  all.push(...await generateQuizTestShorts(nTest));
  console.log("  ⭐ flagship...");
  all.push(...await generateVoicedShorts(flagTopics, "flagship"));

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
