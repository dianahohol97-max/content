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

const WEEK = parseInt(process.argv.find((a) => a.startsWith("--week="))?.split("=")[1] ?? "1");
const DAY_ONLY = process.argv.find((a) => a.startsWith("--day="))?.split("=")[1];

const DAYS = DAY_ONLY ? [parseInt(DAY_ONLY)] : [1, 2, 3, 4, 5, 6, 7];

const URLS = {
  quiz: "https://bloomfocus.org/quiz",
  app:  "https://bloomfocus.org/app",
  etsy: "https://www.etsy.com/shop/BloomfocusShop",
  blog: "https://bloomfocus.org/blog",
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
- overlayTitle: The text shown ON the photo — this is what stops the scroll. 3-6 words. It MUST be a complete, self-explanatory hook, NOT a cut-off phrase.
  It must be ONE of these types:
    (a) A question that creates recognition: "Why can't I start tasks?", "ADHD or just tired?"
    (b) A clear benefit/promise: "Make mornings finally work", "Focus without forcing it"
    (c) A relatable statement: "Mornings feel impossible. Here's why."
  BAD (incomplete, confusing): "Start mornings with ADHD", "ADHD focus app", "ADHD support"
  GOOD (complete hook): "Can't get out of bed?", "The app for ADHD mornings", "Mornings shouldn't feel this hard"
  Read it aloud — if it sounds cut off or like a fragment, rewrite it as a full thought.
- overlaySubtitle: A SHORT teaser line shown under the hook that gives the viewer a REASON to click — what they'll learn or recognize. Max 6 words. Make it specific and intriguing, not generic.
  Examples by funnel:
    quiz: "3 signs it's ADHD →", "Which type are you?", "Take the 60-second test →"
    app: "The tool that finally helps →", "Built for ADHD brains →"
    etsy: "The planner that works →", "Designed for ADHD →"
    blog: "Here's the real reason →", "5 fixes that work →"
  It should pair with the hook so the card makes sense at a glance in a busy feed. Match the type of the overlayTitle (if the title is a question, the subtitle hints at the answer).
- board: Choose the most relevant from: ${BOARDS.join(" | ")}
- Each pin must have a DIFFERENT title, angle, and imagePrompt (not just paraphrases of the same idea)
- Pins ${batchIndex > 1 ? "in this second batch" : "in this first batch"} must be on different sub-topics within the theme${strictness}

Return ONLY a valid JSON array, no markdown, no explanation:
[
  {
    "title": "...",
    "overlayTitle": "...",
    "overlaySubtitle": "...",
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
          overlaySubtitle: "Find out why →",
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

// ─── Generate one day (10 pins) ───────────────────────────────────────────────
//
// New mix (data-driven for saves + clicks + sales):
//   4 hook pins   → quiz/app   (short text on photo, drives clicks)
//   4 infographic → quiz/app/blog (list on image, drives saves + authority)
//   2 product     → etsy       (photo + benefit, drives sales)

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

  // Tag hook/product pins with pinType for the image generator
  const tagHook = (arr) => arr.map((p) => ({ ...p, pinType: p.pinType ?? "hook" }));

  const allPins = [
    ...tagHook(hookQuiz),
    ...tagHook(hookApp),
    ...infoQuiz,
    ...infoApp,
    ...infoBlog,
    ...tagHook(product),
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