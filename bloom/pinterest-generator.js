/**
 * bloom focus — Pinterest Generator
 * Generates 70 pins/week (10/day × 7 days)
 *
 * Distribution per day (4+3+2+1 funnel strategy):
 *   4 pins → bloomfocus.org/quiz     (cold — ADHD test)
 *   3 pins → bloomfocus.org/app      (warm — free ADHD app with gamification)
 *   2 pins → etsy.com/shop/BloomfocusShop  (hot — product)
 *   1 pin  → bloomfocus.org/blog     (education / SEO authority)
 *
 * Output: JSON file + console log (ready to push to Google Sheets)
 *
 * Usage:
 *   node pinterest-generator.js --week=25
 *   node pinterest-generator.js --week=25 --day=1   (generate only 1 day)
 */

import 'dotenv/config';
import Anthropic from "@anthropic-ai/sdk";
import fs from "fs";
import { BOARD_IDS, DEFAULT_BOARD_ID } from "./board-ids.js";

// ─── Config ──────────────────────────────────────────────────────────────────

function isoWeek(d = new Date()) {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - day + 3);
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  const fday = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - fday + 3);
  return 1 + Math.round((date - firstThursday) / (7 * 24 * 3600 * 1000));
}
const WEEK = parseInt(process.argv.find((a) => a.startsWith("--week="))?.split("=")[1] ?? String(isoWeek()));
const DAY_ONLY = process.argv.find((a) => a.startsWith("--day="))?.split("=")[1];

const DAYS = DAY_ONLY ? [parseInt(DAY_ONLY)] : [1, 2, 3, 4, 5, 6, 7];

const URLS = {
  quiz: "https://bloomfocus.org/quiz",
  app:  "https://bloomfocus.org/app",
  etsy: "https://www.etsy.com/shop/BloomfocusShop",
  blog: "https://bloomfocus.org/blog",
  site: "https://bloomfocus.org",
};

const BOARDS = [
  "ADHD Tips & Science",
  "ADHD Productivity",
  "ADHD Planners & Printables",
  "ADHD Morning Routines",
  "Dopamine & Focus",
  "Neurodivergent Life",
];

const PRODUCTS = [
  "Dopamine Menu",
  "Hyperfocus Planner",
  "ADHD Daily Tracker",
  "Body Double Timer",
  "Task Initiation Kit",
  "ADHD Morning Routine Planner",
  "Executive Function Workbook",
];

const KEYWORD_SEEDS = [
  "ADHD planner printable",
  "ADHD morning routine",
  "dopamine menu ADHD",
  "task paralysis help",
  "ADHD productivity tips",
  "ADHD brain science",
  "ADHD motivation",
  "executive dysfunction",
  "body doubling ADHD",
  "ADHD habit tracker",
  "neurodivergent life hacks",
  "ADHD focus tips",
  "ADHD women",
  "ADHD daily routine",
  "ADHD organization system",
  "ADHD time blindness",
  "dopamine and ADHD",
  "ADHD self-care",
  "ADHD diagnosis adults",
  "ADHD coping strategies",
];

// Day→topic theme to keep variety across the week
const DAY_THEMES = {
  1: "morning routines and starting the day",
  2: "focus and task initiation",
  3: "emotional regulation and overwhelm",
  4: "organization systems and planners",
  5: "dopamine, motivation, and reward",
  6: "ADHD science and brain facts",
  7: "self-compassion and ADHD identity",
};

// ─── Anthropic client ─────────────────────────────────────────────────────────

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ─── JSON parser (robust) ─────────────────────────────────────────────────────

function parseJSON(raw) {
  // Strip markdown code fences
  let text = raw.replace(/```(?:json)?\s*/gi, "").replace(/```\s*/g, "").trim();

  // Replace Unicode curly quotes and em-dashes
  text = text
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/–|—/g, "-");

  // Remove control characters (except newline/tab)
  text = text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");

  // Extract outermost [ ... ] or { ... }
  const arrStart = text.indexOf("[");
  const objStart = text.indexOf("{");

  if (arrStart !== -1 && (objStart === -1 || arrStart < objStart)) {
    const end = text.lastIndexOf("]");
    if (end !== -1) text = text.slice(arrStart, end + 1);
  } else if (objStart !== -1) {
    const end = text.lastIndexOf("}");
    if (end !== -1) text = text.slice(objStart, end + 1);
  }

  return JSON.parse(text);
}

