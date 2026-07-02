/**
 * bloom focus — carousel-generator.js  (v2 — 7 daily rubrics, journal style)
 * Mon=myth · Tue=quiz · Wed=steps · Thu=chapters · Fri=diary · Sat=dictionary · Sun=reset
 * Output: carousel_week_X.json — 7 carousels in day order, typed slides for carousel-build.js
 *
 *   node bloom/carousel-generator.js --week=27 --count=7
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
function isoWeek(d = new Date()) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return Math.ceil((((t - yearStart) / 86400000) + 1) / 7);
}
const WEEK = parseInt(args.week) || isoWeek();
const COUNT = args.count ? Math.min(parseInt(args.count), 7) : 7;

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const VOICE = `Voice/tone: warm, direct, science-backed but simple — "a friend with a neuroscience degree who also lost their keys this morning". Validating, never patronizing. Clinically ACCURATE. Never "just try harder", never "ADHD is a superpower", never the word "hack". Concrete beats abstract: real scenarios ("the report card said 'doesn't apply herself'"), never generic filler.`;

const JSON_RULES = `Return ONLY a JSON array containing exactly ONE object. No markdown, no backticks, no commentary. Use \\n for line breaks inside strings. Keep every "kicker" under 30 characters, handwritten-note energy, lowercase.`;

const CAPTION_RULES = `Also include in the object:
- "caption": IG caption — hook line + 2-3 specific sentences + a question that invites comments. End with "Save this and follow @bloomfocus.adhd for daily ADHD content."
- "hashtags": array of 8-12 hashtags mixing broad (#ADHD, #ADHDbrain, #neurodivergent) and niche ones matching the topic.`;

// ---------- topic pools (rotated by week, no repeats week to week) ----------
const POOLS = {
  myth: [
    "ADHD is just a lack of discipline / it's a dopamine regulation difference",
    "everyone is a little ADHD / trait vs disorder: impairment is the line",
    "ADHD meds are a crutch or dangerous / most-studied treatment in psychiatry",
    "ADHD is a childhood boys' condition / adults and women are underdiagnosed",
    "if you can hyperfocus you can't have ADHD / attention regulation not deficit",
    "ADHD is overdiagnosed hype / missed diagnoses cost decades",
  ],
  quiz: [
    { theme: "4 types of ADHD task paralysis — which one is you?", options: ["The Overwhelm Freezer", "The Perfectionist Staller", "The Novelty Chaser", "The Deadline Gambler"] },
    { theme: "which ADHD morning is yours?", options: ["The Snooze Spiral", "The Doom-Scroll Drift", "The Frantic Launch", "The 5am Hyperfocus"] },
    { theme: "4 ways ADHD brains do friendship", options: ["The Ghost Who Cares", "The Overtexter", "The Plan Canceller", "The Ride-or-Die (in bursts)"] },
    { theme: "what's your ADHD cleaning style?", options: ["The Doom Pile Architect", "The 2am Deep Cleaner", "The One-Room Wonder", "The Body Double Believer"] },
  ],
  steps: [
    "how to start a task when your brain says no (dopamine-first)",
    "how to actually leave the house on time with time blindness",
    "how to survive waiting mode without losing the whole day",
    "how to set up tomorrow tonight (ADHD evening reset, 10 minutes)",
    "how to get out of a doom-scroll spiral without shame",
    "how to remember things when your working memory won't",
  ],
  chapters: [
    { theme: "ADHD traits you thought were personality flaws", patterns: ["Object Permanence", "Low Interoception", "Rejection Masking", "Time Blindness", "Emotional Permanence"] },
    { theme: "Hidden ADHD struggles no one talks about", patterns: ["Waiting Mode", "Decision Paralysis", "Auditory Processing Lag", "The Wall of Awful", "Hyperfixation Crash"] },
    { theme: "Why ADHD makes everyday life harder", patterns: ["Task Switching Cost", "Working Memory Gaps", "Sensory Overload", "Demand Avoidance", "Revenge Bedtime Procrastination"] },
    { theme: "ADHD signs that hide in plain sight", patterns: ["Justice Sensitivity", "Stimulation Seeking", "Chronic Lateness Guilt", "Emotional Dysregulation", "Time Agnosia"] },
  ],
  diary: [
    "a week of ADHD productivity (honest version)",
    "trying to do one simple errand",
    "the life cycle of a new hyperfixation",
    "attempting a normal bedtime",
    "answering one important email",
  ],
  dictionary: [
    { word: "time blindness", pos: "noun", phonetic: "/taɪm ˈblaɪndnəs/" },
    { word: "body doubling", pos: "noun", phonetic: "/ˈbɒdi ˈdʌblɪŋ/" },
    { word: "waiting mode", pos: "noun", phonetic: "/ˈweɪtɪŋ moʊd/" },
    { word: "doom pile", pos: "noun", phonetic: "/duːm paɪl/" },
    { word: "hyperfocus", pos: "noun", phonetic: "/ˌhaɪpərˈfoʊkəs/" },
    { word: "task paralysis", pos: "noun", phonetic: "/tæsk pəˈræləsɪs/" },
  ],
  reset: [
    "you don't need to plan the perfect week",
    "sunday is not a productivity deadline",
    "rest is not something you earn",
    "next week does not need a new you",
  ],
};
const pick = (arr, offset) => arr[( (WEEK - 1) + offset ) % arr.length];

// ---------- per-rubric prompt builders ----------
function mythPrompt(topic) {
  return `You write Instagram carousels for bloom focus, a faceless ADHD education brand.
${VOICE}

Rubric: MYTH / TRUTH (Monday). Seed myth pair: "${topic}". Build the carousel around this myth plus TWO more closely-related myths people with ADHD hear constantly.

Slides array (8 slides, "type" field on each):
1. {"type":"hook","headline": scroll-stopping title about ADHD myths (max 8 words),"sub": 1-2 sentences teasing what gets debunked,"kicker":"..."}
2-7. THREE PAIRS, alternating: {"type":"myth","idx":1,"headline": the myth stated exactly how people say it (max 9 words)} then {"type":"truth","idx":1,"headline": the truth (max 8 words),"body": 2-3 sentences of plain-language science with one concrete detail (a study finding, a mechanism, a stat).}
8. {"type":"cta","headline": warm wrap-up line,"body": 1-2 sentences,"commentPrompt": short question asking which myth they've heard most}

${CAPTION_RULES}
${JSON_RULES}`;
}

function quizPrompt(set) {
  return `You write Instagram carousels for bloom focus, a faceless ADHD education brand.
${VOICE}

Rubric: WHICH ONE ARE YOU (Tuesday quiz). Theme: "${set.theme}". The four types: ${set.options.map((o,i)=>`${"ABCD"[i]} = ${o}`).join(", ")}.

Slides array (8 slides):
1. {"type":"hook","headline": the theme as a question (max 8 words),"sub":"four types. one is painfully you. comment your letter.","kicker":"..."}
2-5. {"type":"quiz","letter":"A".."D","typeName": the type name,"body": 3-4 sentences describing this type so specifically the reader laughs and feels seen. Concrete scenes, not adjectives.}
6. {"type":"chapter","idx":1,"headline":"whichever letter you picked","body": 2-3 validating sentences: all four are attention-regulation patterns, none are character flaws.}
7. {"type":"cta","headline":"comment your letter 👇","body":"and if you want the full picture — the free ADHD quiz goes deeper than four types.","commentPrompt":"A, B, C or D?"}
8 is not needed — exactly 7 slides.

${CAPTION_RULES}
${JSON_RULES}`;
}

function stepsPrompt(topic) {
  return `You write Instagram carousels for bloom focus, a faceless ADHD education brand.
${VOICE}

Rubric: ACTUALLY USEFUL (Wednesday practical guide). Topic: "${topic}".

Slides array (9 slides):
1. {"type":"hook","headline": the how-to promise (max 9 words),"sub": 1-2 sentences: what this solves + "no discipline required" energy,"kicker":"..."}
2-6. {"type":"step","idx":1..5,"headline": imperative step name (max 6 words),"body": 2-4 sentences: exactly what to do + one line of WHY it works for ADHD wiring (dopamine, working memory, activation energy). Include one concrete example.}
7. {"type":"checklist","headline":"your toolkit","items": the 5 steps compressed to max 5 words each}
8. {"type":"cta","headline": warm encouragement line,"body":"start with one. literally just one.","commentPrompt": ask which step they'll try tonight}
Exactly 8 slides total (hook, 5 steps, checklist, cta).

${CAPTION_RULES}
${JSON_RULES}`;
}

function chaptersPrompt(set) {
  return `You write Instagram carousels for bloom focus, a faceless ADHD education brand.
${VOICE}

Rubric: KNOW YOUR BRAIN (Thursday education, the saves-heavy format). Theme: "${set.theme}". Patterns, one per slide, in order: ${set.patterns.join(", ")}.

Slides array (${set.patterns.length + 2} slides):
1. {"type":"hook","headline": the theme made scroll-stopping (max 9 words),"sub":"scroll through — you'll recognize yourself.","kicker":"..."}
2-${set.patterns.length + 1}. {"type":"chapter","idx":1..${set.patterns.length},"headline": pattern name,"body": 1-2 sentence plain-language explanation, then "\\n" then 2-3 concrete first-person-recognizable examples, each its own line, specific ("You forget laundry in the machine until it smells"), no emojis at line starts.}
${set.patterns.length + 2}. {"type":"cta","headline":"You're not broken.","body":"Every trait here was explained to you as a character flaw. It wasn't. It isn't.","commentPrompt": ask which one hit hardest}

${CAPTION_RULES}
${JSON_RULES}`;
}

function diaryPrompt(topic) {
  return `You write Instagram carousels for bloom focus, a faceless ADHD education brand.
${VOICE}

Rubric: DEAR ADHD DIARY (Friday — relatable humor, "this is literally me" shares). Scenario: "${topic}". Written as short first-person diary entries. Funny because it's TRUE, never mocking. The humor is recognition, the ending is warmth.

Slides array (8 slides):
1. {"type":"hook","headline":"dear diary: ${topic.includes(" ") ? topic : "a normal week"}" reworded naturally (max 9 words),"sub":"a completely true story. unfortunately.","kicker":"..."}
2-6. {"type":"diary","dateLine": like "monday, 9:14am" or "tuesday, 2am" (times matter — make them comedically precise),"body": 2-4 sentence diary entry. Specific, escalating through the carousel, each entry lands a small punchline.}
7. {"type":"truth","idx":1,"headline":"it was never laziness","body": 2-3 warm sentences reframing the whole story through executive function — the turn from comedy to being seen.}
8. {"type":"cta","headline":"if this was uncomfortably accurate","body":"send it to someone who gets it.","commentPrompt": ask which day was them}

${CAPTION_RULES}
${JSON_RULES}`;
}

function dictionaryPrompt(entry) {
  return `You write Instagram carousels for bloom focus, a faceless ADHD education brand.
${VOICE}

Rubric: THE ADHD DICTIONARY (Saturday — word of the week). Word: "${entry.word}" (${entry.pos}, ${entry.phonetic}).

Slides array (7 slides):
1. {"type":"hook","headline":"there's a word for that thing you do","sub": one intriguing sentence about the word without naming it,"kicker":"..."}
2. {"type":"dict","word":"${entry.word}","pos":"${entry.pos}","phonetic":"${entry.phonetic}","defs":[first def = precise plain-language definition, second def = the funny-but-true one],"example": one first-person example sentence in quotes-worthy diary voice}
3-5. {"type":"chapter","idx":1..3,"headline": short "seen in the wild" scenario title,"body": 2-3 sentences: a concrete everyday scene where this word explains everything.}
6. {"type":"truth","idx":1,"headline":"naming it changes it","body": 2-3 sentences: why having language for an experience reduces shame and enables workarounds.}
7. {"type":"cta","headline":"now you have the word","body":"use it. share it. save it for the next time someone says 'just leave earlier'.","commentPrompt": ask what word they'd add to the ADHD dictionary}

${CAPTION_RULES}
${JSON_RULES}`;
}

function resetPrompt(topic) {
  return `You write Instagram carousels for bloom focus, a faceless ADHD education brand.
${VOICE}

Rubric: SUNDAY RESET (Sunday — calm, anti-hustle, minimal text, maximum permission). Theme: "${topic}". This is the quietest carousel of the week. Short lines. Lots of air. No lists, no productivity pressure.

Slides array (7 slides):
1. {"type":"hook","headline": the theme as a gentle statement (max 8 words),"sub": one soft sentence,"kicker":"..."}
2-5. {"type":"reset","headline": one big gentle line (max 8 words),"body": ONE short supporting sentence (max 15 words). Each slide = one permission or reframe.}
6. {"type":"reset","headline":"your permission slip for this week","body": one specific tiny thing they're allowed to do or skip}
7. {"type":"cta","headline":"see you monday","body":"same brain. no new you required.","commentPrompt": ask what they're NOT doing this week}

${CAPTION_RULES}
${JSON_RULES}`;
}

// ---------- day plan ----------
const PLAN = [
  { day: "MON", rubric: "myth",       build: () => mythPrompt(pick(POOLS.myth, 0)) },
  { day: "TUE", rubric: "quiz",       build: () => quizPrompt(pick(POOLS.quiz, 0)) },
  { day: "WED", rubric: "steps",      build: () => stepsPrompt(pick(POOLS.steps, 0)) },
  { day: "THU", rubric: "chapters",   build: () => chaptersPrompt(pick(POOLS.chapters, 0)) },
  { day: "FRI", rubric: "diary",      build: () => diaryPrompt(pick(POOLS.diary, 0)) },
  { day: "SAT", rubric: "dictionary", build: () => dictionaryPrompt(pick(POOLS.dictionary, 0)) },
  { day: "SUN", rubric: "reset",      build: () => resetPrompt(pick(POOLS.reset, 0)) },
];

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
      console.warn(`   ⚠ ${label} attempt ${i} failed: ${e.message.slice(0, 100)}`);
      if (i === tries) throw e;
      await new Promise((r) => setTimeout(r, 2500 * i));
    }
  }
}

async function generate(prompt) {
  const r = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 4000,
    messages: [{ role: "user", content: prompt }],
  });
  return parseJSON(r.content[0].text)[0];
}

async function main() {
  console.log(`\n🎠 bloom focus — Carousel generator v2 — Week ${WEEK} — ${COUNT} rubrics\n${"━".repeat(50)}\n`);
  const out = [];
  for (let i = 0; i < COUNT; i++) {
    const slot = PLAN[i];
    console.log(`  [${i + 1}/${COUNT}] ${slot.day} · ${slot.rubric}`);
    const c = await retry(() => generate(slot.build()), slot.rubric);
    c.id = `CR_W${WEEK}_${slot.day}`;
    c.week = WEEK;
    c.day = slot.day;
    c.rubric = slot.rubric;
    c.status = "pending";
    c.slideImageURLs = [];
    console.log(`    ✓ ${c.slides.length} slides`);
    out.push(c);
  }
  fs.writeFileSync(path.join(REPO_ROOT, `carousel_week_${WEEK}.json`), JSON.stringify(out, null, 2));
  console.log(`\n✅ ${out.length} carousels → carousel_week_${WEEK}.json`);
}

main().catch((e) => { console.error("✗", e); process.exit(1); });
