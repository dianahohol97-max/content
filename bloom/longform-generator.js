/**
 * bloom focus — longform-generator.js
 * Generates 8-10 min documentary-style YouTube videos for the ADHD brand.
 *
 * Faceless: voiceover (ElevenLabs) over changing aesthetic Gemini shots + captions.
 * Structured into chapters (with timecodes for the description).
 *
 * Output: longform_week_X.json + longform_current.json
 *
 * Usage: node bloom/longform-generator.js --week=29 --count=3
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
const COUNT = args.count ? parseInt(args.count) : 3;

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const URLS = { quiz: "https://bloomfocus.org/quiz", app: "https://bloomfocus.org/app", site: "https://bloomfocus.org" };

// Deep topics that honestly fill 8-10 min (not stretched Shorts).
// Chosen from what performs in long-form ADHD (How to ADHD / Dr Tracey Marks style):
// dense, structured, narrative, clinically accurate, emotionally resonant.
const TOPICS = [
  "the complete guide to ADHD task paralysis: why it happens and how to break it",
  "ADHD and time blindness: the full science and a system that actually works",
  "understanding the ADHD dopamine system: why motivation works differently",
  "ADHD in women: why it's missed for decades and what it really looks like",
  "executive dysfunction explained: the 7 functions and how ADHD affects each",
  "rejection sensitive dysphoria: the most painful ADHD symptom nobody explains",
  "how to build an ADHD-friendly life: systems that survive a chaotic brain",
  "ADHD and emotional regulation: why feelings hit harder and what helps",
  "the ADHD burnout cycle: how to recognize it and actually recover",
  "late-diagnosed ADHD: making sense of a lifetime of masking and self-blame",
  "ADHD and sleep: why your brain won't shut off and how to fix your nights",
  "the truth about ADHD and motivation: interest-based nervous system explained",
];

function parseJSON(text) {
  let t = text.trim();
  if (t.startsWith("```")) t = t.replace(/^```(json)?/i, "").replace(/```$/, "").trim();
  const start = t.indexOf("[");
  const end = t.lastIndexOf("]");
  if (start !== -1 && end !== -1) t = t.slice(start, end + 1);
  return JSON.parse(t);
}

async function generateOne(topic) {
  const ART_STYLE = "Hand-drawn illustration in soft pastel colors, cozy and warm style. Soft watercolor texture, gentle hand-painted lines, flat illustration. Palette: lavender, cream, sage green, blush pink. Calm, friendly, approachable, non-judgmental mood. No people, no faces, no text, no letters. Wide landscape 16:9 composition.";

  const prompt = `You are a long-form YouTube scriptwriter for bloom focus, a faceless ADHD education brand.

Voice/tone: warm, direct, science-backed but simple — "a friend with a neuroscience degree who also lost their keys this morning". Validating, never patronizing. Clinically ACCURATE (this is a trust brand — unlike most viral ADHD content). Never "just try harder" or "ADHD is a superpower".

Write ONE genuinely 8-10 minute documentary-style video on:
"${topic}"

CRITICAL — LENGTH AND DEPTH:
This must be a REAL 8-10 minute video. At ~140 words/minute spoken, that means
the voiceover across all chapters MUST total 1300-1500 words. This is long —
do not write a short script. BUT every sentence must earn its place: depth, not
padding (padding kills retention). Hit the length by going DEEPER, not by repeating.

To reach real depth, EACH chapter must include several of:
- a concrete, vivid example of what this looks like in real daily life ("It's Tuesday morning. The email has been open for 40 minutes...")
- the actual underlying neuroscience, explained simply (dopamine, prefrontal cortex, executive function — what's really happening, not hand-waving)
- WHY common advice fails for this specific thing
- a specific, actionable strategy walked through step by step (not just named)
- validation that reframes shame into understanding

STRUCTURE — 6 CHAPTERS. Each chapter:
- title: short chapter title (for description timecodes)
- voiceover: the FULL narration for this chapter. Each chapter must be 200-260 words (NOT less — this is what makes the video 8-10 min). Rich, specific, flowing naturally as spoken word.
- scenes: 4-6 scenes for this chapter. Each scene:
    - tag: a SHORT category slug for this scene's main subject (lowercase, underscores) from a reusable vocabulary so images cache/reuse. Prefer ONE of: brain, desk_messy, desk_tidy, desk_empty, coffee, journal, window_light, bed, clock, plant, books, phone, path, lamp, calendar, sparks, cozy_room, sky, chair. If none fit, make a simple slug. Same subject MUST share the same tag.
    - caption: leave "" (on-screen text is synced subtitles from the voiceover).
    - imagePrompt: ALWAYS begin with exactly this style: "${ART_STYLE}" Then add ONE simple scene detail matching the tag (a desk with coffee and a notebook; an abstract brain of soft clouds and sparks; a gently messy cozy room; a window with morning light; a soft surreal melting clock; a winding path; stacked books; a single chair). Keep EVERY scene in this SAME hand-drawn pastel style.
    - seconds: leave as 0 (timing is computed automatically).

Chapter 1 must HOOK in the first 15 seconds (55% of viewers leave in the first minute) — open mid-punch with sharp recognition, state what the video will give them, then deliver. The final chapter ends warmly with: "Follow for daily ADHD content."

Also return:
- title: YouTube title, 50-70 chars, search-intent first (e.g. "ADHD Task Paralysis: Why It Happens and How to Break It")
- thumbnailText: 3-5 words for the thumbnail — punchy, curiosity/pain driven, NOT the title. e.g. "Why tasks feel IMPOSSIBLE" or "It's NOT laziness" or "All day. Did nothing."
- thumbnailAccent: ONE word from thumbnailText to highlight in a different color (the most emotional/punchy word), e.g. "IMPOSSIBLE" or "NOT" or "NOTHING".
- description: 3-4 sentence summary with keywords. Then a blank line, then "Chapters:" — DO NOT compute timecodes (the builder fills them).
- tags: 10-15 YouTube tags.
- funnel: "follow".

Use ONLY straight ASCII apostrophes ('). No curly quotes or special characters.

Return ONLY a valid JSON array with ONE object, no markdown:
[
  {
    "title": "...",
    "thumbnailText": "...",
    "thumbnailAccent": "...",
    "description": "...",
    "tags": ["..."],
    "chapters": [
      { "title": "...", "voiceover": "...", "scenes": [ { "tag": "brain", "caption": "", "imagePrompt": "..." } ] }
    ],
    "funnel": "follow"
  }
]`;

  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 16000,
    messages: [{ role: "user", content: prompt }],
  });
  const arr = parseJSON(response.content[0].text);
  return arr[0];
}

async function main() {
  console.log(`\n🎥 bloom focus — Long-form generator — Week ${WEEK}\n${"━".repeat(50)}`);
  const startIdx = ((WEEK - 1) * COUNT) % TOPICS.length;
  const weekTopics = Array.from({ length: COUNT }, (_, i) => TOPICS[(startIdx + i) % TOPICS.length]);

  const videos = [];
  for (let i = 0; i < weekTopics.length; i++) {
    console.log(`\n  [${i + 1}/${COUNT}] ${weekTopics[i]}`);
    let v;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        v = await generateOne(weekTopics[i]);
        if (!v || !Array.isArray(v.chapters) || v.chapters.length === 0) throw new Error("no chapters");
        break;
      } catch (err) {
        console.warn(`    ✗ attempt ${attempt}: ${err.message}`);
        if (attempt === 3) throw err;
        await new Promise((r) => setTimeout(r, 1500 * attempt));
      }
    }
    const sceneCount = v.chapters.reduce((n, c) => n + (c.scenes?.length ?? 0), 0);
    console.log(`    ✓ ${v.chapters.length} chapters, ${sceneCount} scenes`);
    videos.push({
      id: `LF_W${WEEK}_${String(i + 1).padStart(2, "0")}`,
      week: WEEK,
      ...v,
      status: "pending",
      videoUrl: null,
      postedAt: null,
    });
  }

  fs.writeFileSync(path.join(REPO_ROOT, `longform_week_${WEEK}.json`), JSON.stringify(videos, null, 2));
  fs.writeFileSync(path.join(REPO_ROOT, "longform_current.json"), JSON.stringify(videos, null, 2));
  console.log(`\n✅ ${videos.length} long-form videos → longform_week_${WEEK}.json`);
  videos.forEach((v) => console.log(`   ${v.id}: ${v.title}`));
}

main().catch((e) => { console.error("❌", e.message); process.exit(1); });