// ─── Pin generator (single batch of 5) ───────────────────────────────────────

// ─── Infographic pin generator (list/steps ON the image) ─────────────────────
// These carry value directly on the pin → drive saves + authority.
async function generateInfographicBatch({ funnel, url, theme, weekNum, dayNum, count = 4, attempt = 1 }) {
  const strictness = attempt === 1 ? "" : attempt === 2
    ? " CRITICAL: Use only straight ASCII apostrophes never curly quotes."
    : " ULTRA STRICT: Plain ASCII only. No apostrophes.";

  const funnelCTA = {
    quiz: "Take the free ADHD quiz at bloomfocus.org/quiz",
    app:  "Try the free ADHD app at bloomfocus.org/app",
    etsy: "Shop ADHD tools at etsy.com/shop/BloomfocusShop",
    blog: "Read the full guide at bloomfocus.org/blog",
  };

  const prompt = `You are a Pinterest SEO expert for bloom focus, an ADHD digital products brand.

Generate exactly ${count} INFOGRAPHIC-style Pinterest pins for the "${funnel}" funnel.
Week: ${weekNum}, Day: ${dayNum}. Theme: ${theme}. URL: ${url}

These pins put VALUE directly on the image — a numbered list or steps the user can read and save.

RULES:
- headline: a number-driven hook, 4-7 words. Examples: "5 ADHD Morning Tricks", "7 Signs of ADHD Burnout", "4 Ways to Start Any Task". Use a number.
- items: an array of 3-5 SHORT list items (each max 6 words, punchy, actionable, specific to ADHD). No full sentences.
- title: keyword-rich long-tail SEO title (40-60 chars) for the pin metadata.
- description: 150-300 chars, keyword-rich, ends with: ${funnelCTA[funnel]}
- imagePrompt: A REALISTIC but SIMPLE photo background that leaves room for text — mostly empty cozy desk surface, soft pastel tones, lots of negative space at center and top. "Realistic aesthetic photograph, minimalist cozy desk corner, lots of empty space, soft natural light, muted pastel tones, no people, no text. Vertical 2:3."
- board: one of: ${BOARDS.join(" | ")}
- Each pin must cover a DIFFERENT angle of the theme.${strictness}

Return ONLY a valid JSON array:
[
  {
    "headline": "...",
    "items": ["...", "...", "...", "..."],
    "title": "...",
    "description": "...",
    "imagePrompt": "...",
    "board": "...",
    "destinationUrl": "${url}",
    "funnel": "${funnel}",
    "pinType": "infographic"
  }
]`;

  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 2000,
    messages: [{ role: "user", content: prompt }],
  });

  return parseJSON(response.content[0].text);
}

async function generateInfographicWithRetry(params) {
  const funnelCTA = {
    quiz: "Take the free ADHD quiz at bloomfocus.org/quiz",
    app:  "Try the free ADHD app at bloomfocus.org/app",
    etsy: "Shop ADHD tools at etsy.com/shop/BloomfocusShop",
    blog: "Read the full guide at bloomfocus.org/blog",
  };
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const pins = await generateInfographicBatch({ ...params, attempt });
      if (!Array.isArray(pins) || pins.length === 0) throw new Error("Empty array");
      console.log(`    ✓ infographic batch (${params.funnel}) — ${pins.length} pins`);
      return pins;
    } catch (err) {
      console.warn(`    ✗ infographic attempt ${attempt} failed: ${err.message}`);
      if (attempt === 3) {
        console.warn(`    ⚠ using fallback infographic for ${params.funnel}`);
        return Array.from({ length: params.count ?? 4 }, (_, i) => ({
          headline: `${i + 3} ADHD Focus Tips`,
          items: ["Start with 2 minute tasks", "Use body doubling", "Set visible timers", "Reward small wins"],
          title: `ADHD tips for ${params.theme}`,
          description: `Practical ADHD strategies for ${params.theme}. ${funnelCTA[params.funnel]}`,
          imagePrompt: "Realistic aesthetic photograph, minimalist cozy desk corner with lots of empty space, soft natural light, muted pastel tones, no people, no text. Vertical 2:3.",
          board: BOARDS[0],
          destinationUrl: params.url,
          funnel: params.funnel,
          pinType: "infographic",
        }));
      }
      await new Promise((r) => setTimeout(r, 1000 * attempt));
    }
  }
}

