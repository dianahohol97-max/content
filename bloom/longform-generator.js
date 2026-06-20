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
const WEEK = args.week ? parseInt(args.week) : 29;
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
  const prompt = `You are a long-form YouTube scriptwriter for bloom focus, a faceless ADHD education brand.

Voice/tone: warm, direct, science-backed but simple — "a friend with a neuroscience degree who also lost their keys this morning". Validating, never patronizing. Clinically ACCURATE (this is a trust brand — unlike most viral ADHD content). Never "just try harder" or "ADHD is a superpower".

Write ONE 8-10 minute documentary-style video on:
"${topic}"

This is faceless: a voiceover plays over changing aesthetic background shots with short on-screen captions. It must EARN its length with dense, specific, genuinely useful content — no padding, no fluff (padding kills retention).

STRUCTURE — 5 to 6 CHAPTERS. Each chapter has:
- title: short chapter title (for timecodes in the description)
- voiceover: the full narration for this chapter (~150-200 words each — together all chapters should total ~1300-1600 words ≈ 8-10 min spoken).
- scenes: 3-5 scenes for this chapter. Each scene:
    - caption: short on-screen text (max 6 words), the key phrase of that beat.
    - imagePrompt: realistic aesthetic vertical/wide-friendly photo bg. Style: "Realistic aesthetic photograph, soft pastel tones (lavender, cream, sage, blush), cozy minimal scene, soft natural light, shallow depth of field, film-like. No people, no faces, no text." Add a relevant detail (desk, window, plant, clock, journal, coffee, bed, path, books).
    - seconds: 6-10 each.

Chapter 1 must HOOK in the first 15 seconds (55% of viewers leave in the first minute) — open with recognition or a compelling question, state what the video will give them, then deliver. The final chapter ends with a warm CTA to the free ADHD quiz.

Also return:
- title: YouTube title, 50-70 chars, search-intent first (e.g. "ADHD Task Paralysis: Why It Happens and How to Break It")
- description: 3-4 sentence summary with keywords. Then a blank line, then "Chapters:" — but DO NOT compute timecodes (the builder fills them). Then the quiz URL.
- tags: 10-15 YouTube tags.
- funnel: "quiz".
- destinationUrl: ${URLS.quiz}.

Use ONLY straight ASCII apostrophes ('). No curly quotes or special characters.

Return ONLY a valid JSON array with ONE object, no markdown:
[
  {
    "title": "...",
    "description": "...",
    "tags": ["..."],
    "chapters": [
      { "title": "...", "voiceover": "...", "scenes": [ { "caption": "...", "imagePrompt": "...", "seconds": 8 } ] }
    ],
    "funnel": "quiz",
    "destinationUrl": "${URLS.quiz}"
  }
]`;

  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 8000,
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