async function generatePinBatch({ funnel, url, theme, weekNum, dayNum, batchIndex, count = 5, attempt = 1 }) {
  const strictness = attempt === 1 ? "" : attempt === 2
    ? " CRITICAL: Use only straight ASCII apostrophes (') never curly quotes. No special characters."
    : " ULTRA STRICT: Plain ASCII only. No apostrophes at all if possible. Keep titles very short.";

  const funnelGuide = {
    quiz: `Goal: cold traffic. The user doesn't know if they have ADHD yet.
Hook style: "9 signs of ADHD in adult women", "Why you can't start tasks (ADHD quiz inside)", "Is this ADHD or just stress? Take the free test".
CTA in description: "Take the free ADHD quiz at bloomfocus.org/quiz"`,

    app: `Goal: warm traffic. The user suspects/knows they have ADHD and is looking for free tools.
Hook style: "Free ADHD app that gamifies your focus", "The free ADHD app that actually makes tasks feel doable", "Free ADHD productivity app with gamification (no credit card)".
Key angle: the app is FREE, has gamification, helps with focus and task management. It is a web app at bloomfocus.org/app.
CTA in description: "Try the free ADHD app at bloomfocus.org/app"`,

    etsy: `Goal: hot traffic. The user is ready to buy a solution.
Hook style: "ADHD Dopamine Menu — finally a planner that works", "The ADHD planner designed by an ADHD brain", "Task Initiation Kit for ADHD — get unstuck fast".
Products available: ${PRODUCTS.join(", ")}.
CTA in description: "Shop ADHD planners and tools at etsy.com/shop/BloomfocusShop"`,

    blog: `Goal: SEO authority and education. Long-tail search traffic.
Hook style: "Why ADHD brains can't just focus (neuroscience)", "ADHD time blindness explained", "Dopamine and ADHD: the science behind motivation".
CTA in description: "Read the full guide at bloomfocus.org/blog"`,
  };

  const prompt = `You are a Pinterest SEO expert for bloom focus, an ADHD digital products brand.

Generate exactly ${count} Pinterest pins for the "${funnel}" funnel.
Week: ${weekNum}, Day: ${dayNum}, Batch: ${batchIndex}
Theme for this day: ${theme}
Destination URL: ${url}

FUNNEL GUIDANCE:
${funnelGuide[funnel]}

PINTEREST RULES:
- Title: 40-60 chars, keyword-rich long-tail phrase (specific beats generic)
  BAD: "ADHD tips"
  GOOD: "ADHD morning routine when you can't get out of bed"
- Description: 150-300 chars, 3-5 relevant keywords naturally embedded, end with destination URL
- imagePrompt: Detailed prompt for a REALISTIC PHOTO (not illustration). Style: "Realistic aesthetic photograph, cozy desk flat-lay, soft natural lighting, muted pastel tones (lavender, cream, sage, blush). Shallow depth of field, film-like. No people, no faces, no text. Vertical 2:3 portrait (1000x1500)." Add scene detail relevant to the pin topic (planner, coffee, plant, journal, phone showing an app, etc).
- overlayTitle: The text shown ON the photo — this is what stops the scroll. 3-7 words. It MUST be a complete, self-explanatory hook, NOT a cut-off phrase.
  ${funnel === "quiz"
    ? `For THIS quiz pin, make it a PAIN-POINT question that lands directly on a felt ADHD experience — the reader should feel "that's exactly me". Sharp and emotional, not abstract.
  GOOD pain-point hooks: "A million thoughts you can't keep up with?", "Start 10 tasks, finish none?", "Brain won't shut off at night?", "Can't start until the last minute?"
  Avoid soft/vague hooks like "ADHD support" or "About focus".`
    : `It must be ONE of these types:
    (a) A question that creates recognition: "Why can't I start tasks?", "ADHD or just tired?"
    (b) A clear benefit/promise: "Make mornings finally work", "Focus without forcing it"
    (c) A relatable statement: "Mornings feel impossible. Here's why."
  BAD (incomplete, confusing): "Start mornings with ADHD", "ADHD focus app", "ADHD support"
  GOOD (complete hook): "Can't get out of bed?", "The app for ADHD mornings", "Mornings shouldn't feel this hard"`}
  Read it aloud — if it sounds cut off or like a fragment, rewrite it as a full thought.
- overlaySigns: An array of 2-3 SHORT recognition signs (max 4 words each) that make the viewer think "that's literally me". These are relatable ADHD experiences tied to the hook — NOT promises of article content, but moments of self-recognition. They make the card resonate and naturally lead to "what's my type? → take the test".
  The signs must genuinely relate to the overlayTitle's pain point.
  Example for "A million thoughts you can't keep up with?":
    ["Racing mind, no off switch", "Forget mid-sentence", "Can't finish a thought"]
  Example for "Start 10 tasks, finish none?":
    ["Frozen by small tasks", "Jump between things", "Better under pressure"]
  Keep each sign concrete and instantly recognizable. No generic filler.
- board: Choose the most relevant from: ${BOARDS.join(" | ")}
- Each pin must have a DIFFERENT title, angle, and imagePrompt (not just paraphrases of the same idea)
- Pins ${batchIndex > 1 ? "in this second batch" : "in this first batch"} must be on different sub-topics within the theme${strictness}

Return ONLY a valid JSON array, no markdown, no explanation:
[
  {
    "title": "...",
    "overlayTitle": "...",
    "overlaySigns": ["...", "...", "..."],
    "description": "...",
    "imagePrompt": "...",
    "board": "...",
    "destinationUrl": "${url}",
    "funnel": "${funnel}"
  }
]`;

  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 2000,
    messages: [{ role: "user", content: prompt }],
  });

  return parseJSON(response.content[0].text);
}

// ─── Retry wrapper ────────────────────────────────────────────────────────────

async function generatePinBatchWithRetry(params) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const pins = await generatePinBatch({ ...params, attempt });
      if (!Array.isArray(pins) || pins.length === 0) throw new Error("Empty array");
      console.log(`    ✓ batch ${params.batchIndex} (${params.funnel}) — ${pins.length} pins`);
      return pins;
    } catch (err) {
      console.warn(`    ✗ attempt ${attempt} failed: ${err.message}`);
      if (attempt === 3) {
        console.warn(`    ⚠ using fallback for ${params.funnel} batch ${params.batchIndex}`);
        return Array.from({ length: params.count ?? 5 }, (_, i) => ({
          title: `ADHD ${params.funnel} tip ${params.batchIndex}-${i + 1}`,
          overlayTitle: "Can't focus today?",
          overlaySigns: ["Mind keeps wandering", "Tasks feel huge", "Time slips away"],
          description: `Helpful ADHD content for ${params.theme}. Visit ${params.url}`,
          imagePrompt: "Realistic aesthetic photograph of a cozy desk with a planner, coffee cup and small plant. Soft natural light, muted pastel tones. No people, no text. Vertical 2:3 portrait (1000x1500).",
          board: BOARDS[0],
          destinationUrl: params.url,
          funnel: params.funnel,
        }));
      }
      await new Promise((r) => setTimeout(r, 1000 * attempt));
    }
  }
}

// ─── Generate meme pins (relatable ADHD humor) ────────────────────────────────

async function generateMemeBatch({ theme, weekNum, dayNum, count = 2, attempt = 1 }) {
  const strictness = attempt === 1 ? "" :
    " CRITICAL: Use only straight ASCII apostrophes ('), never curly quotes. No special characters.";

  const prompt = `You are a social media creator for bloom focus, an ADHD brand.

Generate exactly ${count} relatable ADHD MEME pins. Week ${weekNum}, Day ${dayNum}. Theme: ${theme}.

WHAT A MEME PIN IS:
A short, funny, instantly relatable ADHD moment that makes people think "this is SO me" and tag a friend. Humor WITH the ADHD experience, never mocking it. Warm and self-aware, like an inside joke among people who get it.

GOOD meme topics: racing thoughts at 3am, task paralysis on tiny tasks, hyperfocus on the wrong thing, time blindness, starting 5 things finishing 0, "I'll do it in 5 minutes" (3 hours pass), rejection sensitivity, the doom pile, object permanence ("out of sight out of mind").

TONE: like a friend who has ADHD and lost their keys this morning. Funny, kind, never "ADHD is a superpower", never cruel.

For each meme:
- memeText: The meme line(s). Max 14 words. Can use a setup/punchline format with a line break (\\n). This is the star — make it genuinely funny and relatable.
  GOOD: "My brain at 3am: remember that embarrassing thing from 2014?"
  GOOD: "Me: I'll start in 5 minutes\\nAlso me: *3 hours later*"
  GOOD: "Made a to-do list. Lost the list. Made a new list to find it."
- title: Pinterest SEO title 40-60 chars (keyword-rich, e.g. "Relatable ADHD memes that are too real")
- description: 150-250 chars, relatable, 2-3 ADHD keywords, ends with "More at bloomfocus.org"
- imagePrompt: Cozy aesthetic photo background, soft and minimal so text reads clearly. "Realistic aesthetic photograph, soft pastel tones (lavender, cream, blush, sage), cozy minimal scene, lots of empty space, soft natural light, shallow depth of field. No people, no text. Vertical 2:3 (1000x1500)." Add a calm relevant scene (messy cozy desk, unmade bed with soft light, coffee going cold, sticky notes).
- board: Choose from: ${BOARDS.join(" | ")}${strictness}

Return ONLY a valid JSON array, no markdown:
[
  {
    "memeText": "...",
    "title": "...",
    "description": "...",
    "imagePrompt": "...",
    "board": "...",
    "destinationUrl": "${URLS.site ?? "https://bloomfocus.org"}",
    "funnel": "site",
    "pinType": "meme"
  }
]`;

  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1500,
    messages: [{ role: "user", content: prompt }],
  });

  return parseJSON(response.content[0].text);
}

async function generateMemeWithRetry(params) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const pins = await generateMemeBatch({ ...params, attempt });
      if (!Array.isArray(pins) || pins.length === 0) throw new Error("Empty array");
      console.log(`    ✓ meme batch — ${pins.length} pins`);
      return pins.map((p) => ({ ...p, pinType: "meme" }));
    } catch (err) {
      console.warn(`    ✗ meme attempt ${attempt} failed: ${err.message}`);
      if (attempt === 3) {
        console.warn(`    ⚠ using fallback memes`);
        return Array.from({ length: params.count ?? 2 }, (_, i) => ({
          memeText: i === 0
            ? "My brain at 3am:\nremember that thing from 2014?"
            : "Me: I'll start in 5 minutes\nAlso me: *3 hours later*",
          title: "Relatable ADHD memes that are too real",
          description: "When your ADHD brain has a mind of its own. Relatable ADHD moments, neurodivergent humor. More at bloomfocus.org",
          imagePrompt: "Realistic aesthetic photograph, soft pastel tones lavender cream blush, cozy minimal unmade bed with soft morning light, lots of empty space, shallow depth of field. No people, no text. Vertical 2:3 portrait (1000x1500).",
          board: BOARDS[0],
          destinationUrl: URLS.site ?? "https://bloomfocus.org",
          funnel: "site",
          pinType: "meme",
        }));
      }
      await new Promise((r) => setTimeout(r, 1000 * attempt));
    }
  }
}

// ─── Generate one day ─────────────────────────────────────────────────────────
//
// New mix (data-driven for saves + clicks + sales):
//   4 hook pins   → quiz/app   (short text on photo, drives clicks)
//   4 infographic → quiz/app/blog (list on image, drives saves + authority)
//   2 product     → etsy       (photo + benefit, drives sales)
//   2 meme        → site       (relatable ADHD humor, drives shares + reach)
//   = 12 pins/day

async function generateDay(weekNum, dayNum) {
  const theme = DAY_THEMES[dayNum] ?? "ADHD productivity and focus";
  console.log(`\n📅 Day ${dayNum} — theme: ${theme}`);

  // ── 4 HOOK pins (short text on photo) ──
  console.log(`  📌 Hook pins...`);
  const hookQuiz = await generatePinBatchWithRetry({
    funnel: "quiz", url: URLS.quiz, theme, weekNum, dayNum, batchIndex: 1, count: 3,
  });
  const hookApp = await generatePinBatchWithRetry({
    funnel: "app", url: URLS.app, theme, weekNum, dayNum, batchIndex: 1, count: 1,
  });

  // ── 4 INFOGRAPHIC pins (list/value on image) ──
  console.log(`  📊 Infographic pins...`);
  const infoQuiz = await generateInfographicWithRetry({
    funnel: "quiz", url: URLS.quiz, theme, weekNum, dayNum, count: 1,
  });
  const infoApp = await generateInfographicWithRetry({
    funnel: "app", url: URLS.app, theme, weekNum, dayNum, count: 1,
  });
  const infoBlog = await generateInfographicWithRetry({
    funnel: "blog", url: URLS.blog, theme, weekNum, dayNum, count: 2,
  });

  // ── 2 PRODUCT pins (photo + benefit) ──
  console.log(`  🛒 Product pins...`);
  const product = await generatePinBatchWithRetry({
    funnel: "etsy", url: URLS.etsy, theme, weekNum, dayNum, batchIndex: 1, count: 2,
  });

  // ── 2 MEME pins (relatable ADHD humor → site) ──
  console.log(`  😄 Meme pins...`);
  const memes = await generateMemeWithRetry({
    theme, weekNum, dayNum, count: 2,
  });

  // Tag hook/product pins with pinType for the image generator
  const tagHook = (arr) => arr.map((p) => ({ ...p, pinType: p.pinType ?? "hook" }));

  const allPins = [
    ...tagHook(hookQuiz),
    ...tagHook(hookApp),
    ...infoQuiz,
    ...infoApp,
    ...infoBlog,
    ...tagHook(product),
    ...memes,
  ];

  // Add metadata
  return allPins.map((pin, i) => {
    const base = {
      id: `W${weekNum}_D${dayNum}_${String(i + 1).padStart(2, "0")}`,
      week: weekNum,
      day: dayNum,
      pinNumber: i + 1,
      ...pin,
      boardId: BOARD_IDS[pin.board] ?? DEFAULT_BOARD_ID,
      status: "pending",
      postedAt: null,
    };

    // For infographics, build a ready-to-paste ChatGPT prompt
    if (pin.pinType === "infographic" && Array.isArray(pin.items)) {
      const itemsList = pin.items.map((it, n) => `${n + 1}. ${it}`).join("\n");
      base.chatgptPrompt =
`Create a clean Pinterest infographic (vertical 2:3, 1000x1500) for an ADHD wellness brand "bloom focus".

TITLE (large, bold, friendly rounded font at top): "${pin.headline}"

Numbered list with a small matching pastel icon next to each item:
${itemsList}

Style: soft pastel palette (lavender, cream, sage green, blush pink, light blue), cute flat illustrations, rounded legible sans-serif, soft decorative elements (stars, leaves, hearts), warm supportive feeling. Add "bloomfocus.org" small at the bottom center. Make sure all text is spelled perfectly and the numbers run 1 to ${pin.items.length} in order.`;
    }

    return base;
  });
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n🌸 bloom focus Pinterest Generator`);
  console.log(`   Week ${WEEK} | Days: ${DAYS.join(", ")} | ${DAYS.length * 10} pins total\n`);

  const allPins = [];

  for (const day of DAYS) {
    const dayPins = await generateDay(WEEK, day);
    allPins.push(...dayPins);
    console.log(`   → ${dayPins.length} pins generated for day ${day}`);

    // Pause between days to be kind to the API
    if (DAYS.indexOf(day) < DAYS.length - 1) {
      await new Promise((r) => setTimeout(r, 2000));
    }
  }

  // ── Save output ──────────────────────────────────────────────────────────
  const outputFile = `pinterest_week_${WEEK}.json`;
  fs.writeFileSync(outputFile, JSON.stringify(allPins, null, 2), "utf8");

  // ── Summary ──────────────────────────────────────────────────────────────
  const byFunnel = allPins.reduce((acc, p) => {
    acc[p.funnel] = (acc[p.funnel] ?? 0) + 1;
    return acc;
  }, {});

  console.log(`\n✅ Done! ${allPins.length} pins generated`);
  console.log(`   Breakdown: ${Object.entries(byFunnel).map(([k, v]) => `${k}: ${v}`).join(" | ")}`);
  console.log(`   Output: ${outputFile}`);
  console.log(`\nNext step: run sheets-publisher.js to push to Google Sheets`);

  return allPins;
}

main().catch((err) => {
  console.error("\n❌ pinterest-generator failed:", err.message);
  process.exit(1);
});